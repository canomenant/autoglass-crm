"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { getProfitLossMatrixReport } from "@/lib/api";
import ReportsTabs from "@/components/ReportsTabs";

function money(n) {
  return `$${Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function moneyNeg(n) {
  return `(${money(n)})`;
}

function pct(n) {
  return `${Number(n || 0).toFixed(1)}%`;
}

function csvEscape(v) {
  return `"${String(v ?? "").replace(/"/g, '""')}"`;
}

function KpiCard({ label, value, sub, tone }) {
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
      {sub && <div className="text-xs text-slate-400 dark:text-gray-500 mt-1">{sub}</div>}
    </div>
  );
}

// One <td> of the matrix. Cells with money in them are clickable — they open the drill-down modal
// with the exact work orders / expenses that make up that number, capped server-side like the
// existing /profit-loss breakdown. Zero-amount cells render as a plain dash, since there's nothing
// to drill into (buildMatrixCategory on the backend never populates an empty cell's item list).
function Cell({ amount, onClick, muted, deduction }) {
  if (!amount) return <td className="py-2 px-3 text-right text-slate-300 dark:text-gray-700">—</td>;
  const text = deduction ? moneyNeg(amount) : money(amount);
  return (
    <td className="py-2 px-3 text-right tabular-nums">
      <button
        type="button"
        onClick={onClick}
        className={`hover:underline decoration-dotted underline-offset-2 ${muted || deduction ? "text-slate-400 dark:text-gray-500 italic" : "text-slate-700 dark:text-gray-200"}`}
      >
        {text}
      </button>
    </td>
  );
}

function MatrixRow({ row, label, months, showNoDate, onCellClick, muted, deduction, indent }) {
  const labelClass = muted || deduction ? "text-slate-400 dark:text-gray-500 italic" : "text-slate-700 dark:text-gray-200";
  return (
    <tr className="border-b last:border-0 border-slate-50 dark:border-gray-800/60 hover:bg-blue-50/30 dark:hover:bg-gray-800/30 transition-colors">
      <td className={`py-2 pr-3 whitespace-nowrap ${indent ? "pl-6" : "pl-3"} ${labelClass}`}>{label}</td>
      {months.map((_, i) => (
        <Cell key={i} amount={row.monthly[i]} onClick={() => onCellClick(row, i, months[i])} muted={muted} deduction={deduction} />
      ))}
      {showNoDate && <Cell amount={row.noDate} onClick={() => onCellClick(row, null, null)} muted={muted} deduction={deduction} />}
      <td className={`py-2 pl-3 text-right font-semibold whitespace-nowrap tabular-nums ${muted || deduction ? "text-slate-500 dark:text-gray-400 italic" : "text-slate-800 dark:text-gray-100"}`}>
        {deduction ? moneyNeg(row.total) : money(row.total)}
      </td>
    </tr>
  );
}

// Subtotales del estado (cobros brutos, ingreso neto, utilidad bruta, utilidad neta): sin drill,
// en negrita y con línea arriba, como en el formato impreso del contador.
function SubtotalRow({ label, monthly, noDate, total, months, showNoDate, strong, tone }) {
  const color = (v) => (tone === "profit" ? (v >= 0 ? "text-green-700 dark:text-green-400" : "text-red-600 dark:text-red-400") : "text-slate-900 dark:text-gray-100");
  return (
    <tr className={`border-t ${strong ? "border-slate-300 dark:border-gray-600 bg-slate-50/60 dark:bg-gray-800/40" : "border-slate-200 dark:border-gray-700"}`}>
      <td className={`py-2 pl-3 pr-3 whitespace-nowrap ${strong ? "font-semibold uppercase tracking-wide text-xs" : "font-medium"} text-slate-800 dark:text-gray-100`}>{label}</td>
      {monthly.map((v, i) => (
        <td key={i} className={`py-2 px-3 text-right font-semibold tabular-nums ${color(v)}`}>{v ? money(v) : "—"}</td>
      ))}
      {showNoDate && <td className={`py-2 px-3 text-right font-semibold tabular-nums ${color(noDate)}`}>{noDate ? money(noDate) : "—"}</td>}
      <td className={`py-2 pl-3 text-right font-bold whitespace-nowrap tabular-nums ${color(total)}`}>{money(total)}</td>
    </tr>
  );
}

function SectionRow({ title, colSpan }) {
  return (
    <tr>
      <td colSpan={colSpan} className="pt-4 pb-1 pl-3 text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-gray-400">{title}</td>
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
                      <td className="py-1.5 pr-0 text-right text-slate-700 dark:text-gray-200 tabular-nums">{money(item.amount)}</td>
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

  const [year, setYear] = useState("");
  const [state, setState] = useState("");
  const [cardFeePercent, setCardFeePercent] = useState("3");
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [drillTarget, setDrillTarget] = useState(null);

  useEffect(() => {
    getProfitLossMatrixReport({ year, state, cardFeePercent }).then(setData).catch((e) => setError(e.message));
  }, [year, state, cardFeePercent]);

  const months = t.raw("months");
  const showNoDate = !year;
  const colSpan = 1 + months.length + (showNoDate ? 1 : 0) + 1;

  // El estado de resultados en filas: composición de ingresos → cobros brutos → menos sales tax
  // (con su desglose por estado) → ingreso neto → costo de ventas → utilidad bruta → gastos
  // operativos → utilidad neta. Las etiquetas de categorías se comparten con el P&L simple.
  const sections = useMemo(() => {
    if (!data) return null;
    const k = data.kpis;
    const salesTax = data.revenueBreakdown.find((r) => r.key === "salesTax");
    const stateLabel = (key) => (key === "none" ? t("stateNone") : key);
    return {
      revenueRows: data.revenueBreakdown.map((row) => ({ row, label: tpl(`revenueCategories.${row.key}`) })),
      gross: { monthly: k.revenueMonthly, noDate: k.revenueNoDate, total: k.revenueTotal },
      salesTax: salesTax ? { row: salesTax, label: t("lessSalesTaxRow") } : null,
      salesTaxByState: (data.salesTaxByState || []).map((row) => ({ row, label: t("salesTaxStateRow", { state: stateLabel(row.key) }) })),
      net: { monthly: k.netRevenueMonthly, noDate: k.netRevenueNoDate, total: k.netRevenueTotal },
      costOfSalesRows: data.costBreakdown.filter((r) => r.group === "costOfSales").map((row) => ({ row, label: tpl(`costCategories.${row.key}`) })),
      grossProfit: { monthly: k.grossProfitMonthly, noDate: k.grossProfitNoDate, total: k.grossProfitTotal },
      operatingRows: data.costBreakdown.filter((r) => r.group === "operating").map((row) => ({ row, label: tpl(`costCategories.${row.key}`) })),
      netProfit: { monthly: k.profitMonthly, noDate: k.profitNoDate, total: k.profitTotal },
    };
  }, [data, t, tpl]);

  function openDrill(row, label, monthIndex, monthLabel) {
    const cell = monthIndex === null ? row.noDateCell : row.cells[monthIndex];
    setDrillTarget({ label, monthLabel: monthLabel || t("noDateColumn"), cell });
  }

  function handleExportCsv() {
    if (!data || !sections) return;
    const header = ["Category", ...months, ...(showNoDate ? [t("noDateColumn")] : []), t("totalColumn")];
    const rows = [header];
    const line = (label, monthly, noDate, total, sign = 1) => rows.push([label, ...monthly.map((v) => (sign * v).toFixed(2)), ...(showNoDate ? [(sign * noDate).toFixed(2)] : []), (sign * total).toFixed(2)]);
    const cat = ({ row, label }, sign = 1) => line(label, row.monthly, row.noDate, row.total, sign);
    sections.revenueRows.forEach((r) => cat(r));
    line(t("grossCollectionsRow"), sections.gross.monthly, sections.gross.noDate, sections.gross.total);
    if (sections.salesTax) cat(sections.salesTax, -1);
    sections.salesTaxByState.forEach((r) => cat({ ...r, label: `  ${r.label}` }, -1));
    line(t("netRevenueRow"), sections.net.monthly, sections.net.noDate, sections.net.total);
    sections.costOfSalesRows.forEach((r) => cat(r));
    line(t("grossProfitRow"), sections.grossProfit.monthly, sections.grossProfit.noDate, sections.grossProfit.total);
    sections.operatingRows.forEach((r) => cat(r));
    line(t("netProfitRow"), sections.netProfit.monthly, sections.netProfit.noDate, sections.netProfit.total);
    cat({ row: data.chargebacks, label: t("chargebacksRow") });
    rows.push([]);
    rows.push(["KPI", "Value"]);
    rows.push([tpl("grossCollections"), data.kpis.revenueTotal.toFixed(2)]);
    rows.push([tpl("salesTaxCollected"), data.kpis.salesTaxTotal.toFixed(2)]);
    rows.push([tpl("netRevenue"), data.kpis.netRevenueTotal.toFixed(2)]);
    rows.push([tpl("grossProfit"), data.kpis.grossProfitTotal.toFixed(2)]);
    rows.push([tpl("grossMargin"), data.kpis.grossMarginPercent.toFixed(2)]);
    rows.push([tpl("netProfit"), data.kpis.profitTotal.toFixed(2)]);
    rows.push([tpl("netMargin"), data.kpis.marginPercent.toFixed(2)]);
    rows.push([t("cardFeeRate"), String(data.kpis.cardFeePercent)]);
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

      <ReportsTabs active="matrix" />

      <div className="bg-white dark:bg-gray-900 dark:border dark:border-gray-800 rounded-xl shadow-sm p-4 flex flex-wrap items-end gap-4 print:hidden">
        <div>
          <label htmlFor="plm-year" className="block text-xs mb-1 text-slate-500 dark:text-gray-400">{t("year")}</label>
          <select id="plm-year" value={year} onChange={(e) => setYear(e.target.value)} className={`${inputClass} min-w-[140px]`}>
            <option value="">{t("allYears")}</option>
            {(data?.availableYears || []).map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="plm-state" className="block text-xs mb-1 text-slate-500 dark:text-gray-400">{t("state")}</label>
          <select id="plm-state" value={state} onChange={(e) => setState(e.target.value)} className={`${inputClass} min-w-[140px]`}>
            <option value="">{t("allStates")}</option>
            <option value="CA">CA</option>
            <option value="TX">TX</option>
          </select>
        </div>
        <div>
          <label htmlFor="plm-card-fee" className="block text-xs mb-1 text-slate-500 dark:text-gray-400">{t("cardFeeRate")}</label>
          <input id="plm-card-fee" type="number" min="0" max="15" step="0.1" value={cardFeePercent} onChange={(e) => setCardFeePercent(e.target.value)} className={`${inputClass} w-24`} />
        </div>
      </div>

      <div className="hidden print:block">
        <h1 className="text-xl font-bold">{t("title")}</h1>
        <p className="text-sm text-gray-500">
          {year || t("allYears")} · {state || t("allStates")} · {t("cardFeeRate")} {data?.kpis.cardFeePercent ?? cardFeePercent}
        </p>
      </div>

      {!data || !sections ? (
        <p className="text-slate-400 text-sm">…</p>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <KpiCard label={tpl("grossCollections")} value={money(data.kpis.revenueTotal)} tone="revenue" />
            <KpiCard label={tpl("netRevenue")} value={money(data.kpis.netRevenueTotal)} sub={`${tpl("salesTaxCollected")}: ${money(data.kpis.salesTaxTotal)}`} tone="revenue" />
            <KpiCard label={tpl("grossProfit")} value={money(data.kpis.grossProfitTotal)} sub={`${tpl("grossMargin")} ${pct(data.kpis.grossMarginPercent)}`} tone={data.kpis.grossProfitTotal >= 0 ? "profit" : "loss"} />
            <KpiCard label={tpl("netProfit")} value={money(data.kpis.profitTotal)} sub={`${tpl("netMargin")} ${pct(data.kpis.marginPercent)}`} tone={data.kpis.profitTotal >= 0 ? "profit" : "loss"} />
          </div>

          {state && (
            <p className="text-xs text-slate-400 dark:text-gray-500 italic print:hidden">{t("operatingExpensesStateNote")}</p>
          )}

          <div className="bg-white dark:bg-gray-900 dark:border dark:border-gray-800 rounded-xl shadow-sm p-4 overflow-x-auto print:shadow-none print:border">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left border-b border-slate-100 dark:border-gray-800 text-slate-400 dark:text-gray-500">
                  <th className="py-2 pl-3 pr-3 font-medium">{t("category")}</th>
                  {months.map((m) => <th key={m} className="py-2 px-3 font-medium text-right">{m}</th>)}
                  {showNoDate && <th className="py-2 px-3 font-medium text-right">{t("noDateColumn")}</th>}
                  <th className="py-2 pl-3 font-medium text-right">{t("totalColumn")}</th>
                </tr>
              </thead>
              <tbody>
                <SectionRow title={t("sectionRevenue")} colSpan={colSpan} />
                {sections.revenueRows.map(({ row, label }) => (
                  <MatrixRow key={row.key} row={row} label={label} months={months} showNoDate={showNoDate} onCellClick={(r, i, m) => openDrill(r, label, i, m)} />
                ))}
                <SubtotalRow label={t("grossCollectionsRow")} {...sections.gross} months={months} showNoDate={showNoDate} />
                {sections.salesTax && (
                  <MatrixRow row={sections.salesTax.row} label={sections.salesTax.label} months={months} showNoDate={showNoDate} onCellClick={(r, i, m) => openDrill(r, sections.salesTax.label, i, m)} deduction />
                )}
                {sections.salesTaxByState.map(({ row, label }) => (
                  <MatrixRow key={`st-${row.key}`} row={row} label={label} months={months} showNoDate={showNoDate} onCellClick={(r, i, m) => openDrill(r, label, i, m)} muted indent />
                ))}
                <SubtotalRow label={t("netRevenueRow")} {...sections.net} months={months} showNoDate={showNoDate} strong />

                <SectionRow title={t("sectionCostOfSales")} colSpan={colSpan} />
                {sections.costOfSalesRows.map(({ row, label }) => (
                  <MatrixRow key={row.key} row={row} label={label} months={months} showNoDate={showNoDate} onCellClick={(r, i, m) => openDrill(r, label, i, m)} />
                ))}
                <SubtotalRow label={t("grossProfitRow")} {...sections.grossProfit} months={months} showNoDate={showNoDate} strong tone="profit" />

                {sections.operatingRows.length > 0 && (
                  <>
                    <SectionRow title={t("sectionOperating")} colSpan={colSpan} />
                    {sections.operatingRows.map(({ row, label }) => (
                      <MatrixRow key={row.key} row={row} label={label} months={months} showNoDate={showNoDate} onCellClick={(r, i, m) => openDrill(r, label, i, m)} />
                    ))}
                  </>
                )}
                <SubtotalRow label={t("netProfitRow")} {...sections.netProfit} months={months} showNoDate={showNoDate} strong tone="profit" />

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
            <p className="text-xs text-slate-400 dark:text-gray-500 mt-1">{tpl("cardFeeNote", { percent: data.kpis.cardFeePercent })}</p>
          </div>
        </>
      )}

      <CellDrillModal target={drillTarget} onClose={() => setDrillTarget(null)} t={t} />
    </div>
  );
}
