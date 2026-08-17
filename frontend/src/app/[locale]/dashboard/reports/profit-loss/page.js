"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { getProfitLossReport } from "@/lib/api";
import { ChevronDownIcon, ChevronUpIcon } from "@/components/Icons";

function money(n) {
  return `$${Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
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

function BreakdownRow({ row, categoryNamespace, expanded, toggleExpand, idPrefix, t, tc }) {
  const key = `${idPrefix}-${row.key}`;
  const isOpen = expanded.has(key);
  const drillItems = row.workOrders || row.items || [];
  const hasWorkOrders = Boolean(row.workOrders);

  return (
    <div className="border-b last:border-0 border-slate-100 dark:border-gray-800">
      <button
        type="button"
        onClick={() => toggleExpand(key)}
        className="w-full flex items-center justify-between gap-3 py-3 text-left hover:bg-slate-50 dark:hover:bg-gray-800/40 transition-colors px-2 -mx-2 rounded-lg print:hidden"
      >
        <div className="flex items-center gap-2 min-w-0">
          {isOpen ? <ChevronUpIcon className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" /> : <ChevronDownIcon className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />}
          <span className="font-medium text-slate-700 dark:text-gray-200 truncate">{t(`${categoryNamespace}.${row.key}`)}</span>
        </div>
        <div className="flex items-center gap-4 flex-shrink-0 text-sm">
          <span className="text-slate-400 dark:text-gray-500">{pct(row.percentOfRevenue)}</span>
          <span className="font-semibold text-slate-800 dark:text-gray-100 w-28 text-right">{money(row.amount)}</span>
        </div>
      </button>

      <div className="hidden print:flex items-center justify-between py-1.5 text-sm">
        <span>{t(`${categoryNamespace}.${row.key}`)}</span>
        <span>{money(row.amount)} ({pct(row.percentOfRevenue)})</span>
      </div>

      {isOpen && (
        <div className="pb-3 pl-6 print:hidden">
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
                        </>
                      ) : (
                        <>
                          <td className="py-1.5 pr-3 text-slate-600 dark:text-gray-300">{item.category}</td>
                          <td className="py-1.5 pr-3 text-slate-600 dark:text-gray-300">{item.date}</td>
                        </>
                      )}
                      <td className="py-1.5 pr-0 text-right text-slate-700 dark:text-gray-200">{money(item.amount)}</td>
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

function BreakdownSection({ title, rows, categoryNamespace, expanded, toggleExpand, idPrefix, t, tc }) {
  return (
    <div className="bg-white dark:bg-gray-900 dark:border dark:border-gray-800 rounded-xl shadow-sm p-4 print:shadow-none print:border">
      <h2 className="font-semibold text-slate-800 dark:text-gray-100 mb-2">{title}</h2>
      {rows.map((row) => (
        <BreakdownRow key={row.key} row={row} categoryNamespace={categoryNamespace} expanded={expanded} toggleExpand={toggleExpand} idPrefix={idPrefix} t={t} tc={tc} />
      ))}
    </div>
  );
}

export default function ProfitLossReportPage() {
  const t = useTranslations("profitLoss");
  const tc = useTranslations("common");
  const tPartners = useTranslations("partnersReport");

  const [preset, setPreset] = useState("thisMonth");
  const [dateFrom, setDateFrom] = useState(() => presetRange("thisMonth").dateFrom);
  const [dateTo, setDateTo] = useState(() => presetRange("thisMonth").dateTo);
  const [type, setType] = useState("");
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [expanded, setExpanded] = useState(new Set());

  useEffect(() => {
    getProfitLossReport({ dateFrom, dateTo, type })
      .then(setData)
      .catch((e) => setError(e.message));
  }, [dateFrom, dateTo, type]);

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

  function handleExportCsv() {
    if (!data) return;
    const rows = [["Section", "Category", "Amount", "% of Revenue"]];
    data.revenueBreakdown.forEach((r) => rows.push(["Revenue", t(`revenueCategories.${r.key}`), r.amount.toFixed(2), r.percentOfRevenue.toFixed(1)]));
    data.costBreakdown.forEach((r) => rows.push(["Cost", t(`costCategories.${r.key}`), r.amount.toFixed(2), r.percentOfRevenue.toFixed(1)]));
    rows.push([]);
    rows.push(["KPI", "Value"]);
    rows.push(["Total Revenue", data.kpis.revenue.toFixed(2)]);
    rows.push(["Direct Costs", data.kpis.costs.toFixed(2)]);
    rows.push(["Net Profit", data.kpis.profit.toFixed(2)]);
    rows.push(["Margin %", data.kpis.marginPercent.toFixed(2)]);
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
        <Link href="/dashboard/reports" className="px-1 py-2 text-gray-500 hover:text-gray-900 dark:hover:text-gray-200">{t("overviewTab")}</Link>
        <span className="px-1 py-2 font-medium text-slate-900 dark:text-gray-100 border-b-2 border-blue-600">{t("profitLossTab")}</span>
        <Link href="/dashboard/reports/profit-loss-matrix" className="px-1 py-2 text-gray-500 hover:text-gray-900 dark:hover:text-gray-200">{t("matrixTab")}</Link>
        <Link href="/dashboard/reports/partners" className="px-1 py-2 text-gray-500 hover:text-gray-900 dark:hover:text-gray-200">{tPartners("tab")}</Link>
      </div>

      <div className="bg-white dark:bg-gray-900 dark:border dark:border-gray-800 rounded-xl shadow-sm p-4 flex flex-wrap items-end gap-4 print:hidden">
        <div>
          <label htmlFor="pl-preset" className="block text-xs mb-1 text-slate-500 dark:text-gray-400">{t("dateRange")}</label>
          <select id="pl-preset" value={preset} onChange={(e) => applyPreset(e.target.value)} className="border border-slate-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none min-w-[160px]">
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
              <input id="pl-date-from" type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="border border-slate-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none" />
            </div>
            <div>
              <label htmlFor="pl-date-to" className="block text-xs mb-1 text-slate-500 dark:text-gray-400">{t("dateTo")}</label>
              <input id="pl-date-to" type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="border border-slate-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none" />
            </div>
          </>
        )}
        <div>
          <label htmlFor="pl-type" className="block text-xs mb-1 text-slate-500 dark:text-gray-400">{t("workOrderType")}</label>
          <select id="pl-type" value={type} onChange={(e) => setType(e.target.value)} className="border border-slate-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none min-w-[140px]">
            <option value="">{t("allTypes")}</option>
            <option value="Personal">{t("typePersonal")}</option>
            <option value="Insurance">{t("typeInsurance")}</option>
          </select>
        </div>
      </div>

      <div className="hidden print:block">
        <h1 className="text-xl font-bold">{t("title")}</h1>
        <p className="text-sm text-gray-500">
          {dateFrom || t("allTime")} — {dateTo || t("allTime")} · {type ? t(type === "Personal" ? "typePersonal" : "typeInsurance") : t("allTypes")}
        </p>
      </div>

      {!data ? (
        <p className="text-slate-400 text-sm">{tc("loading")}</p>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <KpiCard label={t("totalRevenue")} value={money(data.kpis.revenue)} tone="revenue" />
            <KpiCard label={t("directCosts")} value={money(data.kpis.costs)} tone="cost" />
            <KpiCard label={t("netProfit")} value={money(data.kpis.profit)} tone={data.kpis.profit >= 0 ? "profit" : "loss"} />
            <KpiCard label={t("marginPercent")} value={pct(data.kpis.marginPercent)} tone="margin" />
          </div>

          <BreakdownSection
            title={t("revenueBreakdownTitle")}
            rows={data.revenueBreakdown}
            categoryNamespace="revenueCategories"
            expanded={expanded}
            toggleExpand={toggleExpand}
            idPrefix="rev"
            t={t}
            tc={tc}
          />

          <BreakdownSection
            title={t("costBreakdownTitle")}
            rows={data.costBreakdown}
            categoryNamespace="costCategories"
            expanded={expanded}
            toggleExpand={toggleExpand}
            idPrefix="cost"
            t={t}
            tc={tc}
          />
        </>
      )}
    </div>
  );
}
