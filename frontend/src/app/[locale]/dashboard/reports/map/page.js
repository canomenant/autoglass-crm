"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { MarkerClusterer } from "@googlemaps/markerclusterer";
import { getWorkOrders } from "@/lib/api";
import { loadGoogleMaps } from "@/lib/googleMaps";
import { WORK_ORDER_STATUSES } from "@/lib/workOrderStatuses";
import { STATUS_COLORS } from "@/lib/workOrderStatusColors";
import ReportsTabs from "@/components/ReportsTabs";
import WorkOrderStatusBadge from "@/components/WorkOrderStatusBadge";

// Centro por defecto: el Inland Empire, donde está el grueso de los trabajos. Sólo manda cuando no
// hay ni un punto que encuadrar; con puntos, el mapa se ajusta a lo filtrado.
const DEFAULT_CENTER = { lat: 33.75, lng: -117.15 };
const DEFAULT_ZOOM = 9;

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function daysAgoStr(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

// Los atajos escriben el rango en los mismos campos de fecha, no son un modo aparte: así siempre se
// ve qué fechas exactas están aplicadas y se pueden retocar a mano después de pulsar uno.
const QUICK_RANGES = [
  { key: "day", from: () => todayStr(), to: () => todayStr() },
  { key: "week", from: () => daysAgoStr(6), to: () => todayStr() },
  { key: "month", from: () => `${todayStr().slice(0, 7)}-01`, to: () => todayStr() },
  { key: "year", from: () => `${todayStr().slice(0, 4)}-01-01`, to: () => todayStr() },
  { key: "all", from: () => "", to: () => "" },
];

export default function JobsMapPage() {
  const t = useTranslations("jobsMap");
  const tr = useTranslations("reports");
  const tw = useTranslations("workOrders");

  const [workOrders, setWorkOrders] = useState([]);
  const [error, setError] = useState("");
  const [mapError, setMapError] = useState("");
  const [filters, setFilters] = useState({ dateFrom: daysAgoStr(6), dateTo: todayStr(), status: "", technician: "" });
  const [selected, setSelected] = useState(null);

  const mapDivRef = useRef(null);
  const mapRef = useRef(null);
  const clustererRef = useRef(null);
  const markersRef = useRef([]);

  useEffect(() => {
    getWorkOrders().then(setWorkOrders).catch((e) => setError(e.message));
  }, []);

  const technicians = useMemo(() => {
    const names = new Set();
    workOrders.forEach((w) => {
      if (w.tech) names.add(w.tech);
      (w.extraTechs || []).forEach((x) => x.name && names.add(x.name));
    });
    return [...names].sort((a, b) => a.localeCompare(b));
  }, [workOrders]);

  const filtered = useMemo(() => {
    return workOrders.filter((wo) => {
      const date = wo.appointmentDate || "";
      if (filters.dateFrom || filters.dateTo) {
        if (!date) return false;
        if (filters.dateFrom && date < filters.dateFrom) return false;
        if (filters.dateTo && date > filters.dateTo) return false;
      }
      if (filters.status && wo.status !== filters.status) return false;
      if (filters.technician) {
        const techs = [wo.tech, ...(wo.extraTechs || []).map((x) => x.name)].filter(Boolean);
        if (!techs.includes(filters.technician)) return false;
      }
      return true;
    });
  }, [workOrders, filters]);

  const located = useMemo(() => filtered.filter((wo) => wo.latitude != null && wo.longitude != null), [filtered]);
  const unlocated = filtered.length - located.length;

  // El mapa se crea una vez; los pines se rehacen con cada filtro.
  useEffect(() => {
    let cancelled = false;
    loadGoogleMaps()
      .then((maps) => maps.importLibrary("maps"))
      .then(({ Map }) => {
        if (cancelled || !mapDivRef.current || mapRef.current) return;
        mapRef.current = new Map(mapDivRef.current, {
          center: DEFAULT_CENTER,
          zoom: DEFAULT_ZOOM,
          mapTypeControl: true,
          streetViewControl: false,
          fullscreenControl: true,
        });
        clustererRef.current = new MarkerClusterer({ map: mapRef.current, markers: [] });
      })
      .catch((e) => {
        // Sin clave o sin red el resto de la página sigue sirviendo: los contadores y la lista de
        // filtros funcionan igual, sólo no hay lienzo.
        if (!cancelled) setMapError(e.message);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    const clusterer = clustererRef.current;
    if (!map || !clusterer || !window.google?.maps) return;
    const gmaps = window.google.maps;

    markersRef.current.forEach((m) => m.setMap(null));
    clusterer.clearMarkers();

    const markers = located.map((wo) => {
      const marker = new gmaps.Marker({
        position: { lat: wo.latitude, lng: wo.longitude },
        title: `${wo.workOrderNo} — ${wo.customerName || ""}`,
        // Un círculo del color del estado — la misma paleta que el tracker, la lista y el
        // calendario, para que el mapa se lea sin leyenda nueva.
        icon: {
          path: gmaps.SymbolPath.CIRCLE,
          scale: 8,
          fillColor: STATUS_COLORS[wo.status] || "#6b7280",
          fillOpacity: 0.95,
          strokeColor: "#ffffff",
          strokeWeight: 1.5,
        },
      });
      marker.addListener("click", () => setSelected(wo));
      return marker;
    });

    markersRef.current = markers;
    clusterer.addMarkers(markers);

    if (markers.length) {
      const bounds = new gmaps.LatLngBounds();
      located.forEach((wo) => bounds.extend({ lat: wo.latitude, lng: wo.longitude }));
      map.fitBounds(bounds, 60);
      // Un solo punto no necesita zoom de microscopio.
      const listener = gmaps.event.addListenerOnce(map, "bounds_changed", () => {
        if (map.getZoom() > 15) map.setZoom(15);
      });
      return () => gmaps.event.removeListener(listener);
    }
  }, [located]);

  function setFilter(field, value) {
    setFilters((prev) => ({ ...prev, [field]: value }));
    setSelected(null);
  }

  function applyQuickRange(range) {
    setFilters((prev) => ({ ...prev, dateFrom: range.from(), dateTo: range.to() }));
    setSelected(null);
  }

  const activeQuick = QUICK_RANGES.find((r) => r.from() === filters.dateFrom && r.to() === filters.dateTo)?.key;
  const filterClass =
    "border border-slate-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none";

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold dark:text-gray-100 tracking-tight">{tr("title")}</h1>

      <ReportsTabs active="map" />

      {error && <p className="text-red-600 dark:text-red-400 text-sm">{error}</p>}

      <div className="bg-white dark:bg-gray-900 dark:border dark:border-gray-800 rounded-xl shadow-sm p-4 flex flex-wrap items-end gap-4">
        <div className="flex rounded-lg border border-slate-200 dark:border-gray-700 overflow-hidden">
          {QUICK_RANGES.map((r) => (
            <button
              key={r.key}
              type="button"
              onClick={() => applyQuickRange(r)}
              className={`px-3 py-2 text-sm transition-colors ${
                activeQuick === r.key
                  ? "bg-blue-600 text-white font-medium"
                  : "text-slate-600 dark:text-gray-300 hover:bg-slate-50 dark:hover:bg-gray-800"
              }`}
            >
              {t(`ranges.${r.key}`)}
            </button>
          ))}
        </div>
        <div>
          <label htmlFor="map-from" className="block text-xs mb-1 text-slate-500 dark:text-gray-400">{tr("dateFrom")}</label>
          <input id="map-from" type="date" value={filters.dateFrom} onChange={(e) => setFilter("dateFrom", e.target.value)} className={filterClass} />
        </div>
        <div>
          <label htmlFor="map-to" className="block text-xs mb-1 text-slate-500 dark:text-gray-400">{tr("dateTo")}</label>
          <input id="map-to" type="date" value={filters.dateTo} onChange={(e) => setFilter("dateTo", e.target.value)} className={filterClass} />
        </div>
        <div>
          <label htmlFor="map-status" className="block text-xs mb-1 text-slate-500 dark:text-gray-400">{tw("status")}</label>
          <select id="map-status" value={filters.status} onChange={(e) => setFilter("status", e.target.value)} className={`${filterClass} min-w-[150px]`}>
            <option value="">{t("allStatuses")}</option>
            {WORK_ORDER_STATUSES.map((s) => <option key={s} value={s}>{tw(`statuses.${s}`)}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="map-tech" className="block text-xs mb-1 text-slate-500 dark:text-gray-400">{tr("technician")}</label>
          <select id="map-tech" value={filters.technician} onChange={(e) => setFilter("technician", e.target.value)} className={`${filterClass} min-w-[170px]`}>
            <option value="">{t("allTechnicians")}</option>
            {technicians.map((name) => <option key={name} value={name}>{name}</option>)}
          </select>
        </div>
        <div className="text-sm text-slate-500 dark:text-gray-400 pb-2 ml-auto">
          {t("locatedCount", { located: located.length, total: filtered.length })}
        </div>
      </div>

      {/* Mientras el histórico no esté geocodificado, el mapa se ve vacío y ESTO explica por qué —
          sin este aviso parecería un fallo del filtro. Desaparece solo cuando el backfill corra. */}
      {unlocated > 0 && (
        <div className="bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/30 text-amber-800 dark:text-amber-300 rounded-lg px-4 py-3 text-sm">
          {t("unlocatedNotice", { count: unlocated })}
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-[1fr_320px] gap-6 items-start">
        <div className="bg-white dark:bg-gray-900 dark:border dark:border-gray-800 rounded-xl shadow-sm overflow-hidden">
          {mapError ? (
            <div className="h-[600px] flex items-center justify-center p-8 text-center text-sm text-slate-500 dark:text-gray-400">
              {t("mapUnavailable")}
            </div>
          ) : (
            <div ref={mapDivRef} className="h-[600px] w-full" />
          )}
        </div>

        <aside className="space-y-4">
          {selected ? (
            <div className="bg-white dark:bg-gray-900 dark:border dark:border-gray-800 rounded-xl shadow-sm p-4 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold dark:text-gray-100">{selected.workOrderNo}</span>
                <WorkOrderStatusBadge status={selected.status} />
              </div>
              {selected.customerName && <p className="text-sm text-slate-700 dark:text-gray-200">{selected.customerName}</p>}
              {selected.address && <p className="text-xs text-slate-500 dark:text-gray-400">{selected.address}</p>}
              <p className="text-xs text-slate-500 dark:text-gray-400">
                {selected.appointmentDate}{selected.appointmentTime ? ` · ${selected.appointmentTime}` : ""}
              </p>
              {selected.tech && <p className="text-xs text-slate-500 dark:text-gray-400">{tr("technician")}: {selected.tech}</p>}
              <Link
                href={`/dashboard/workorders/${selected.id}`}
                className="inline-block bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg px-4 py-2 transition-colors mt-1"
              >
                {t("openWorkOrder")}
              </Link>
            </div>
          ) : (
            <div className="bg-white dark:bg-gray-900 dark:border dark:border-gray-800 rounded-xl shadow-sm p-4 text-sm text-slate-500 dark:text-gray-400">
              {t("clickAPin")}
            </div>
          )}

          <div className="bg-white dark:bg-gray-900 dark:border dark:border-gray-800 rounded-xl shadow-sm p-4">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-gray-500 mb-2">{t("legend")}</h3>
            <div className="space-y-1.5">
              {WORK_ORDER_STATUSES.map((s) => (
                <div key={s} className="flex items-center gap-2 text-sm text-slate-700 dark:text-gray-200">
                  <span className="w-3 h-3 rounded-full border border-white shadow-sm flex-shrink-0" style={{ backgroundColor: STATUS_COLORS[s] }} />
                  {tw(`statuses.${s}`)}
                </div>
              ))}
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
