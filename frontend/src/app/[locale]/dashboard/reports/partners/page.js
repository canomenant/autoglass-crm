"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { getPartnersReport } from "@/lib/api";
import { ChevronDownIcon, ChevronUpIcon } from "@/components/Icons";

function money(n) {
  return `$${Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
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

function PartnerRow({ row, expanded, toggleExpand, t, tp }) {
  const key = String(row.partnerId);
  const isOpen = expanded.has(key);

  return (
    <div className="border-b last:border-0 border-slate-100 dark:border-gray-800">
      <button
        type="button"
        onClick={() => toggleExpand(key)}
        className="w-full flex items-center justify-between gap-3 py-3 text-left hover:bg-slate-50 dark:hover:bg-gray-800/40 transition-colors px-2 -mx-2 rounded-lg"
      >
        <div className="flex items-center gap-2 min-w-0">
          {isOpen ? <ChevronUpIcon className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" /> : <ChevronDownIcon className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />}
          <span className="font-medium text-slate-700 dark:text-gray-200 truncate">{row.partnerName}</span>
        </div>
        <span className="font-semibold text-slate-800 dark:text-gray-100">{money(row.amount)}</span>
      </button>

      {isOpen && (
        <div className="pb-3 pl-6">
          {row.items.length === 0 ? (
            <p className="text-xs text-slate-400">{t("noDistributions")}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-slate-400 dark:text-gray-500">
                    <th className="py-1 pr-3 font-medium">{tp("workOrder")}</th>
                    <th className="py-1 pr-3 font-medium">{t("jobType")}</th>
                    <th className="py-1 pr-3 font-medium">{t("paidAt")}</th>
                    <th className="py-1 pr-0 font-medium text-right">{t("amount")}</th>
                  </tr>
                </thead>
                <tbody>
                  {row.items.map((item) => (
                    <tr key={item.id} className="border-t border-slate-50 dark:border-gray-800/60">
                      <td className="py-1.5 pr-3">
                        <Link href={`/dashboard/workorders/${item.workOrderId}`} className="text-blue-600 dark:text-blue-400 hover:underline">
                          {item.workOrderNo}
                        </Link>
                      </td>
                      <td className="py-1.5 pr-3 text-slate-600 dark:text-gray-300">{item.jobType}</td>
                      <td className="py-1.5 pr-3 text-slate-600 dark:text-gray-300">{String(item.paidAt).slice(0, 10)}</td>
                      <td className="py-1.5 pr-0 text-right text-slate-700 dark:text-gray-200">{money(item.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {row.totalCount > row.items.length && (
                <p className="text-xs text-slate-400 mt-2">{tp("showingTopN", { shown: row.items.length, total: row.totalCount })}</p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function PartnersReportPage() {
  const t = useTranslations("partnersReport");
  const tp = useTranslations("profitLoss");
  const tc = useTranslations("common");

  const [preset, setPreset] = useState("thisMonth");
  const [dateFrom, setDateFrom] = useState(() => presetRange("thisMonth").dateFrom);
  const [dateTo, setDateTo] = useState(() => presetRange("thisMonth").dateTo);
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [expanded, setExpanded] = useState(new Set());

  useEffect(() => {
    getPartnersReport({ dateFrom, dateTo }).then(setData).catch((e) => setError(e.message));
  }, [dateFrom, dateTo]);

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

  if (error) return <p className="text-red-600 dark:text-red-400 text-sm">{error}</p>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-2xl font-semibold dark:text-gray-100 tracking-tight">{t("title")}</h1>
      </div>

      <ReportsTabs active="partners" />

      <div className="bg-white dark:bg-gray-900 dark:border dark:border-gray-800 rounded-xl shadow-sm p-4 flex flex-wrap items-end gap-4">
        <div>
          <label htmlFor="partners-preset" className="block text-xs mb-1 text-slate-500 dark:text-gray-400">{tp("dateRange")}</label>
          <select id="partners-preset" value={preset} onChange={(e) => applyPreset(e.target.value)} className="border border-slate-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none min-w-[160px]">
            <option value="today">{tp("presetToday")}</option>
            <option value="thisMonth">{tp("presetThisMonth")}</option>
            <option value="lastMonth">{tp("presetLastMonth")}</option>
            <option value="thisYear">{tp("presetThisYear")}</option>
            <option value="custom">{tp("presetCustom")}</option>
          </select>
        </div>
        {preset === "custom" && (
          <>
            <div>
              <label htmlFor="partners-date-from" className="block text-xs mb-1 text-slate-500 dark:text-gray-400">{tp("dateFrom")}</label>
              <input id="partners-date-from" type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="border border-slate-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none" />
            </div>
            <div>
              <label htmlFor="partners-date-to" className="block text-xs mb-1 text-slate-500 dark:text-gray-400">{tp("dateTo")}</label>
              <input id="partners-date-to" type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="border border-slate-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none" />
            </div>
          </>
        )}
      </div>

      {!data ? (
        <p className="text-slate-400 text-sm">{tc("loading")}</p>
      ) : (
        <>
          <div className="bg-white dark:bg-gray-900 dark:border dark:border-gray-800 rounded-xl shadow-sm p-4">
            <div className="text-xs text-slate-500 dark:text-gray-400 uppercase tracking-wide">{t("totalDistributed")}</div>
            <div className="text-2xl font-bold mt-1 text-slate-800 dark:text-gray-100">{money(data.totalAmount)}</div>
          </div>

          <div className="bg-white dark:bg-gray-900 dark:border dark:border-gray-800 rounded-xl shadow-sm p-4">
            {data.partners.length === 0 ? (
              <p className="text-sm text-slate-400">{t("noDistributions")}</p>
            ) : (
              data.partners.map((row) => (
                <PartnerRow key={row.partnerId} row={row} expanded={expanded} toggleExpand={toggleExpand} t={t} tp={tp} />
              ))
            )}
          </div>
        </>
      )}
    </div>
  );
}
