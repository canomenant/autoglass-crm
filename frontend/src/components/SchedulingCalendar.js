"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import moment from "moment";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { MarkerClusterer } from "@googlemaps/markerclusterer";
import { updateWorkOrder } from "@/lib/api";
import { loadGoogleMaps } from "@/lib/googleMaps";
import { getStatusColor, STATUS_COLORS } from "@/lib/workOrderStatusColors";
import { WORK_ORDER_STATUSES } from "@/lib/workOrderStatuses";
import WorkOrderStatusBadge from "@/components/WorkOrderStatusBadge";

// El calendario del taller agenda por VENTANAS, no por horas: "te llegamos entre 9 y 1" o
// "entre 1 y 5", y solo a veces una hora fija. La rejilla por horas (react-big-calendar) apilaba
// todo a las 9 AM porque casi ninguna orden trae hora. Rediseño de la "Opción A + C + M1"
// aprobada por Antonio (29-ago-2026): semana/mes por franjas, día por técnico, y pestaña de mapa
// con los mismos filtros.
//
// Las franjas 9–1 / 1–5 viven aquí como constantes; si algún día cambian por temporada, este es
// el único lugar que hay que tocar (o moverlas a Settings).

const STATUSES = WORK_ORDER_STATUSES;
const VIEWS = ["day", "week", "month", "agenda", "map"];
// REST junta "todo el día" y "sin confirmar": para el despacho son lo mismo — puede caer a
// cualquier hora — y separarlos duplicaría renglones sin decir nada nuevo.
const FRANJAS = ["AM", "PM", "EXACT", "REST"];
const DROPPABLE = { AM: "AM", PM: "PM", REST: "ALL_DAY" };

const DEFAULT_CENTER = { lat: 33.75, lng: -117.15 };

function windowOf(wo) {
  const w = wo.appointmentWindow;
  if (w === "AM" || w === "PM" || w === "EXACT") return w;
  if (w === "ALL_DAY") return "REST";
  if (wo.appointmentTime) return "EXACT";
  return "REST";
}

function suave(color) {
  // Fondo tenue del color del estado, borde sólido: se distingue el estado sin tapar el texto.
  return { borderLeft: `3px solid ${color}`, backgroundColor: `${color}1c` };
}

export default function SchedulingCalendar({ workOrders, technicians, companies, distributors, onRefresh }) {
  const t = useTranslations("scheduling");
  const tw = useTranslations("workOrders");
  const [view, setView] = useState("week");
  const [date, setDate] = useState(() => moment().format("YYYY-MM-DD"));
  const [contextMenu, setContextMenu] = useState(null);
  const [expanded, setExpanded] = useState(() => new Set());
  const [dragOver, setDragOver] = useState(null);
  const [selectedPin, setSelectedPin] = useState(null);
  const [mapError, setMapError] = useState("");
  const [filters, setFilters] = useState({
    technicianId: "",
    status: "",
    insuranceCompanyId: "",
    distributor: "",
    jobType: "",
    dateFrom: "",
    dateTo: "",
    paymentStatus: "",
  });

  const jobTypes = useMemo(() => [...new Set(workOrders.map((w) => w.jobType).filter(Boolean))], [workOrders]);

  const filtered = useMemo(() => {
    return workOrders.filter((wo) => {
      if (filters.technicianId && String(wo.technicianId) !== filters.technicianId) return false;
      if (filters.status && wo.status !== filters.status) return false;
      if (filters.insuranceCompanyId && String(wo.insuranceCompanyId) !== filters.insuranceCompanyId) return false;
      if (filters.distributor && wo.distributor !== filters.distributor) return false;
      if (filters.jobType && wo.jobType !== filters.jobType) return false;
      if (filters.dateFrom && (!wo.appointmentDate || wo.appointmentDate < filters.dateFrom)) return false;
      if (filters.dateTo && (!wo.appointmentDate || wo.appointmentDate > filters.dateTo)) return false;
      if (filters.paymentStatus === "Paid" && !wo.payment?.paid) return false;
      if (filters.paymentStatus === "Unpaid" && wo.payment?.paid) return false;
      return wo.appointmentDate;
    });
  }, [workOrders, filters]);

  // El rango visible según la vista; el mapa y la agenda usan el mismo.
  const range = useMemo(() => {
    const m = moment(date, "YYYY-MM-DD");
    if (view === "day") return { from: m.clone(), to: m.clone() };
    if (view === "month") return { from: m.clone().startOf("month"), to: m.clone().endOf("month") };
    return { from: m.clone().startOf("week"), to: m.clone().endOf("week") };
  }, [date, view]);

  const enRango = useMemo(() => {
    const from = range.from.format("YYYY-MM-DD");
    const to = range.to.format("YYYY-MM-DD");
    return filtered.filter((wo) => wo.appointmentDate >= from && wo.appointmentDate <= to);
  }, [filtered, range]);

  // fecha -> franja -> [wo], con hora fija ordenada por hora.
  const porDia = useMemo(() => {
    const out = {};
    enRango.forEach((wo) => {
      const d = wo.appointmentDate;
      const f = windowOf(wo);
      if (!out[d]) out[d] = { AM: [], PM: [], EXACT: [], REST: [] };
      out[d][f].push(wo);
    });
    Object.values(out).forEach((dia) => dia.EXACT.sort((a, b) => (a.appointmentTime || "").localeCompare(b.appointmentTime || "")));
    return out;
  }, [enRango]);

  function companyName(id) {
    return companies.find((c) => c.id === id)?.name || "";
  }

  async function persist(id, data) {
    try {
      await updateWorkOrder(id, data);
      onRefresh();
    } catch (e) {
      alert(e.message);
    }
  }

  function navegar(paso) {
    const unidad = view === "month" ? "month" : view === "day" ? "day" : "week";
    setDate(paso === 0 ? moment().format("YYYY-MM-DD") : moment(date, "YYYY-MM-DD").add(paso, unidad).format("YYYY-MM-DD"));
    setExpanded(new Set());
    setSelectedPin(null);
  }

  const rangeLabel =
    view === "day"
      ? range.from.format("dddd, MMM D, YYYY")
      : view === "month"
      ? range.from.format("MMMM YYYY")
      : `${range.from.format("MMM D")} – ${range.to.format(range.from.month() === range.to.month() ? "D" : "MMM D")}`;

  // --- arrastrar una tarjeta a otra franja/día/técnico ---
  function onDragStart(e, wo) {
    e.dataTransfer.setData("text/plain", String(wo.id));
    e.dataTransfer.effectAllowed = "move";
  }

  function dropData(e) {
    const id = e.dataTransfer.getData("text/plain");
    return workOrders.find((w) => String(w.id) === id) || null;
  }

  function handleDrop(e, cambios, key) {
    e.preventDefault();
    setDragOver(null);
    const wo = dropData(e);
    if (!wo) return;
    persist(wo.id, cambios);
  }

  const allowDrop = (key) => (e) => {
    e.preventDefault();
    if (dragOver !== key) setDragOver(key);
  };

  // --- la tarjeta de un trabajo, igual en todas las vistas ---
  function Card({ wo, compact }) {
    const color = getStatusColor(wo);
    return (
      <div
        draggable
        onDragStart={(e) => onDragStart(e, wo)}
        onClick={(e) => { e.stopPropagation(); window.location.href = `/dashboard/workorders/${wo.id}`; }}
        onContextMenu={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setContextMenu({ x: e.clientX, y: e.clientY, wo });
        }}
        title={[
          wo.customerName,
          wo.phone && `${t("phone")}: ${wo.phone}`,
          wo.address && `${t("address")}: ${wo.address}`,
          [wo.vehicle?.year, wo.vehicle?.make, wo.vehicle?.model].filter(Boolean).join(" "),
          wo.insuranceCompanyId && `${t("insurance")}: ${companyName(wo.insuranceCompanyId)}`,
          wo.tech && `${t("technician")}: ${wo.tech}`,
          `${t("status")}: ${tw(`statuses.${wo.status}`)}`,
        ].filter(Boolean).join("\n")}
        className="rounded px-1.5 py-1 text-[11px] leading-tight cursor-pointer select-none dark:text-gray-100"
        style={suave(color)}
      >
        <div className="font-semibold truncate">
          {windowOf(wo) === "EXACT" && wo.appointmentTime && <span className="mr-1">{wo.appointmentTime}</span>}
          {wo.workOrderNo} · {wo.customerName}
        </div>
        {!compact && (
          <div className="truncate text-gray-600 dark:text-gray-300">
            {[wo.tech || t("noTech"), wo.jobType].filter(Boolean).join(" · ")}
          </div>
        )}
      </div>
    );
  }

  // Celda de franja: lista de tarjetas con tope y "+N más". Suelta = mover ahí.
  function Celda({ dia, franja, jobs, droppable, compact, max = 4 }) {
    const key = `${dia}:${franja}`;
    const abierta = expanded.has(key);
    const visibles = abierta ? jobs : jobs.slice(0, max);
    return (
      <div
        onDragOver={droppable ? allowDrop(key) : undefined}
        onDragLeave={droppable ? () => setDragOver(null) : undefined}
        onDrop={droppable ? (e) => handleDrop(e, { appointmentDate: dia, appointmentWindow: DROPPABLE[franja] }, key) : undefined}
        className={`rounded-lg border p-1 min-h-[54px] flex flex-col gap-1 transition-colors ${
          dragOver === key ? "border-blue-500 bg-blue-50 dark:bg-blue-950/40" : "border-dashed border-gray-200 dark:border-gray-700"
        }`}
      >
        {visibles.map((wo) => <Card key={wo.id} wo={wo} compact={compact} />)}
        {jobs.length > visibles.length && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); setExpanded((prev) => new Set(prev).add(key)); }}
            className="text-[11px] text-blue-600 dark:text-blue-400 text-left px-1"
          >
            {t("moreCount", { count: jobs.length - visibles.length })}
          </button>
        )}
      </div>
    );
  }

  const franjaLabel = (f) => t(`windows.${f}`);

  // --- SEMANA: 7 días × franjas ---
  function WeekView() {
    const dias = [...Array(7)].map((_, i) => range.from.clone().add(i, "day"));
    return (
      <div className="overflow-x-auto">
        <div className="grid gap-1.5 min-w-[860px]" style={{ gridTemplateColumns: "70px repeat(7, minmax(110px, 1fr))" }}>
          <div />
          {dias.map((d) => (
            <div key={d.format()} className={`text-center text-xs font-semibold py-1 rounded ${d.isSame(moment(), "day") ? "bg-blue-600 text-white" : "text-gray-500 dark:text-gray-400"}`}>
              {d.format("ddd D")}
            </div>
          ))}
          {FRANJAS.map((f) => (
            <div key={f} className="contents">
              <div className="text-[11px] text-gray-400 dark:text-gray-500 text-right pr-2 pt-2 leading-tight whitespace-pre-line">{franjaLabel(f)}</div>
              {dias.map((d) => {
                const dia = d.format("YYYY-MM-DD");
                const jobs = porDia[dia]?.[f] || [];
                return <Celda key={dia + f} dia={dia} franja={f} jobs={jobs} droppable={f !== "EXACT"} compact />;
              })}
            </div>
          ))}
        </div>
      </div>
    );
  }

  // --- DÍA: una columna por técnico (la vista de despacho) ---
  function DayView() {
    const dia = range.from.format("YYYY-MM-DD");
    const jobs = enRango;
    const nombres = [...new Set(jobs.map((w) => (w.tech || "").trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
    const sinTech = jobs.filter((w) => !(w.tech || "").trim());
    const columnas = [...nombres.map((n) => ({ nombre: n, jobs: jobs.filter((w) => (w.tech || "").trim() === n) }))];
    if (sinTech.length || !columnas.length) columnas.push({ nombre: "", jobs: sinTech });
    return (
      <div className="overflow-x-auto">
        <div className="flex gap-2 min-w-fit">
          {columnas.map((col) => (
            <div key={col.nombre || "__sin"} className="w-56 flex-shrink-0">
              <div className="text-xs font-semibold text-center py-1.5 text-gray-600 dark:text-gray-300 border-b-2 dark:border-gray-700 mb-1.5 truncate">
                {col.nombre || t("noTech")} <span className="text-gray-400 font-normal">· {col.jobs.length}</span>
              </div>
              {FRANJAS.map((f) => {
                const enFranja = col.jobs.filter((w) => windowOf(w) === f);
                const key = `${dia}:${col.nombre}:${f}`;
                if (f === "EXACT" && !enFranja.length) return null;
                const tech = technicians.find((x) => x.name === col.nombre);
                return (
                  <div key={f} className="mb-1.5">
                    <div className="text-[10px] uppercase tracking-wide text-gray-400 dark:text-gray-500 px-1">{franjaLabel(f)}</div>
                    <div
                      onDragOver={f !== "EXACT" ? allowDrop(key) : undefined}
                      onDragLeave={f !== "EXACT" ? () => setDragOver(null) : undefined}
                      onDrop={f !== "EXACT" ? (e) =>
                        handleDrop(e, {
                          appointmentDate: dia,
                          appointmentWindow: DROPPABLE[f],
                          tech: col.nombre,
                          ...(tech ? { technicianId: tech.id } : {}),
                        }, key) : undefined}
                      className={`rounded-lg border p-1 min-h-[44px] flex flex-col gap-1 transition-colors ${
                        dragOver === key ? "border-blue-500 bg-blue-50 dark:bg-blue-950/40" : "border-dashed border-gray-200 dark:border-gray-700"
                      }`}
                    >
                      {enFranja.map((wo) => <Card key={wo.id} wo={wo} />)}
                      {!enFranja.length && <span className="text-[11px] text-gray-300 dark:text-gray-600 px-1">{t("free")}</span>}
                    </div>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    );
  }

  // --- MES: rejilla con resumen por día; clic en el día abre el despacho ---
  function MonthView() {
    const start = range.from.clone().startOf("week");
    const semanas = [];
    for (let s = 0; s < 6; s++) {
      const dias = [...Array(7)].map((_, i) => start.clone().add(s * 7 + i, "day"));
      if (s > 0 && dias[0].isAfter(range.to)) break;
      semanas.push(dias);
    }
    return (
      <div className="overflow-x-auto">
        <div className="grid grid-cols-7 gap-1 min-w-[840px] text-center text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1">
          {[...Array(7)].map((_, i) => <div key={i}>{moment().startOf("week").add(i, "day").format("ddd")}</div>)}
        </div>
        {semanas.map((dias, si) => (
          <div key={si} className="grid grid-cols-7 gap-1 min-w-[840px] mb-1">
            {dias.map((d) => {
              const dia = d.format("YYYY-MM-DD");
              const delMes = d.isSameOrAfter(range.from, "day") && d.isSameOrBefore(range.to, "day");
              const franjas = porDia[dia];
              const total = franjas ? FRANJAS.reduce((a, f) => a + franjas[f].length, 0) : 0;
              const key = `mes:${dia}`;
              return (
                <div
                  key={dia}
                  onClick={() => { setDate(dia); setView("day"); }}
                  onDragOver={allowDrop(key)}
                  onDragLeave={() => setDragOver(null)}
                  onDrop={(e) => handleDrop(e, { appointmentDate: dia }, key)}
                  className={`rounded-lg border p-1 min-h-[86px] cursor-pointer transition-colors ${
                    dragOver === key ? "border-blue-500 bg-blue-50 dark:bg-blue-950/40" : "border-gray-100 dark:border-gray-800"
                  } ${delMes ? "" : "opacity-40"} ${d.isSame(moment(), "day") ? "ring-2 ring-blue-500" : ""}`}
                >
                  <div className="flex items-center justify-between text-[11px] px-0.5">
                    <span className={`font-semibold ${delMes ? "dark:text-gray-200" : "text-gray-400"}`}>{d.date()}</span>
                    {total > 0 && (
                      <span className="text-gray-400">
                        {franjas.AM.length > 0 && <span className="mr-1">M{franjas.AM.length}</span>}
                        {franjas.PM.length > 0 && <span className="mr-1">T{franjas.PM.length}</span>}
                        {franjas.EXACT.length > 0 && <span>🕘{franjas.EXACT.length}</span>}
                      </span>
                    )}
                  </div>
                  <div className="flex flex-col gap-0.5 mt-0.5">
                    {(franjas ? FRANJAS.flatMap((f) => franjas[f]) : []).slice(0, 2).map((wo) => <Card key={wo.id} wo={wo} compact />)}
                    {total > 2 && <span className="text-[10px] text-blue-600 dark:text-blue-400 px-1">{t("moreCount", { count: total - 2 })}</span>}
                  </div>
                </div>
              );
            })}
          </div>
        ))}
      </div>
    );
  }

  // --- AGENDA: la semana como lista, por día y franja ---
  function AgendaView() {
    const dias = [...Array(7)].map((_, i) => range.from.clone().add(i, "day"));
    return (
      <div className="space-y-4">
        {dias.map((d) => {
          const dia = d.format("YYYY-MM-DD");
          const franjas = porDia[dia];
          if (!franjas) return null;
          return (
            <div key={dia}>
              <div className="text-sm font-semibold dark:text-gray-100 border-b dark:border-gray-800 pb-1 mb-2">{d.format("dddd, MMM D")}</div>
              {FRANJAS.map((f) => {
                const jobs = franjas[f];
                if (!jobs.length) return null;
                return (
                  <div key={f} className="flex gap-3 mb-1.5">
                    <div className="w-24 flex-shrink-0 text-[11px] text-gray-400 dark:text-gray-500 pt-1 whitespace-pre-line">{franjaLabel(f)}</div>
                    <div className="flex-1 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-1">
                      {jobs.map((wo) => <Card key={wo.id} wo={wo} />)}
                    </div>
                  </div>
                );
              })}
            </div>
          );
        })}
        {!enRango.length && <p className="text-sm text-gray-400 py-8 text-center">{t("noJobsRange")}</p>}
      </div>
    );
  }

  // --- MAPA: los mismos trabajos del rango y filtros, como pines por estado ---
  const located = useMemo(() => enRango.filter((wo) => wo.latitude != null && wo.longitude != null), [enRango]);
  const mapDivRef = useRef(null);
  const mapRef = useRef(null);
  const clustererRef = useRef(null);
  const markersRef = useRef([]);

  useEffect(() => {
    if (view !== "map") return;
    let cancelled = false;
    loadGoogleMaps()
      .then((maps) => maps.importLibrary("maps"))
      .then(({ Map }) => {
        if (cancelled || !mapDivRef.current || mapRef.current) return;
        mapRef.current = new Map(mapDivRef.current, {
          center: DEFAULT_CENTER,
          zoom: 9,
          mapTypeControl: false,
          streetViewControl: false,
          fullscreenControl: true,
        });
        clustererRef.current = new MarkerClusterer({ map: mapRef.current, markers: [] });
      })
      .catch((e) => { if (!cancelled) setMapError(e.message); });
    return () => { cancelled = true; };
  }, [view]);

  // Al salir de la pestaña el div se desmonta; el mapa se recrea al volver.
  useEffect(() => {
    if (view !== "map") {
      mapRef.current = null;
      clustererRef.current = null;
      markersRef.current = [];
    }
  }, [view]);

  useEffect(() => {
    const map = mapRef.current;
    const clusterer = clustererRef.current;
    if (view !== "map" || !map || !clusterer || !window.google?.maps) return;
    const gmaps = window.google.maps;
    markersRef.current.forEach((m) => m.setMap(null));
    clusterer.clearMarkers();
    const markers = located.map((wo) => {
      const marker = new gmaps.Marker({
        position: { lat: wo.latitude, lng: wo.longitude },
        title: `${wo.workOrderNo} — ${wo.customerName || ""}`,
        icon: {
          path: gmaps.SymbolPath.CIRCLE,
          scale: 8,
          fillColor: STATUS_COLORS[wo.status] || "#6b7280",
          fillOpacity: 0.95,
          strokeColor: "#ffffff",
          strokeWeight: 1.5,
        },
      });
      marker.addListener("click", () => setSelectedPin(wo));
      return marker;
    });
    markersRef.current = markers;
    clusterer.addMarkers(markers);
    if (markers.length) {
      const bounds = new gmaps.LatLngBounds();
      located.forEach((wo) => bounds.extend({ lat: wo.latitude, lng: wo.longitude }));
      map.fitBounds(bounds, 60);
      const listener = gmaps.event.addListenerOnce(map, "bounds_changed", () => {
        if (map.getZoom() > 15) map.setZoom(15);
      });
      return () => gmaps.event.removeListener(listener);
    }
  }, [view, located]);

  function MapView() {
    return (
      <div>
        {located.length < enRango.length && (
          <p className="text-xs text-amber-700 dark:text-amber-400 mb-2">
            {t("unlocatedNotice", { count: enRango.length - located.length })}
          </p>
        )}
        <div className="grid grid-cols-1 xl:grid-cols-[1fr_280px] gap-3 items-start">
          {mapError ? (
            <div className="h-[520px] flex items-center justify-center text-sm text-gray-400 border rounded-lg dark:border-gray-800">{t("mapUnavailable")}</div>
          ) : (
            <div ref={mapDivRef} className="h-[520px] w-full rounded-lg overflow-hidden border dark:border-gray-800" />
          )}
          <div>
            {selectedPin ? (
              <div className="border dark:border-gray-800 rounded-lg p-3 space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-sm dark:text-gray-100">{selectedPin.workOrderNo}</span>
                  <WorkOrderStatusBadge status={selectedPin.status} />
                </div>
                <p className="text-sm dark:text-gray-200">{selectedPin.customerName}</p>
                {selectedPin.address && <p className="text-xs text-gray-500 dark:text-gray-400">{selectedPin.address}</p>}
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  {selectedPin.appointmentDate} · {t(`windows.${windowOf(selectedPin)}`).replace("\n", " ")}
                  {windowOf(selectedPin) === "EXACT" && selectedPin.appointmentTime ? ` ${selectedPin.appointmentTime}` : ""}
                </p>
                {selectedPin.tech && <p className="text-xs text-gray-500 dark:text-gray-400">{t("technician")}: {selectedPin.tech}</p>}
                <Link href={`/dashboard/workorders/${selectedPin.id}`} className="inline-block bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium rounded-lg px-3 py-1.5 mt-1">
                  {t("openWorkOrder")}
                </Link>
              </div>
            ) : (
              <div className="border dark:border-gray-800 rounded-lg p-3 text-xs text-gray-400">{t("clickAPin")}</div>
            )}
          </div>
        </div>
      </div>
    );
  }

  function closeMenu() {
    setContextMenu(null);
  }

  async function handleStatusChange(wo, status) {
    await persist(wo.id, { status });
    closeMenu();
  }

  async function handleMarkPaid(wo) {
    await persist(wo.id, { payment: { ...wo.payment, paid: true } });
    closeMenu();
  }

  async function handleWindowChange(wo, appointmentWindow) {
    await persist(wo.id, { appointmentWindow });
    closeMenu();
  }

  const selectClass =
    "border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-2 py-1.5 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-shadow text-xs";

  return (
    <div className="bg-white dark:bg-gray-900 dark:border dark:border-gray-800 rounded-lg shadow p-4" onClick={closeMenu}>
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-2 mb-4">
        <select value={filters.technicianId} onChange={(e) => setFilters((f) => ({ ...f, technicianId: e.target.value }))} className={selectClass}>
          <option value="">{t("allTechnicians")}</option>
          {technicians.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
        </select>
        <select value={filters.status} onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value }))} className={selectClass}>
          <option value="">{t("allStatuses")}</option>
          {STATUSES.map((s) => <option key={s} value={s}>{tw(`statuses.${s}`)}</option>)}
        </select>
        <select value={filters.insuranceCompanyId} onChange={(e) => setFilters((f) => ({ ...f, insuranceCompanyId: e.target.value }))} className={selectClass}>
          <option value="">{t("allInsurance")}</option>
          {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <select value={filters.distributor} onChange={(e) => setFilters((f) => ({ ...f, distributor: e.target.value }))} className={selectClass}>
          <option value="">{t("allDistributors")}</option>
          {distributors.map((d) => <option key={d.id} value={d.name}>{d.name}</option>)}
        </select>
        <select value={filters.jobType} onChange={(e) => setFilters((f) => ({ ...f, jobType: e.target.value }))} className={selectClass}>
          <option value="">{t("allJobTypes")}</option>
          {jobTypes.map((j) => <option key={j} value={j}>{j}</option>)}
        </select>
        <select value={filters.paymentStatus} onChange={(e) => setFilters((f) => ({ ...f, paymentStatus: e.target.value }))} className={selectClass}>
          <option value="">{t("allPaymentStatus")}</option>
          <option value="Paid">{t("paid")}</option>
          <option value="Unpaid">{t("unpaid")}</option>
        </select>
        <input type="date" value={filters.dateFrom} onChange={(e) => setFilters((f) => ({ ...f, dateFrom: e.target.value }))} className={selectClass} />
        <input type="date" value={filters.dateTo} onChange={(e) => setFilters((f) => ({ ...f, dateTo: e.target.value }))} className={selectClass} />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <div className="flex gap-1">
          <button type="button" onClick={() => navegar(0)} className="border dark:border-gray-700 rounded-lg px-3 py-1.5 text-xs dark:text-gray-200">{t("today")}</button>
          <button type="button" onClick={() => navegar(-1)} className="border dark:border-gray-700 rounded-lg px-3 py-1.5 text-xs dark:text-gray-200">‹ {t("back")}</button>
          <button type="button" onClick={() => navegar(1)} className="border dark:border-gray-700 rounded-lg px-3 py-1.5 text-xs dark:text-gray-200">{t("next")} ›</button>
        </div>
        <div className="text-sm font-semibold dark:text-gray-100">{rangeLabel}</div>
        <div className="flex rounded-lg border dark:border-gray-700 overflow-hidden">
          {VIEWS.map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => { setView(v); setSelectedPin(null); }}
              className={`px-3 py-1.5 text-xs transition-colors ${view === v ? "bg-blue-600 text-white font-medium" : "text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800"}`}
            >
              {t(`views.${v}`)}
            </button>
          ))}
        </div>
      </div>

      {view === "week" && <WeekView />}
      {view === "day" && <DayView />}
      {view === "month" && <MonthView />}
      {view === "agenda" && <AgendaView />}
      {view === "map" && <MapView />}

      {contextMenu && (
        <div
          className="fixed bg-white dark:bg-gray-800 dark:border dark:border-gray-700 rounded-xl shadow-xl border py-1 z-50 text-sm min-w-[190px] max-h-[70vh] overflow-y-auto"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          <Link href={`/dashboard/workorders/${contextMenu.wo.id}`} className="block px-4 py-2 hover:bg-gray-50 dark:hover:bg-gray-700 dark:text-gray-100">
            {t("openWorkOrder")}
          </Link>
          <div className="px-4 py-1 text-xs text-gray-400 uppercase mt-1">{t("moveToWindow")}</div>
          {["AM", "PM", "ALL_DAY"].map((w) => (
            <button key={w} onClick={() => handleWindowChange(contextMenu.wo, w)} className="block w-full text-left px-4 py-1.5 hover:bg-gray-50 dark:hover:bg-gray-700 dark:text-gray-200">
              {t(`windows.${w === "ALL_DAY" ? "REST" : w}`).replace("\n", " ")}
            </button>
          ))}
          <div className="px-4 py-1 text-xs text-gray-400 uppercase mt-1">{t("changeStatus")}</div>
          {STATUSES.map((s) => (
            <button key={s} onClick={() => handleStatusChange(contextMenu.wo, s)} className="block w-full text-left px-4 py-1.5 hover:bg-gray-50 dark:hover:bg-gray-700 dark:text-gray-200">
              {tw(`statuses.${s}`)}
            </button>
          ))}
          <div className="border-t dark:border-gray-700 mt-1 pt-1">
            <button onClick={() => handleMarkPaid(contextMenu.wo)} className="block w-full text-left px-4 py-2 hover:bg-gray-50 dark:hover:bg-gray-700 dark:text-gray-200">
              {t("markAsPaid")}
            </button>
            {contextMenu.wo.address && (
              <a
                href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(contextMenu.wo.address)}`}
                target="_blank"
                rel="noreferrer"
                className="block px-4 py-2 hover:bg-gray-50 dark:hover:bg-gray-700 dark:text-gray-200"
              >
                {t("openMaps")}
              </a>
            )}
          </div>
        </div>
      )}

      <div className="flex flex-wrap gap-3 mt-4 text-xs text-gray-500">
        {WORK_ORDER_STATUSES.map((key) => (
          <div key={key} className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded-sm inline-block" style={{ backgroundColor: STATUS_COLORS[key] }} />
            {tw(`statuses.${key}`)}
          </div>
        ))}
      </div>
    </div>
  );
}
