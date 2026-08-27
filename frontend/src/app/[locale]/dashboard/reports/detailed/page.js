"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { getWorkOrders, getQuotes, exportDetailedReportXlsx } from "@/lib/api";
import { WORK_ORDER_STATUSES } from "@/lib/workOrderStatuses";
import { DEFAULT_SELECTED, getReportColumn, getReportValue } from "@/lib/detailedReportColumns";
import ReportColumnPicker from "@/components/ReportColumnPicker";
import ReportsTabs from "@/components/ReportsTabs";
import WorkOrderStatusBadge from "@/components/WorkOrderStatusBadge";

const PAGE_SIZE = 25;
const STORAGE_KEY = "reportDetailed:columns";

function money(n) {
  return `$${Number(n || 0).toFixed(2)}`;
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// El BOM va delante a proposito: sin el, Excel abre el CSV en la codificacion del sistema y
// cualquier acento o ñ del nombre de un cliente sale roto.
function buildCsv(columns, rows) {
  const escape = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const header = columns.map((c) => escape(c.label)).join(",");
  const lines = rows.map((row) => columns.map((c) => escape(row[c.key])).join(","));
  return `﻿${[header, ...lines].join("\n")}`;
}

export default function DetailedReportPage() {
  const t = useTranslations("detailedReport");
  const tcol = useTranslations("detailedReport.columns");
  const tr = useTranslations("reports");
  const tw = useTranslations("workOrders");

  const [workOrders, setWorkOrders] = useState([]);
  const [quotes, setQuotes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [exporting, setExporting] = useState("");

  const [filters, setFilters] = useState({ dateFrom: "", dateTo: "", status: "", customerType: "", technician: "" });
  const [page, setPage] = useState(1);

  // La eleccion de columnas sobrevive a salir y volver, igual que la configuracion de la lista de
  // Quotes. Una clave que ya no exista en el catalogo se descarta en vez de pintar una columna
  // fantasma.
  const [selected, setSelected] = useState(() => {
    if (typeof window === "undefined") return DEFAULT_SELECTED;
    try {
      const saved = JSON.parse(window.localStorage.getItem(STORAGE_KEY));
      if (Array.isArray(saved)) return saved.filter((k) => getReportColumn(k));
    } catch {
      // Modo incognito o almacenamiento lleno: se arranca con las de siempre.
    }
    return DEFAULT_SELECTED;
  });

  useEffect(() => {
    Promise.all([getWorkOrders(), getQuotes()])
      .then(([wo, q]) => {
        setWorkOrders(wo);
        setQuotes(q);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  function updateSelected(next) {
    setSelected(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // La eleccion sigue aplicada en esta pantalla; solo no sobrevive a la recarga.
    }
  }

  function setFilter(field, value) {
    setFilters((prev) => ({ ...prev, [field]: value }));
    setPage(1);
  }

  const quoteById = useMemo(() => new Map(quotes.map((q) => [q.id, q])), [quotes]);

  // La orden con su cotizacion al lado. El upsell y el precio final viven en la cotizacion, asi que
  // sin este cruce medio reporte saldria vacio.
  const joined = useMemo(
    () => workOrders.map((wo) => ({ wo, quote: wo.quoteId ? quoteById.get(wo.quoteId) : null })),
    [workOrders, quoteById]
  );

  const technicians = useMemo(() => {
    const names = new Set();
    workOrders.forEach((w) => {
      if (w.tech) names.add(w.tech);
      (w.extraTechs || []).forEach((x) => x.name && names.add(x.name));
    });
    return [...names].sort((a, b) => a.localeCompare(b));
  }, [workOrders]);

  const filtered = useMemo(() => {
    return joined.filter(({ wo }) => {
      // Se filtra por la fecha de la cita, que es la que la gente tiene en la cabeza cuando pide
      // "lo de marzo". Una orden sin cita solo aparece cuando no hay rango puesto: incluirla en un
      // rango cualquiera seria colar filas que nadie pidio.
      const date = wo.appointmentDate || "";
      if (filters.dateFrom || filters.dateTo) {
        if (!date) return false;
        if (filters.dateFrom && date < filters.dateFrom) return false;
        if (filters.dateTo && date > filters.dateTo) return false;
      }
      if (filters.status && wo.status !== filters.status) return false;
      if (filters.customerType && (wo.workOrderType || "Personal") !== filters.customerType) return false;
      if (filters.technician) {
        const techs = [wo.tech, ...(wo.extraTechs || []).map((x) => x.name)].filter(Boolean);
        if (!techs.includes(filters.technician)) return false;
      }
      return true;
    });
  }, [joined, filters]);

  // Las columnas elegidas, resueltas contra el catalogo: es la misma lista que usan la tabla, el
  // CSV y el Excel, asi que las tres no pueden discrepar.
  const columns = useMemo(
    () => selected.map((key) => getReportColumn(key)).filter(Boolean).map((c) => ({ ...c, label: tcol(c.key) })),
    [selected, tcol]
  );

  // Se calculan las filas de TODO lo filtrado, no solo la pagina visible: lo que se descarga es el
  // reporte entero, y la paginacion es solo para poder mirarlo antes.
  const rows = useMemo(
    () => filtered.map((row) => Object.fromEntries(columns.map((c) => [c.key, getReportValue(c.key, row)]))),
    [filtered, columns]
  );

  const totals = useMemo(() => {
    const moneyKeys = columns.filter((c) => c.type === "money").map((c) => c.key);
    return Object.fromEntries(moneyKeys.map((k) => [k, rows.reduce((sum, r) => sum + Number(r[k] || 0), 0)]));
  }, [columns, rows]);

  const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const pageRows = rows.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  function handleExportCsv() {
    downloadBlob(new Blob([buildCsv(columns, rows)], { type: "text/csv;charset=utf-8;" }), "detailed-report.csv");
  }

  async function handleExportXlsx() {
    setExporting("xlsx");
    setError("");
    try {
      const blob = await exportDetailedReportXlsx({
        columns: columns.map((c) => ({ key: c.key, label: c.label, type: c.type })),
        rows,
        sheetName: t("title"),
      });
      downloadBlob(blob, "detailed-report.xlsx");
    } catch (e) {
      setError(e.message);
    } finally {
      setExporting("");
    }
  }

  const noColumns = columns.length === 0;
  const filterClass =
    "border border-slate-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none";

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-2xl font-semibold dark:text-gray-100 tracking-tight">{tr("title")}</h1>
        <div className="flex gap-2">
          <button
            onClick={handleExportCsv}
            disabled={noColumns || !rows.length}
            className="border border-slate-200 dark:border-gray-700 dark:text-gray-100 text-slate-600 text-sm font-medium rounded-lg px-4 py-2 hover:bg-slate-50 dark:hover:bg-gray-800 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {t("exportCsv")}
          </button>
          <button
            onClick={handleExportXlsx}
            disabled={noColumns || !rows.length || !!exporting}
            className="bg-green-600 hover:bg-green-700 text-white text-sm font-semibold rounded-lg px-4 py-2 transition-colors shadow-sm disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {exporting === "xlsx" ? t("exporting") : t("exportExcel")}
          </button>
        </div>
      </div>

      <ReportsTabs active="detailed" />

      {error && <p className="text-red-600 dark:text-red-400 text-sm">{error}</p>}

      <div className="bg-white dark:bg-gray-900 dark:border dark:border-gray-800 rounded-xl shadow-sm p-4 space-y-4">
        <div className="flex flex-wrap items-end gap-4">
          <div>
            <label htmlFor="dr-from" className="block text-xs mb-1 text-slate-500 dark:text-gray-400">{tr("dateFrom")}</label>
            <input id="dr-from" type="date" value={filters.dateFrom} onChange={(e) => setFilter("dateFrom", e.target.value)} className={filterClass} />
          </div>
          <div>
            <label htmlFor="dr-to" className="block text-xs mb-1 text-slate-500 dark:text-gray-400">{tr("dateTo")}</label>
            <input id="dr-to" type="date" value={filters.dateTo} onChange={(e) => setFilter("dateTo", e.target.value)} className={filterClass} />
          </div>
          <div>
            <label htmlFor="dr-status" className="block text-xs mb-1 text-slate-500 dark:text-gray-400">{tw("status")}</label>
            <select id="dr-status" value={filters.status} onChange={(e) => setFilter("status", e.target.value)} className={`${filterClass} min-w-[150px]`}>
              <option value="">{t("allStatuses")}</option>
              {WORK_ORDER_STATUSES.map((s) => <option key={s} value={s}>{tw(`statuses.${s}`)}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="dr-type" className="block text-xs mb-1 text-slate-500 dark:text-gray-400">{t("customerType")}</label>
            <select id="dr-type" value={filters.customerType} onChange={(e) => setFilter("customerType", e.target.value)} className={`${filterClass} min-w-[150px]`}>
              <option value="">{t("allCustomerTypes")}</option>
              <option value="Personal">{t("personal")}</option>
              <option value="Insurance">{t("insurance")}</option>
            </select>
          </div>
          <div>
            <label htmlFor="dr-tech" className="block text-xs mb-1 text-slate-500 dark:text-gray-400">{tr("technician")}</label>
            <select id="dr-tech" value={filters.technician} onChange={(e) => setFilter("technician", e.target.value)} className={`${filterClass} min-w-[170px]`}>
              <option value="">{t("allTechnicians")}</option>
              {technicians.map((name) => <option key={name} value={name}>{name}</option>)}
            </select>
          </div>
          <button
            type="button"
            onClick={() => { setFilters({ dateFrom: "", dateTo: "", status: "", customerType: "", technician: "" }); setPage(1); }}
            className="text-sm text-slate-500 dark:text-gray-400 hover:underline pb-2"
          >
            {t("clearFilters")}
          </button>
        </div>

        <div className="pt-4 border-t dark:border-gray-800">
          <ReportColumnPicker selected={selected} onChange={updateSelected} defaults={DEFAULT_SELECTED} />
        </div>
      </div>

      <div className="bg-white dark:bg-gray-900 dark:border dark:border-gray-800 rounded-xl shadow-sm overflow-hidden">
        <div className="flex items-center justify-between flex-wrap gap-2 p-4 pb-3 border-b dark:border-gray-800">
          <h2 className="font-semibold text-slate-800 dark:text-gray-100">{t("preview")}</h2>
          <span className="text-sm text-slate-500 dark:text-gray-400">
            {t("rowCount", { count: rows.length })}
          </span>
        </div>

        {loading ? (
          <p className="p-4 text-sm text-slate-500">{t("loading")}</p>
        ) : noColumns ? (
          <p className="p-4 text-sm text-slate-500">{t("noColumns")}</p>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left border-b border-slate-100 dark:border-gray-800 text-slate-400 dark:text-gray-500">
                    {columns.map((c) => (
                      <th key={c.key} className={`p-3 font-medium whitespace-nowrap ${c.type === "money" ? "text-right" : ""}`}>{c.label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {pageRows.map((row, i) => (
                    <tr key={i} className={`border-b last:border-0 border-slate-50 dark:border-gray-800/60 hover:bg-blue-50/50 dark:hover:bg-gray-800/40 transition-colors ${i % 2 === 1 ? "bg-slate-50/60 dark:bg-gray-800/20" : ""}`}>
                      {columns.map((c) => (
                        <td key={c.key} className={`p-3 whitespace-nowrap text-slate-700 dark:text-gray-200 ${c.type === "money" ? "text-right tabular-nums" : ""}`}>
                          {c.key === "status" ? <WorkOrderStatusBadge status={row[c.key]} /> : c.type === "money" ? money(row[c.key]) : row[c.key]}
                        </td>
                      ))}
                    </tr>
                  ))}
                  {rows.length === 0 && (
                    <tr><td className="p-4 text-slate-400" colSpan={columns.length}>{tr("noData")}</td></tr>
                  )}
                </tbody>
                {/* Los totales son de TODO lo filtrado, no de la pagina: es la cifra que se va a
                    descargar, y cuadrarla contra el archivo es justo para lo que sirve mirar antes. */}
                {rows.length > 0 && Object.keys(totals).length > 0 && (
                  <tfoot>
                    <tr className="border-t-2 border-slate-200 dark:border-gray-700 font-semibold text-slate-800 dark:text-gray-100">
                      {columns.map((c, i) => (
                        <td key={c.key} className={`p-3 whitespace-nowrap ${c.type === "money" ? "text-right tabular-nums" : ""}`}>
                          {c.type === "money" ? money(totals[c.key]) : i === 0 ? t("totalRow") : ""}
                        </td>
                      ))}
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>

            {pageCount > 1 && (
              <div className="flex items-center justify-between gap-3 p-3 border-t dark:border-gray-800">
                <button
                  type="button"
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={currentPage === 1}
                  className="border border-slate-200 dark:border-gray-700 dark:text-gray-100 rounded-lg px-3 py-1.5 text-sm disabled:opacity-40 disabled:cursor-not-allowed hover:bg-slate-50 dark:hover:bg-gray-800 transition-colors"
                >
                  {t("previous")}
                </button>
                <span className="text-sm text-slate-500 dark:text-gray-400">{t("pageOf", { page: currentPage, total: pageCount })}</span>
                <button
                  type="button"
                  onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
                  disabled={currentPage === pageCount}
                  className="border border-slate-200 dark:border-gray-700 dark:text-gray-100 rounded-lg px-3 py-1.5 text-sm disabled:opacity-40 disabled:cursor-not-allowed hover:bg-slate-50 dark:hover:bg-gray-800 transition-colors"
                >
                  {t("next")}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
