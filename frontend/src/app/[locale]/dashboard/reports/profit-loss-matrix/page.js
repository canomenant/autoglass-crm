"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { getProfitLossMatrixReport } from "@/lib/api";

function money(n) {
  return `$${Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function pct(n) {
  return `${Number(n || 0).toFixed(1)}%`;
}

function csvEscape(v) {
  return `"${String(v ?? "").replace(/"/g, '""')}"`;
}

function KpiCard({ label, value, tone }) {
  const toneClass = {
    revenue: "text-blue-600 dark:text-blue-400",
    cost: "text-slate-700 dark:text-gray-300",
    profit: "text-green-600 dark:text-green-400",
    loss: "text-red-600 dark:text-red-400",
    margin: "text-blue-700 dark:text-blue-400",
  }[tone];
  return (
    <div className="bg-white dark:bg-gray-900 dark:border dark:border-gray-800 rounded-xl shadow-sm p-4 print:shadow-none print:border">
      <div className="text-xs text-slate-500 dark:text-gray-400 uppercase tracking-wide">{label}</div>
      <div className={`text-2xl font-bold mt-1 ${toneClass}`}>{value}</div>
    </div>
  );
}

// One <td> of the matrix. Cells with money in them are clickable — they open the drill-down modal
// with the exact work orders / expenses that make up that number, capped server-side like the
// existing /profit-loss breakdown. Zero-amount cells render as a plain dash, since there's nothing
// to drill into (buildMatrixCategory on the backend never populates an empty cell's item list).
function Cell({ amount, onClick, muted }) {
  if (!amount) return <td className="py-2 px-3 text-right text-slate-300 dark:text-gray-700">—</td>;
  return (
    <td className="py-2 px-3 text-right">
      <button
        type="button"
        onClick={onClick}
        className={`hover:underline decoration-dotted underline-offset-2 ${muted ? "text-slate-400 dark:text-gray-500 italic" : "text-slate-700 dark:text-gray-200"}`}
      >
        {money(amount)}
      </button>
    </td>
  );
}

function MatrixRow({ row, label, months, showNoDate, onCellClick, muted }) {
  return (
    <tr className="border-b last:border-0 border-slate-50 dark:border-gray-800/60 hover:bg-blue-50/30 dark:hover:bg-gray-800/30 transition-colors">
      <td className={`py-2 pr-3 font-medium whitespace-nowrap ${muted ? "text-slate-400 dark:text-gray-500 italic" : "text-slate-700 dark:text-gray-200"}`}>{label}</td>
      {months.map((_, i) => (
        <Cell key={i} amount={row.monthly[i]} onClick={() => onCellClick(row, i, months[i])} muted={muted} />
      ))}
      {showNoDate && <Cell amount={row.noDate} onClick={() => onCellClick(row, null, null)} muted={muted} />}
      <td className={`py-2 pl-3 text-right font-semibold whitespace-nowrap ${muted ? "text-slate-500 dark:text-gray-400 italic" : "text-slate-800 dark:text-gray-100"}`}>{money(row.total)}</td>
    </tr>
  );
}

function CellDrillModal({ target, onClose, t }) {
  if (!target) return null;
  const { label, monthLabel, cell } = target;
  const items = cell.items || [];

  return (
    <div className="fixed inset-0 bg-slate-900/50 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div
        className="bg-white dark:bg-gray-900 dark:border dark:border-gray-800 rounded-2xl shadow-2xl w-full max-w-lg flex flex-col overflow-hidden max-h-[80vh]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 py-5 border-b border-slate-100 dark:border-gray-800">
          <h2 className="font-semibold text-lg dark:text-gray-100">{t("cellDetailTitle", { category: label, month: monthLabel })}</h2>
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
                    <th className="py-1 pr-3 font-medium">{t("category")}</th>
                    <th className="py-1 pr-0 font-medium text-right">{t("amount")}</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => (
                    <tr key={item.id} className="border-t border-slate-50 dark:border-gray-800/60">
                      <td className="py-1.5 pr-3 text-slate-600 dark:text-gray-300">
                        {item.workOrderNo ? (
                          <>
                            <Link href={`/dashboard/workorders/${item.id}`} className="text-blue-600 dark:text-blue-400 hover:underline">
                              {item.workOrderNo}
                            </Link>
                            {item.customerName ? ` — ${item.customerName}` : ""}
                          </>
                        ) : (
                          item.customerName
                        )}
                      </td>
                      <td className="py-1.5 pr-0 text-right text-slate-700 dark:text-gray-200">{money(item.amount)}</td>
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

export default function ProfitLossMatrixPage() {
  const t = useTranslations("profitLossMatrix");
  const tpl = useTranslations("profitLoss");
  const tPartners = useTranslations("partnersReport");
  const tDetailed = useTranslations("detailedReport");

  const [year, setYear] = useState("");
  const [state, setState] = useState("");
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [drillTarget, setDrillTarget] = useState(null);

  useEffect(() => {
    getProfitLossMatrixReport({ year, state }).then(setData).catch((e) => setError(e.message));
  }, [year, state]);

  const months = t.raw("months");
  const showNoDate = !year;

  const allRows = useMemo(() => {
    if (!data) return [];
    return [
      ...data.revenueBreakdown.map((row) => ({ row, label: tpl(`revenueCategories.${row.key}`) })),
      ...data.costBreakdown.map((row) => ({ row, label: tpl(`costCategories.${row.key}`) })),
    ];
  }, [data, tpl]);

  function openDrill(row, label, monthIndex, monthLabel) {
    const cell = monthIndex === null ? row.noDateCell : row.cells[monthIndex];
    setDrillTarget({ label, monthLabel: monthLabel || t("noDateColumn"), cell });
  }

  function handleExportCsv() {
    if (!data) return;
    const header = ["Category", ...months, ...(showNoDate ? [t("noDateColumn")] : []), t("totalColumn")];
    const rows = [header];
    for (const { row, label } of allRows) {
      rows.push([label, ...row.monthly.map((v) => v.toFixed(2)), ...(showNoDate ? [row.noDate.toFixed(2)] : []), row.total.toFixed(2)]);
    }
    rows.push([t("chargebacksRow"), ...data.chargebacks.monthly.map((v) => v.toFixed(2)), ...(showNoDate ? [data.chargebacks.noDate.toFixed(2)] : []), data.chargebacks.total.toFixed(2)]);
    rows.push([]);
    rows.push(["KPI", "Value"]);
    rows.push(["Total Revenue", data.kpis.revenueTotal.toFixed(2)]);
    rows.push(["Total Costs", data.kpis.costsTotal.toFixed(2)]);
    rows.push(["Net Profit", data.kpis.profitTotal.toFixed(2)]);
    rows.push(["Margin %", data.kpis.marginPercent.toFixed(2)]);
    const csv = rows.map((r) => r.map(csvEscape).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `profit-loss-matrix_${year || "all-years"}_${state || "all-states"}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  if (error) return <p className="text-red-600 dark:text-red-400 text-sm">{error}</p>;

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

      <div className="flex items-center gap-4 border-b border-slate-200 dark:border-gray-800 text-sm print:hidden">
        <Link href="/dashboard/reports" className="px-1 py-2 text-gray-500 hover:text-gray-900 dark:hover:text-gray-200">{tpl("overviewTab")}</Link>
        <Link href="/dashboard/reports/profit-loss" className="px-1 py-2 text-gray-500 hover:text-gray-900 dark:hover:text-gray-200">{tpl("profitLossTab")}</Link>
        <span className="px-1 py-2 font-medium text-slate-900 dark:text-gray-100 border-b-2 border-blue-600">{tpl("matrixTab")}</span>
        <Link href="/dashboard/reports/partners" className="px-1 py-2 text-gray-500 hover:text-gray-900 dark:hover:text-gray-200">{tPartners("tab")}</Link>
        <Link href="/dashboard/reports/detailed" className="px-1 py-2 text-gray-500 hover:text-gray-900 dark:hover:text-gray-200">{tDetailed("tab")}</Link>
      </div>

      <div className="bg-white dark:bg-gray-900 dark:border dark:border-gray-800 rounded-xl shadow-sm p-4 flex flex-wrap items-end gap-4 print:hidden">
        <div>
          <label htmlFor="plm-year" className="block text-xs mb-1 text-slate-500 dark:text-gray-400">{t("year")}</label>
          <select id="plm-year" value={year} onChange={(e) => setYear(e.target.value)} className="border border-slate-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none min-w-[140px]">
            <option value="">{t("allYears")}</option>
            {(data?.availableYears || []).map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="plm-state" className="block text-xs mb-1 text-slate-500 dark:text-gray-400">{t("state")}</label>
          <select id="plm-state" value={state} onChange={(e) => setState(e.target.value)} className="border border-slate-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none min-w-[140px]">
            <option value="">{t("allStates")}</option>
            <option value="CA">CA</option>
            <option value="TX">TX</option>
          </select>
        </div>
      </div>

      <div className="hidden print:block">
        <h1 className="text-xl font-bold">{t("title")}</h1>
        <p className="text-sm text-gray-500">
          {year || t("allYears")} · {state || t("allStates")}
        </p>
      </div>

      {!data ? (
        <p className="text-slate-400 text-sm">…</p>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <KpiCard label={tpl("totalRevenue")} value={money(data.kpis.revenueTotal)} tone="revenue" />
            <KpiCard label={tpl("directCosts")} value={money(data.kpis.costsTotal)} tone="cost" />
            <KpiCard label={tpl("netProfit")} value={money(data.kpis.profitTotal)} tone={data.kpis.profitTotal >= 0 ? "profit" : "loss"} />
            <KpiCard label={tpl("marginPercent")} value={pct(data.kpis.marginPercent)} tone="margin" />
          </div>

          {state && (
            <p className="text-xs text-slate-400 dark:text-gray-500 italic print:hidden">{t("operatingExpensesStateNote")}</p>
          )}

          <div className="bg-white dark:bg-gray-900 dark:border dark:border-gray-800 rounded-xl shadow-sm p-4 overflow-x-auto print:shadow-none print:border">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left border-b border-slate-100 dark:border-gray-800 text-slate-400 dark:text-gray-500">
                  <th className="py-2 pr-3 font-medium">{t("category")}</th>
                  {months.map((m) => <th key={m} className="py-2 px-3 font-medium text-right">{m}</th>)}
                  {showNoDate && <th className="py-2 px-3 font-medium text-right">{t("noDateColumn")}</th>}
                  <th className="py-2 pl-3 font-medium text-right">{t("totalColumn")}</th>
                </tr>
              </thead>
              <tbody>
                {allRows.map(({ row, label }) => (
                  <MatrixRow key={row.key} row={row} label={label} months={months} showNoDate={showNoDate} onCellClick={(r, i, m) => openDrill(r, label, i, m)} />
                ))}
                <MatrixRow
                  row={data.chargebacks}
                  label={t("chargebacksRow")}
                  months={months}
                  showNoDate={showNoDate}
                  onCellClick={(r, i, m) => openDrill(r, t("chargebacksRow"), i, m)}
                  muted
                />
              </tbody>
            </table>
            <p className="text-xs text-slate-400 dark:text-gray-500 italic mt-3">{t("chargebacksNote")}</p>
          </div>
        </>
      )}

      <CellDrillModal target={drillTarget} onClose={() => setDrillTarget(null)} t={t} />
    </div>
  );
}
