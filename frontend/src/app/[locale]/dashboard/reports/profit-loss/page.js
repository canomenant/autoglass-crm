"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { getProfitLossReport } from "@/lib/api";
import { ChevronDownIcon, ChevronUpIcon } from "@/components/Icons";
import ReportsTabs from "@/components/ReportsTabs";

function money(n) {
  return `$${Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// Los descuentos y las deducciones van entre paréntesis, como en cualquier estado de resultados.
function moneyNeg(n) {
  return `(${money(n)})`;
}

function pct(n) {
  return `${Number(n || 0).toFixed(1)}%`;
}

function fmt(d) {
  return d.toISOString().slice(0, 10);
}

function presetRange(preset) {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();
  switch (preset) {
    case "today":
      return { dateFrom: fmt(now), dateTo: fmt(now) };
    case "thisMonth":
      return { dateFrom: fmt(new Date(y, m, 1)), dateTo: fmt(new Date(y, m + 1, 0)) };
    case "lastMonth":
      return { dateFrom: fmt(new Date(y, m - 1, 1)), dateTo: fmt(new Date(y, m, 0)) };
    case "thisYear":
      return { dateFrom: fmt(new Date(y, 0, 1)), dateTo: fmt(new Date(y, 11, 31)) };
    default:
      return { dateFrom: "", dateTo: "" };
  }
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

// Un renglón del estado de resultados con su detalle desplegable (órdenes, gastos o ajustes de
// pagos). `deduction` lo pinta entre paréntesis y en gris: es dinero que sale de arriba, no un
// costo. `pctLabel` dice contra qué se mide el porcentaje, porque en ingresos es % del bruto y en
// costos % del ingreso neto.
function StatementRow({ row, label, expanded, toggleExpand, idPrefix, t, tc, deduction }) {
  const key = `${idPrefix}-${row.key}`;
  const isOpen = expanded.has(key);
  const drillItems = row.workOrders || row.items || [];
  // Los renglones que vienen de los pagos (bonos, deducciones, saldos) se leen "Tech-0216 · Cancelled trip · Wo-3325 …".
  const tb = useTranslations("payments.bonusTypes");
  const etiqueta = (item) => item.paymentNumber
    ? [item.paymentNumber, tb.has(item.bonusType) ? tb(item.bonusType) : item.bonusType, item.note].filter(Boolean).join(" · ")
    : item.category;
  // El API manda `items` para todo; lo que distingue una orden de un gasto o un ajuste es que trae
  // workOrderNo. (Antes se miraba `row.workOrders`, que nunca existió, y el detalle de las órdenes
  // salía con las columnas de gasto en blanco.)
  const hasWorkOrders = drillItems.some((i) => i.workOrderNo);
  const hasDetail = drillItems.some((i) => i.detail);
  const amountText = deduction ? moneyNeg(row.amount) : money(row.amount);
  const amountClass = deduction ? "text-slate-500 dark:text-gray-400" : "text-slate-800 dark:text-gray-100";

  return (
    <div className="border-b last:border-0 border-slate-100 dark:border-gray-800">
      <button
        type="button"
        onClick={() => toggleExpand(key)}
        className="w-full flex items-center justify-between gap-3 py-2.5 text-left hover:bg-slate-50 dark:hover:bg-gray-800/40 transition-colors px-2 -mx-2 rounded-lg print:hidden"
      >
        <div className="flex items-center gap-2 min-w-0 pl-3">
          {isOpen ? <ChevronUpIcon className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" /> : <ChevronDownIcon className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />}
          <span className={`truncate ${deduction ? "text-slate-500 dark:text-gray-400 italic" : "text-slate-700 dark:text-gray-200"}`}>{label}</span>
        </div>
        <div className="flex items-center gap-4 flex-shrink-0 text-sm tabular-nums">
          <span className="text-slate-400 dark:text-gray-500 w-14 text-right">{pct(row.percentOfRevenue)}</span>
          <span className={`font-medium w-32 text-right ${amountClass}`}>{amountText}</span>
        </div>
      </button>

      <div className="hidden print:flex items-center justify-between py-1 text-sm pl-3">
        <span className={deduction ? "italic" : ""}>{label}</span>
        <span className="tabular-nums">{amountText} <span className="text-gray-500">({pct(row.percentOfRevenue)})</span></span>
      </div>

      {isOpen && (
        <div className="pb-3 pl-8 print:hidden">
          {row.byState?.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-2">
              {row.byState.map((s) => (
                <span key={s.state} className="text-xs rounded-full bg-slate-100 dark:bg-gray-800 text-slate-600 dark:text-gray-300 px-2.5 py-1">
                  {s.state === "none" ? t("stateNone") : s.state}: <strong>{money(s.amount)}</strong> · {s.count}
                </span>
              ))}
            </div>
          )}
          {row.key === "cardProcessingFees" && (
            <p className="text-xs text-slate-500 dark:text-gray-400 mb-2">
              {t("cardFeesOn", { percent: row.cardFeePercent, amount: money(row.cardCollected), orders: row.cardOrders })}
            </p>
          )}
          {drillItems.length === 0 ? (
            <p className="text-xs text-slate-400">{t("noOrders")}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-slate-400 dark:text-gray-500">
                    {hasWorkOrders ? (
                      <>
                        <th className="py-1 pr-3 font-medium">{t("workOrder")}</th>
                        <th className="py-1 pr-3 font-medium">{t("customer")}</th>
                        {hasDetail && <th className="py-1 pr-3 font-medium">{t("detail")}</th>}
                      </>
                    ) : (
                      <>
                        <th className="py-1 pr-3 font-medium">{tc("category")}</th>
                        <th className="py-1 pr-3 font-medium">{tc("date")}</th>
                      </>
                    )}
                    <th className="py-1 pr-0 font-medium text-right">{tc("amount")}</th>
                  </tr>
                </thead>
                <tbody>
                  {drillItems.map((item) => (
                    <tr key={item.id} className="border-t border-slate-50 dark:border-gray-800/60">
                      {hasWorkOrders ? (
                        <>
                          <td className="py-1.5 pr-3">
                            <Link href={`/dashboard/workorders/${item.id}`} className="text-blue-600 dark:text-blue-400 hover:underline">
                              {item.workOrderNo}
                            </Link>
                          </td>
                          <td className="py-1.5 pr-3 text-slate-600 dark:text-gray-300">{item.customerName}</td>
                          {hasDetail && <td className="py-1.5 pr-3 text-slate-500 dark:text-gray-400">{item.detail}</td>}
                        </>
                      ) : (
                        <>
                          <td className="py-1.5 pr-3 text-slate-600 dark:text-gray-300">{etiqueta(item)}</td>
                          <td className="py-1.5 pr-3 text-slate-600 dark:text-gray-300">{item.date}</td>
                        </>
                      )}
                      <td className="py-1.5 pr-0 text-right text-slate-700 dark:text-gray-200 tabular-nums">{money(item.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {row.totalCount > drillItems.length && (
                <p className="text-xs text-slate-400 mt-2">{t("showingTopN", { shown: drillItems.length, total: row.totalCount })}</p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// Subtotales del estado: Cobros brutos, Ingreso neto, Utilidad bruta, Utilidad neta.
function SubtotalRow({ label, amount, percent, strong, tone }) {
  const toneClass = tone === "profit" ? (amount >= 0 ? "text-green-700 dark:text-green-400" : "text-red-600 dark:text-red-400") : "text-slate-900 dark:text-gray-100";
  return (
    <div className={`flex items-center justify-between gap-3 py-2.5 border-t ${strong ? "border-slate-300 dark:border-gray-600" : "border-slate-200 dark:border-gray-700"}`}>
      <span className={`${strong ? "font-semibold uppercase tracking-wide text-xs" : "font-medium"} text-slate-800 dark:text-gray-100`}>{label}</span>
      <div className="flex items-center gap-4 text-sm tabular-nums">
        <span className="text-slate-400 dark:text-gray-500 w-14 text-right">{percent === undefined ? "" : pct(percent)}</span>
        <span className={`font-bold w-32 text-right ${strong ? "text-base" : ""} ${toneClass}`}>{money(amount)}</span>
      </div>
    </div>
  );
}

function SectionHeader({ title, pctLabel }) {
  return (
    <div className="flex items-center justify-between pt-4 pb-1">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-gray-400">{title}</h3>
      <span className="text-[11px] text-slate-400 dark:text-gray-500">{pctLabel}</span>
    </div>
  );
}

export default function ProfitLossReportPage() {
  const t = useTranslations("profitLoss");
  const tc = useTranslations("common");

  const [preset, setPreset] = useState("thisMonth");
  const [dateFrom, setDateFrom] = useState(() => presetRange("thisMonth").dateFrom);
  const [dateTo, setDateTo] = useState(() => presetRange("thisMonth").dateTo);
  const [type, setType] = useState("");
  const [cardFeePercent, setCardFeePercent] = useState("3");
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [expanded, setExpanded] = useState(new Set());

  useEffect(() => {
    getProfitLossReport({ dateFrom, dateTo, type, cardFeePercent })
      .then(setData)
      .catch((e) => setError(e.message));
  }, [dateFrom, dateTo, type, cardFeePercent]);

  function applyPreset(p) {
    setPreset(p);
    if (p !== "custom") {
      const r = presetRange(p);
      setDateFrom(r.dateFrom);
      setDateTo(r.dateTo);
    }
  }

  function toggleExpand(key) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  const revenueRows = data ? data.revenueBreakdown.filter((r) => r.key !== "salesTax") : [];
  const salesTaxRow = data ? data.revenueDeductions.find((r) => r.key === "salesTax") : null;
  const costOfSalesRows = data ? data.costBreakdown.filter((r) => r.group === "costOfSales") : [];
  const operatingRows = data ? data.costBreakdown.filter((r) => r.group === "operating") : [];

  function handleExportCsv() {
    if (!data) return;
    const k = data.kpis;
    const rows = [["Section", "Line", "Amount", "%"]];
    revenueRows.forEach((r) => rows.push(["Revenue", t(`revenueCategories.${r.key}`), r.amount.toFixed(2), r.percentOfRevenue.toFixed(1)]));
    rows.push(["Revenue", t("grossCollections"), k.revenue.toFixed(2), "100.0"]);
    rows.push(["Revenue", t("deductionCategories.salesTax"), (-k.salesTax).toFixed(2), salesTaxRow ? salesTaxRow.percentOfRevenue.toFixed(1) : ""]);
    (salesTaxRow?.byState || []).forEach((s) => rows.push(["Revenue", `  ${t("deductionCategories.salesTax")} ${s.state === "none" ? t("stateNone") : s.state}`, (-s.amount).toFixed(2), ""]));
    rows.push(["Revenue", t("netRevenue"), k.netRevenue.toFixed(2), "100.0"]);
    costOfSalesRows.forEach((r) => rows.push(["Cost of Sales", t(`costCategories.${r.key}`), r.amount.toFixed(2), r.percentOfRevenue.toFixed(1)]));
    rows.push(["Cost of Sales", t("grossProfit"), k.grossProfit.toFixed(2), k.grossMarginPercent.toFixed(1)]);
    operatingRows.forEach((r) => rows.push(["Operating", t(`costCategories.${r.key}`), r.amount.toFixed(2), r.percentOfRevenue.toFixed(1)]));
    rows.push(["Result", t("netProfit"), k.profit.toFixed(2), k.marginPercent.toFixed(1)]);
    rows.push([]);
    rows.push(["KPI", "Value"]);
    rows.push([t("grossCollections"), k.revenue.toFixed(2)]);
    rows.push([t("salesTaxCollected"), k.salesTax.toFixed(2)]);
    rows.push([t("netRevenue"), k.netRevenue.toFixed(2)]);
    rows.push([t("cardFees"), k.cardFees.toFixed(2)]);
    rows.push([t("cardFeeRate"), String(k.cardFeePercent)]);
    rows.push([t("grossProfit"), k.grossProfit.toFixed(2)]);
    rows.push([t("grossMargin"), k.grossMarginPercent.toFixed(2)]);
    rows.push([t("netProfit"), k.profit.toFixed(2)]);
    rows.push([t("netMargin"), k.marginPercent.toFixed(2)]);
    const csv = rows.map((r) => r.map(csvEscape).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `profit-loss_${dateFrom || "all"}_${dateTo || "all"}.csv`;
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

      <ReportsTabs active="profitLoss" />

      <div className="bg-white dark:bg-gray-900 dark:border dark:border-gray-800 rounded-xl shadow-sm p-4 flex flex-wrap items-end gap-4 print:hidden">
        <div>
          <label htmlFor="pl-preset" className="block text-xs mb-1 text-slate-500 dark:text-gray-400">{t("dateRange")}</label>
          <select id="pl-preset" value={preset} onChange={(e) => applyPreset(e.target.value)} className={`${inputClass} min-w-[160px]`}>
            <option value="today">{t("presetToday")}</option>
            <option value="thisMonth">{t("presetThisMonth")}</option>
            <option value="lastMonth">{t("presetLastMonth")}</option>
            <option value="thisYear">{t("presetThisYear")}</option>
            <option value="custom">{t("presetCustom")}</option>
          </select>
        </div>
        {preset === "custom" && (
          <>
            <div>
              <label htmlFor="pl-date-from" className="block text-xs mb-1 text-slate-500 dark:text-gray-400">{t("dateFrom")}</label>
              <input id="pl-date-from" type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className={inputClass} />
            </div>
            <div>
              <label htmlFor="pl-date-to" className="block text-xs mb-1 text-slate-500 dark:text-gray-400">{t("dateTo")}</label>
              <input id="pl-date-to" type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className={inputClass} />
            </div>
          </>
        )}
        <div>
          <label htmlFor="pl-type" className="block text-xs mb-1 text-slate-500 dark:text-gray-400">{t("workOrderType")}</label>
          <select id="pl-type" value={type} onChange={(e) => setType(e.target.value)} className={`${inputClass} min-w-[140px]`}>
            <option value="">{t("allTypes")}</option>
            <option value="Personal">{t("typePersonal")}</option>
            <option value="Insurance">{t("typeInsurance")}</option>
          </select>
        </div>
        <div>
          <label htmlFor="pl-card-fee" className="block text-xs mb-1 text-slate-500 dark:text-gray-400">{t("cardFeeRate")}</label>
          <input id="pl-card-fee" type="number" min="0" max="15" step="0.1" value={cardFeePercent} onChange={(e) => setCardFeePercent(e.target.value)} className={`${inputClass} w-24`} />
        </div>
      </div>

      <div className="hidden print:block">
        <h1 className="text-xl font-bold">{t("title")}</h1>
        <p className="text-sm text-gray-500">
          {dateFrom || t("allTime")} — {dateTo || t("allTime")} · {type ? t(type === "Personal" ? "typePersonal" : "typeInsurance") : t("allTypes")} · {t("cardFeeRate")} {data?.kpis.cardFeePercent ?? cardFeePercent}
        </p>
      </div>

      {!data ? (
        <p className="text-slate-400 text-sm">{tc("loading")}</p>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <KpiCard label={t("grossCollections")} value={money(data.kpis.revenue)} tone="revenue" />
            <KpiCard label={t("netRevenue")} value={money(data.kpis.netRevenue)} sub={`${t("salesTaxCollected")}: ${money(data.kpis.salesTax)}`} tone="revenue" />
            <KpiCard label={t("grossProfit")} value={money(data.kpis.grossProfit)} sub={`${t("grossMargin")} ${pct(data.kpis.grossMarginPercent)}`} tone={data.kpis.grossProfit >= 0 ? "profit" : "loss"} />
            <KpiCard label={t("netProfit")} value={money(data.kpis.profit)} sub={`${t("netMargin")} ${pct(data.kpis.marginPercent)}`} tone={data.kpis.profit >= 0 ? "profit" : "loss"} />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="bg-white dark:bg-gray-900 dark:border dark:border-gray-800 rounded-xl shadow-sm p-4 print:shadow-none print:border">
              <div className="flex items-baseline justify-between gap-3">
                <div className="text-xs text-slate-500 dark:text-gray-400 uppercase tracking-wide">{t("salesTaxCollected")}</div>
                <div className="text-lg font-bold text-slate-800 dark:text-gray-100 tabular-nums">{money(data.kpis.salesTax)}</div>
              </div>
              <div className="flex flex-wrap gap-2 mt-2">
                {(salesTaxRow?.byState || []).map((s) => (
                  <span key={s.state} className="text-xs rounded-full bg-slate-100 dark:bg-gray-800 text-slate-600 dark:text-gray-300 px-2.5 py-1">
                    {s.state === "none" ? t("stateNone") : s.state}: <strong>{money(s.amount)}</strong>
                  </span>
                ))}
              </div>
              <p className="text-[11px] text-slate-400 dark:text-gray-500 mt-2 leading-snug">{t("salesTaxNote")}</p>
            </div>
            <div className="bg-white dark:bg-gray-900 dark:border dark:border-gray-800 rounded-xl shadow-sm p-4 print:shadow-none print:border">
              <div className="flex items-baseline justify-between gap-3">
                <div className="text-xs text-slate-500 dark:text-gray-400 uppercase tracking-wide">{t("cardFees")}</div>
                <div className="text-lg font-bold text-slate-800 dark:text-gray-100 tabular-nums">{money(data.kpis.cardFees)}</div>
              </div>
              <p className="text-xs text-slate-600 dark:text-gray-300 mt-2">
                {t("cardFeesOn", { percent: data.kpis.cardFeePercent, amount: money(data.kpis.cardCollected), orders: data.costBreakdown.find((c) => c.key === "cardProcessingFees")?.cardOrders ?? 0 })}
              </p>
              <p className="text-[11px] text-slate-400 dark:text-gray-500 mt-2 leading-snug">{t("cardFeeNote", { percent: data.kpis.cardFeePercent })}</p>
            </div>
          </div>

          <div className="bg-white dark:bg-gray-900 dark:border dark:border-gray-800 rounded-xl shadow-sm p-5 print:shadow-none print:border">
            <SectionHeader title={t("revenueSectionTitle")} pctLabel={t("pctOfGross")} />
            {revenueRows.map((row) => (
              <StatementRow key={row.key} row={row} label={t(`revenueCategories.${row.key}`)} expanded={expanded} toggleExpand={toggleExpand} idPrefix="rev" t={t} tc={tc} />
            ))}
            {salesTaxRow && (
              <StatementRow row={{ ...salesTaxRow, key: "salesTaxInc" }} label={t("revenueCategories.salesTax")} expanded={expanded} toggleExpand={toggleExpand} idPrefix="rev" t={t} tc={tc} />
            )}
            <SubtotalRow label={t("grossCollections")} amount={data.kpis.revenue} percent={100} />
            {salesTaxRow && (
              <StatementRow row={salesTaxRow} label={t("lessSalesTax")} expanded={expanded} toggleExpand={toggleExpand} idPrefix="ded" t={t} tc={tc} deduction />
            )}
            <SubtotalRow label={t("netRevenue")} amount={data.kpis.netRevenue} percent={data.kpis.revenue ? (data.kpis.netRevenue / data.kpis.revenue) * 100 : 0} strong />

            <SectionHeader title={t("costOfSalesTitle")} pctLabel={t("pctOfNet")} />
            {costOfSalesRows.map((row) => (
              <StatementRow key={row.key} row={row} label={t(`costCategories.${row.key}`)} expanded={expanded} toggleExpand={toggleExpand} idPrefix="cos" t={t} tc={tc} />
            ))}
            <SubtotalRow label={t("grossProfit")} amount={data.kpis.grossProfit} percent={data.kpis.grossMarginPercent} strong tone="profit" />

            <SectionHeader title={t("operatingTitle")} pctLabel={t("pctOfNet")} />
            {operatingRows.map((row) => (
              <StatementRow key={row.key} row={row} label={t(`costCategories.${row.key}`)} expanded={expanded} toggleExpand={toggleExpand} idPrefix="opx" t={t} tc={tc} />
            ))}
            <SubtotalRow label={t("netProfit")} amount={data.kpis.profit} percent={data.kpis.marginPercent} strong tone="profit" />
          </div>
        </>
      )}
    </div>
  );
}
