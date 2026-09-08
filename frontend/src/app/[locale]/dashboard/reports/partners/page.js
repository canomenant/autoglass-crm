"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { getPartnersReport, createPartnerPayment, deletePartnerPayment } from "@/lib/api";
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

function PartnerRow({ row, expanded, toggleExpand, t, tp, tc, onChange }) {
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
        <span className="flex items-center gap-4 text-xs whitespace-nowrap">
          <span className="text-slate-500 dark:text-gray-400">{t("paidInRange")}: <b className="text-slate-800 dark:text-gray-100">{money(row.paidInRange)}</b></span>
          <span className="text-slate-500 dark:text-gray-400">{t("balance")}: <b className={row.balance > 0 ? "text-amber-600 dark:text-amber-400" : "text-green-600 dark:text-green-400"}>{money(row.balance)}</b></span>
          <span className="font-semibold text-sm text-slate-800 dark:text-gray-100">{money(row.amount)}</span>
        </span>
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
          <PartnerPayments row={row} t={t} tc={tc} onChange={onChange} />
        </div>
      )}
    </div>
  );
}

// Pagos al socio (cheques de la compañía) a cuenta de sus distribuciones: lista, alta y baja.
function PartnerPayments({ row, t, tc, onChange }) {
  const hoy = new Date().toISOString().slice(0, 10);
  const [form, setForm] = useState({ paymentDate: hoy, amount: "", method: "Check", reference: "", notes: "" });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  async function add(e) {
    e.preventDefault();
    setSaving(true); setErr("");
    try {
      await createPartnerPayment({ partnerId: row.partnerId, ...form, amount: Number(form.amount) });
      setForm({ paymentDate: hoy, amount: "", method: "Check", reference: "", notes: "" });
      onChange && onChange();
    } catch (e2) { setErr(e2.message); } finally { setSaving(false); }
  }
  async function del(id) {
    if (!window.confirm(t("confirmDeletePayment"))) return;
    try { await deletePartnerPayment(id); onChange && onChange(); } catch (e2) { setErr(e2.message); }
  }
  const inp = "border border-slate-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-2 py-1.5 text-xs";
  return (
    <div className="mt-4 border-t border-slate-100 dark:border-gray-800 pt-3">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-gray-400">{t("paymentsTitle")}</h4>
        <span className="text-xs text-slate-500 dark:text-gray-400">
          {t("distributedAllTime")} {money(row.distributedAllTime)} · {t("paidAllTime")} {money(row.paidAllTime)} · {t("balance")} <b className={row.balance > 0 ? "text-amber-600 dark:text-amber-400" : "text-green-600 dark:text-green-400"}>{money(row.balance)}</b>
        </span>
      </div>
      {row.payments.length === 0 ? (
        <p className="text-xs text-slate-400 mb-2">{t("noPayments")}</p>
      ) : (
        <table className="w-full text-xs mb-2">
          <thead>
            <tr className="text-left text-slate-400 dark:text-gray-500">
              <th className="py-1 pr-3 font-medium">{t("paymentDate")}</th>
              <th className="py-1 pr-3 font-medium">{t("method")}</th>
              <th className="py-1 pr-3 font-medium">{t("reference")}</th>
              <th className="py-1 pr-3 font-medium">{t("notes")}</th>
              <th className="py-1 pr-3 font-medium text-right">{t("amount")}</th>
              <th className="py-1 pr-0"></th>
            </tr>
          </thead>
          <tbody>
            {row.payments.map((p) => (
              <tr key={p.id} className="border-t border-slate-50 dark:border-gray-800/60">
                <td className="py-1.5 pr-3">{p.paymentDate}</td>
                <td className="py-1.5 pr-3">{p.method}</td>
                <td className="py-1.5 pr-3">{p.reference}</td>
                <td className="py-1.5 pr-3 text-slate-500">{p.notes}</td>
                <td className="py-1.5 pr-3 text-right text-slate-700 dark:text-gray-200">{money(p.amount)}</td>
                <td className="py-1.5 pr-0 text-right"><button type="button" onClick={() => del(p.id)} className="text-red-500 hover:underline">{tc("delete")}</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <form onSubmit={add} className="flex flex-wrap items-end gap-2">
        <div><label className="block text-[10px] text-slate-400 mb-0.5">{t("paymentDate")}</label><input type="date" required value={form.paymentDate} onChange={(e) => setForm({ ...form, paymentDate: e.target.value })} className={inp} /></div>
        <div><label className="block text-[10px] text-slate-400 mb-0.5">{t("amount")}</label><input type="number" step="0.01" min="0.01" required value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} className={inp + " w-28"} /></div>
        <div><label className="block text-[10px] text-slate-400 mb-0.5">{t("method")}</label>
          <select value={form.method} onChange={(e) => setForm({ ...form, method: e.target.value })} className={inp}>
            {["Check", "Zelle", "Cash", "Transfer", "Other"].map((m) => <option key={m} value={m}>{m}</option>)}
          </select></div>
        <div><label className="block text-[10px] text-slate-400 mb-0.5">{t("reference")}</label><input value={form.reference} onChange={(e) => setForm({ ...form, reference: e.target.value })} placeholder={t("referencePlaceholder")} className={inp + " w-36"} /></div>
        <div className="flex-1 min-w-[140px]"><label className="block text-[10px] text-slate-400 mb-0.5">{t("notes")}</label><input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} className={inp + " w-full"} /></div>
        <button type="submit" disabled={saving} className="bg-gray-900 hover:bg-gray-800 dark:bg-blue-600 dark:hover:bg-blue-700 text-white rounded-lg px-3 py-1.5 text-xs disabled:opacity-50">{t("addPayment")}</button>
      </form>
      {err && <p className="text-xs text-red-600 mt-1">{err}</p>}
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

  function load() {
    getPartnersReport({ dateFrom, dateTo }).then(setData).catch((e) => setError(e.message));
  }
  useEffect(() => { load(); }, [dateFrom, dateTo]);

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
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="bg-white dark:bg-gray-900 dark:border dark:border-gray-800 rounded-xl shadow-sm p-4">
              <div className="text-xs text-slate-500 dark:text-gray-400 uppercase tracking-wide">{t("totalDistributed")}</div>
              <div className="text-2xl font-bold mt-1 text-slate-800 dark:text-gray-100">{money(data.totalAmount)}</div>
            </div>
            <div className="bg-white dark:bg-gray-900 dark:border dark:border-gray-800 rounded-xl shadow-sm p-4">
              <div className="text-xs text-slate-500 dark:text-gray-400 uppercase tracking-wide">{t("totalPaid")}</div>
              <div className="text-2xl font-bold mt-1 text-slate-800 dark:text-gray-100">{money(data.totalPaid)}</div>
            </div>
            <div className="bg-white dark:bg-gray-900 dark:border dark:border-gray-800 rounded-xl shadow-sm p-4">
              <div className="text-xs text-slate-500 dark:text-gray-400 uppercase tracking-wide">{t("balanceAllTime")}</div>
              <div className={`text-2xl font-bold mt-1 ${data.totalBalance > 0 ? "text-amber-600 dark:text-amber-400" : "text-green-600 dark:text-green-400"}`}>{money(data.totalBalance)}</div>
            </div>
          </div>

          <div className="bg-white dark:bg-gray-900 dark:border dark:border-gray-800 rounded-xl shadow-sm p-4">
            {data.partners.length === 0 ? (
              <p className="text-sm text-slate-400">{t("noDistributions")}</p>
            ) : (
              data.partners.map((row) => (
                <PartnerRow key={row.partnerId} row={row} expanded={expanded} toggleExpand={toggleExpand} t={t} tp={tp} tc={tc} onChange={load} />
              ))
            )}
          </div>
        </>
      )}
    </div>
  );
}
