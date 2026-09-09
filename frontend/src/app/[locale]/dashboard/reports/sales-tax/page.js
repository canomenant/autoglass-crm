"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { getSalesTaxReport } from "@/lib/api";
import ReportsTabs from "@/components/ReportsTabs";

function money(n) {
  return `$${Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function pct(n) {
  return `${Number(n || 0).toFixed(2)}%`;
}

function csvEscape(v) {
  return `"${String(v ?? "").replace(/"/g, '""')}"`;
}

function KpiCard({ label, value, sub, tone }) {
  const toneClass = tone === "primary" ? "text-blue-600 dark:text-blue-400" : "text-slate-800 dark:text-gray-100";
  return (
    <div className="bg-white dark:bg-gray-900 dark:border dark:border-gray-800 rounded-xl shadow-sm p-4 print:shadow-none print:border">
      <div className="text-xs text-slate-500 dark:text-gray-400 uppercase tracking-wide">{label}</div>
      <div className={`text-2xl font-bold mt-1 tabular-nums ${toneClass}`}>{value}</div>
      {sub && <div className="text-xs text-slate-400 dark:text-gray-500 mt-1">{sub}</div>}
    </div>
  );
}

// Una celda de la tabla: órdenes · base gravable · impuesto. El impuesto es clicable para ver qué
// órdenes lo componen, igual que en la matriz.
function StateCells({ cell, onClick, muted }) {
  const empty = !cell.orders;
  const dash = <span className="text-slate-300 dark:text-gray-700">—</span>;
  return (
    <>
      <td className="py-2 px-2 text-right tabular-nums text-slate-500 dark:text-gray-400 border-l border-slate-100 dark:border-gray-800">{empty ? dash : cell.orders}</td>
      <td className="py-2 px-2 text-right tabular-nums text-slate-600 dark:text-gray-300">{empty ? dash : money(cell.taxableBase)}</td>
      <td className="py-2 px-2 text-right tabular-nums text-slate-400 dark:text-gray-500">{empty ? dash : money(cell.nonTaxable)}</td>
      <td className={`py-2 px-2 text-right tabular-nums font-medium ${muted ? "text-slate-500 dark:text-gray-400" : "text-slate-800 dark:text-gray-100"}`}>
        {empty ? dash : onClick ? (
          <button type="button" onClick={onClick} className="hover:underline decoration-dotted underline-offset-2">{money(cell.tax)}</button>
        ) : money(cell.tax)}
      </td>
    </>
  );
}

function CellDrillModal({ target, onClose, t }) {
  if (!target) return null;
  const { stateLabel, monthLabel, cell } = target;
  const items = cell.items || [];
  return (
    <div className="fixed inset-0 bg-slate-900/50 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white dark:bg-gray-900 dark:border dark:border-gray-800 rounded-2xl shadow-2xl w-full max-w-2xl flex flex-col overflow-hidden max-h-[80vh]" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-5 border-b border-slate-100 dark:border-gray-800">
          <div>
            <h2 className="font-semibold text-lg dark:text-gray-100">{t("cellDetailTitle", { state: stateLabel, month: monthLabel })}</h2>
            <p className="text-xs text-slate-500 dark:text-gray-400 mt-0.5">
              {cell.orders} {t("orders").toLowerCase()} · {t("taxableBase")} {money(cell.taxableBase)} · {t("nonTaxable")} {money(cell.nonTaxable)} · {t("taxCollected")} <strong>{money(cell.tax)}</strong> · {t("effectiveRate")} {pct(cell.effectiveRate)}
            </p>
          </div>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 text-xl leading-none">&times;</button>
        </div>
        <div className="overflow-y-auto p-6">
          {items.length === 0 ? (
            <p className="text-sm text-slate-400">{t("noItems")}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-slate-400 dark:text-gray-500">
                    <th className="py-1 pr-3 font-medium">{t("workOrder")}</th>
                    <th className="py-1 pr-3 font-medium">{t("customer")}</th>
                    <th className="py-1 pr-3 font-medium">{t("date")}</th>
                    <th className="py-1 pr-3 font-medium text-right">{t("rate")}</th>
                    <th className="py-1 pr-3 font-medium text-right">{t("taxableBase")}</th>
                    <th className="py-1 pr-3 font-medium text-right">{t("nonTaxable")}</th>
                    <th className="py-1 pr-0 font-medium text-right">{t("amount")}</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => (
                    <tr key={item.id} className="border-t border-slate-50 dark:border-gray-800/60">
                      <td className="py-1.5 pr-3">
                        <Link href={`/dashboard/workorders/${item.id}`} className="text-blue-600 dark:text-blue-400 hover:underline">{item.workOrderNo}</Link>
                      </td>
                      <td className="py-1.5 pr-3 text-slate-600 dark:text-gray-300">{item.customerName}</td>
                      <td className="py-1.5 pr-3 text-slate-500 dark:text-gray-400 whitespace-nowrap">{item.date}</td>
                      <td className="py-1.5 pr-3 text-right tabular-nums text-slate-500 dark:text-gray-400">{item.taxRate}%</td>
                      <td className="py-1.5 pr-3 text-right tabular-nums text-slate-600 dark:text-gray-300">{money(item.taxableBase)}</td>
                      <td className="py-1.5 pr-3 text-right tabular-nums text-slate-400 dark:text-gray-500">{money(item.nonTaxable)}</td>
                      <td className="py-1.5 pr-0 text-right tabular-nums text-slate-800 dark:text-gray-100 font-medium">{money(item.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {cell.totalCount > items.length && (
                <p className="text-xs text-slate-400 mt-2">{t("showingTopN", { shown: items.length, total: cell.totalCount })}</p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function SalesTaxReportPage() {
  const t = useTranslations("salesTaxReport");
  const tc = useTranslations("common");

  const [year, setYear] = useState(() => String(new Date().getFullYear()));
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [drillTarget, setDrillTarget] = useState(null);

  useEffect(() => {
    getSalesTaxReport({ year }).then(setData).catch((e) => setError(e.message));
  }, [year]);

  const months = t.raw("months");
  const stateLabel = (s) => (s === "none" ? t("stateNone") : s);
  // Los estados sin un centavo en el año no ocupan columnas.
  const states = data ? data.states.filter((s) => data.totals[s].orders || data.noDate[s].orders) : [];
  const showNoDate = data ? Object.values(data.noDate).some((c) => c.orders) : false;

  function handleExportCsv() {
    if (!data) return;
    const header = [t("month")];
    for (const s of [...states, "all"]) {
      const label = s === "all" ? t("allStates") : stateLabel(s);
      header.push(`${label} ${t("orders")}`, `${label} ${t("taxableBase")}`, `${label} ${t("nonTaxable")}`, `${label} ${t("taxCollected")}`);
    }
    const rows = [header];
    const line = (label, row) => rows.push([label, ...[...states, "all"].flatMap((s) => [row[s].orders, row[s].taxableBase.toFixed(2), row[s].nonTaxable.toFixed(2), row[s].tax.toFixed(2)])]);
    data.months.forEach((row, i) => line(months[i], row));
    if (showNoDate) line(t("noDateRow"), data.noDate);
    line(t("annualTotal"), data.totals);
    const csv = rows.map((r) => r.map(csvEscape).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `sales-tax_${year || "all-years"}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  if (error) return <p className="text-red-600 dark:text-red-400 text-sm">{error}</p>;

  const inputClass = "border border-slate-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none";

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3 print:hidden">
        <h1 className="text-2xl font-semibold dark:text-gray-100 tracking-tight">{t("title")}</h1>
        <div className="flex gap-2">
          <button type="button" onClick={handleExportCsv} className="border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-4 py-2 text-sm transition-colors hover:bg-gray-50 dark:hover:bg-gray-700">
            {t("exportCsv")}
          </button>
          <button type="button" onClick={() => window.print()} className="bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg px-4 py-2 transition-colors">
            {t("exportPdf")}
          </button>
        </div>
      </div>

      <ReportsTabs active="salesTax" />

      <div className="bg-white dark:bg-gray-900 dark:border dark:border-gray-800 rounded-xl shadow-sm p-4 flex flex-wrap items-end gap-4 print:hidden">
        <div>
          <label htmlFor="stx-year" className="block text-xs mb-1 text-slate-500 dark:text-gray-400">{t("year")}</label>
          <select id="stx-year" value={year} onChange={(e) => setYear(e.target.value)} className={`${inputClass} min-w-[140px]`}>
            <option value="">{t("allYears")}</option>
            {(data?.availableYears || []).map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>
      </div>

      <div className="hidden print:block">
        <h1 className="text-xl font-bold">{t("title")}</h1>
        <p className="text-sm text-gray-500">{year || t("allYears")}</p>
      </div>

      {!data ? (
        <p className="text-slate-400 text-sm">{tc("loading")}</p>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <KpiCard label={t("kpiTotal")} value={money(data.totals.all.tax)} sub={`${t("taxableBase")}: ${money(data.totals.all.taxableBase)} · ${t("nonTaxable")}: ${money(data.totals.all.nonTaxable)}`} tone="primary" />
            {states.filter((s) => s !== "none").map((s) => (
              <KpiCard key={s} label={t("kpiState", { state: s })} value={money(data.totals[s].tax)} sub={`${data.totals[s].orders} ${t("orders").toLowerCase()} · ${t("effectiveRate")} ${pct(data.totals[s].effectiveRate)}`} />
            ))}
            <KpiCard label={t("kpiRate")} value={pct(data.totals.all.effectiveRate)} sub={`${data.totals.all.orders} ${t("kpiOrders").toLowerCase()}`} />
          </div>

          <div className="bg-white dark:bg-gray-900 dark:border dark:border-gray-800 rounded-xl shadow-sm p-4 overflow-x-auto print:shadow-none print:border">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left border-b border-slate-100 dark:border-gray-800 text-slate-500 dark:text-gray-400">
                  <th className="py-2 pl-3 pr-3 font-medium" rowSpan={2}>{t("month")}</th>
                  {states.map((s) => (
                    <th key={s} colSpan={4} className="py-1.5 px-2 font-semibold text-center border-l border-slate-100 dark:border-gray-800 text-slate-700 dark:text-gray-200">{stateLabel(s)}</th>
                  ))}
                  <th colSpan={4} className="py-1.5 px-2 font-semibold text-center border-l border-slate-200 dark:border-gray-700 text-slate-800 dark:text-gray-100 bg-slate-50/60 dark:bg-gray-800/40">{t("allStates")}</th>
                </tr>
                <tr className="text-left border-b border-slate-100 dark:border-gray-800 text-slate-400 dark:text-gray-500 text-xs">
                  {[...states, "all"].map((s) => (
                    <SubHeader key={s} t={t} strong={s === "all"} />
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.months.map((row, i) => (
                  <tr key={i} className="border-b last:border-0 border-slate-50 dark:border-gray-800/60 hover:bg-blue-50/30 dark:hover:bg-gray-800/30 transition-colors">
                    <td className="py-2 pl-3 pr-3 whitespace-nowrap text-slate-700 dark:text-gray-200">{months[i]}</td>
                    {states.map((s) => (
                      <StateCells key={s} cell={row[s]} onClick={() => setDrillTarget({ stateLabel: stateLabel(s), monthLabel: months[i], cell: row[s] })} />
                    ))}
                    <StateCells cell={row.all} />
                  </tr>
                ))}
                {showNoDate && (
                  <tr className="border-b border-slate-50 dark:border-gray-800/60">
                    <td className="py-2 pl-3 pr-3 whitespace-nowrap text-slate-400 dark:text-gray-500 italic">{t("noDateRow")}</td>
                    {states.map((s) => (
                      <StateCells key={s} cell={data.noDate[s]} muted onClick={() => setDrillTarget({ stateLabel: stateLabel(s), monthLabel: t("noDateRow"), cell: data.noDate[s] })} />
                    ))}
                    <StateCells cell={data.noDate.all} muted />
                  </tr>
                )}
                <tr className="border-t-2 border-slate-300 dark:border-gray-600 bg-slate-50/60 dark:bg-gray-800/40 font-semibold">
                  <td className="py-2.5 pl-3 pr-3 whitespace-nowrap uppercase tracking-wide text-xs text-slate-800 dark:text-gray-100">{t("annualTotal")}</td>
                  {states.map((s) => (
                    <StateCells key={s} cell={data.totals[s]} onClick={() => setDrillTarget({ stateLabel: stateLabel(s), monthLabel: year || t("allYears"), cell: data.totals[s] })} />
                  ))}
                  <StateCells cell={data.totals.all} />
                </tr>
                <tr className="text-xs text-slate-400 dark:text-gray-500">
                  <td className="py-1.5 pl-3 pr-3">{t("effectiveRate")}</td>
                  {[...states, "all"].map((s) => (
                    <td key={s} colSpan={4} className="py-1.5 px-2 text-right tabular-nums border-l border-slate-100 dark:border-gray-800">{data.totals[s].orders ? pct(data.totals[s].effectiveRate) : "—"}</td>
                  ))}
                </tr>
              </tbody>
            </table>
            <p className="text-xs text-slate-400 dark:text-gray-500 mt-3 leading-snug">{t("note")}</p>
          </div>
        </>
      )}

      <CellDrillModal target={drillTarget} onClose={() => setDrillTarget(null)} t={t} />
    </div>
  );
}

function SubHeader({ t, strong }) {
  const cls = `py-1 px-2 font-medium text-right ${strong ? "bg-slate-50/60 dark:bg-gray-800/40" : ""}`;
  return (
    <>
      <th className={`${cls} border-l ${strong ? "border-slate-200 dark:border-gray-700" : "border-slate-100 dark:border-gray-800"}`}>{t("orders")}</th>
      <th className={cls}>{t("taxableBase")}</th>
      <th className={cls}>{t("nonTaxable")}</th>
      <th className={cls}>{t("taxCollected")}</th>
    </>
  );
}
