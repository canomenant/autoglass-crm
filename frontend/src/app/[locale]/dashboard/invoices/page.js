"use client";

// Listado de facturas (menú Invoices, 19-sep-2026): búsqueda, estado, rango de fechas, "solo con
// saldo", totales del filtro y envío desde la fila. El servidor filtra (invoices.store.list); la
// paginación es local porque las facturas son pocas y ya vienen sin breakdown.

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { getInvoices } from "@/lib/api";
import InvoiceSendMenu from "@/components/InvoiceSendMenu";

const STATUSES = ["Draft", "Sent", "Viewed", "Partially_Paid", "Paid", "Overdue", "Void"];
const STATUS_COLORS = {
  Draft: "bg-gray-200 text-gray-600",
  Sent: "bg-blue-100 text-blue-700",
  Viewed: "bg-purple-100 text-purple-700",
  Partially_Paid: "bg-amber-100 text-amber-700",
  Paid: "bg-green-100 text-green-700",
  Overdue: "bg-red-100 text-red-700",
  Void: "bg-gray-200 text-gray-600",
};
const PAGE_SIZE = 50;
const INPUT = "border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none";

function money(n) {
  return `$${Number(n || 0).toFixed(2)}`;
}

function phone(v) {
  const d = String(v || "").replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "");
  return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : String(v || "");
}

function Tarjeta({ label, value, tone = "" }) {
  return (
    <div className="bg-white dark:bg-gray-900 dark:border dark:border-gray-800 rounded-xl shadow-sm p-4">
      <div className="text-xs text-gray-500 dark:text-gray-400">{label}</div>
      <div className={`text-xl font-semibold ${tone}`}>{value}</div>
    </div>
  );
}

export default function InvoicesListPage() {
  const t = useTranslations("invoices");
  const tl = useTranslations("invoicesList");
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [status, setStatus] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [withBalance, setWithBalance] = useState(false);
  const [page, setPage] = useState(1);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(search.trim()), 350);
    return () => clearTimeout(timer);
  }, [search]);

  useEffect(() => { setPage(1); }, [debounced, status, dateFrom, dateTo, withBalance]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getInvoices({ search: debounced, status, dateFrom, dateTo, withBalance: withBalance ? "1" : "" })
      .then((list) => { if (!cancelled) { setRows(list); setError(""); } })
      .catch((e) => { if (!cancelled) setError(e.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [debounced, status, dateFrom, dateTo, withBalance, tick]);

  const resumen = useMemo(() => {
    const activas = rows.filter((i) => i.status !== "Void");
    return {
      count: rows.length,
      billed: activas.reduce((s, i) => s + Number(i.total || 0), 0),
      paid: activas.reduce((s, i) => s + Number(i.amountPaid || 0), 0),
      balance: activas.reduce((s, i) => s + Math.max(0, Number(i.balance || 0)), 0),
    };
  }, [rows]);

  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const pagina = Math.min(page, totalPages);
  const visibles = rows.slice((pagina - 1) * PAGE_SIZE, pagina * PAGE_SIZE);

  function reemplazar(updated) {
    setRows((r) => r.map((i) => (i.id === updated.id ? { ...i, ...updated } : i)));
  }

  function limpiar() {
    setSearch(""); setStatus(""); setDateFrom(""); setDateTo(""); setWithBalance(false);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h1 className="text-2xl font-semibold dark:text-gray-100 tracking-tight">{tl("title")}</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400">{tl("hint")}</p>
      </div>

      {error && <p className="text-red-600 dark:text-red-400 text-sm">{error}</p>}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Tarjeta label={tl("cards.count")} value={resumen.count} />
        <Tarjeta label={tl("cards.billed")} value={money(resumen.billed)} />
        <Tarjeta label={tl("cards.paid")} value={money(resumen.paid)} tone="text-green-700 dark:text-green-400" />
        <Tarjeta label={tl("cards.balance")} value={money(resumen.balance)} tone={resumen.balance > 0 ? "text-red-700 dark:text-red-400" : ""} />
      </div>

      <div className="bg-white dark:bg-gray-900 dark:border dark:border-gray-800 rounded-xl shadow-sm p-3 flex flex-wrap items-end gap-3">
        <label className="text-xs text-gray-500 dark:text-gray-400 flex-1 min-w-[220px]">
          {tl("search")}
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={tl("searchPlaceholder")} className={`${INPUT} w-full mt-1`} />
        </label>
        <label className="text-xs text-gray-500 dark:text-gray-400">
          {t("status")}
          <select value={status} onChange={(e) => setStatus(e.target.value)} className={`${INPUT} block mt-1`}>
            <option value="">{tl("allStatuses")}</option>
            {STATUSES.map((s) => <option key={s} value={s}>{t(`statuses.${s}`)}</option>)}
          </select>
        </label>
        <label className="text-xs text-gray-500 dark:text-gray-400">
          {tl("from")}
          <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className={`${INPUT} block mt-1`} />
        </label>
        <label className="text-xs text-gray-500 dark:text-gray-400">
          {tl("to")}
          <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className={`${INPUT} block mt-1`} />
        </label>
        <label className="text-sm flex items-center gap-2 pb-2 dark:text-gray-200">
          <input type="checkbox" checked={withBalance} onChange={(e) => setWithBalance(e.target.checked)} />
          {tl("withBalance")}
        </label>
        <button type="button" onClick={limpiar} className="text-sm text-blue-600 dark:text-blue-400 pb-2">{tl("clear")}</button>
      </div>

      <div className="bg-white dark:bg-gray-900 dark:border dark:border-gray-800 rounded-xl shadow-sm overflow-x-auto">
        <table className={`w-full text-sm transition-opacity ${loading ? "opacity-60" : "opacity-100"}`}>
          <thead>
            <tr className="text-left border-b dark:border-gray-800 text-xs text-gray-500 dark:text-gray-400">
              <th className="p-3 whitespace-nowrap">{t("invoiceNumber")}</th>
              <th className="p-3 whitespace-nowrap">{t("invoiceDate")}</th>
              <th className="p-3 whitespace-nowrap">{tl("customer")}</th>
              <th className="p-3 whitespace-nowrap">{t("vehicle")}</th>
              <th className="p-3 whitespace-nowrap text-right">{t("total")}</th>
              <th className="p-3 whitespace-nowrap text-right">{t("amountPaid")}</th>
              <th className="p-3 whitespace-nowrap text-right">{t("balance")}</th>
              <th className="p-3 whitespace-nowrap">{t("status")}</th>
              <th className="p-3 whitespace-nowrap">{tl("sent")}</th>
              <th className="p-3 whitespace-nowrap"></th>
            </tr>
          </thead>
          <tbody>
            {visibles.map((i) => (
              <tr key={i.id} className="border-b last:border-0 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800/60 transition-colors">
                <td className="p-3 whitespace-nowrap">
                  <Link href={`/dashboard/invoices/${i.id}`} className="font-medium text-blue-600 dark:text-blue-400 hover:underline">{i.invoiceNumber}</Link>
                  <div className="text-[11px] text-gray-400">
                    <Link href={`/dashboard/workorders/${i.workOrderId}`} className="hover:underline">{i.workOrderNo}</Link>
                  </div>
                </td>
                <td className="p-3 whitespace-nowrap">{i.invoiceDate}</td>
                <td className="p-3 whitespace-nowrap">
                  <div className="font-medium">{i.customerName}</div>
                  <div className="text-[11px] text-gray-400">{[phone(i.customerPhone), i.customerEmail].filter(Boolean).join(" · ")}</div>
                </td>
                <td className="p-3 whitespace-nowrap">{[i.vehicle?.year, i.vehicle?.make, i.vehicle?.model].filter(Boolean).join(" ")}</td>
                <td className="p-3 whitespace-nowrap text-right">{money(i.total)}</td>
                <td className="p-3 whitespace-nowrap text-right">{money(i.amountPaid)}</td>
                <td className={`p-3 whitespace-nowrap text-right font-medium ${Number(i.balance) > 0.005 ? "text-red-700 dark:text-red-400" : "text-green-700 dark:text-green-400"}`}>{money(i.balance)}</td>
                <td className="p-3 whitespace-nowrap">
                  <span className={`text-xs font-medium rounded-full px-2 py-1 ${STATUS_COLORS[i.status] || "bg-gray-100 text-gray-600"}`}>{t(`statuses.${i.status}`)}</span>
                </td>
                <td className="p-3 whitespace-nowrap text-xs text-gray-500 dark:text-gray-400">
                  {i.lastSentAt ? `${new Date(i.lastSentAt).toLocaleDateString()} · ${t(`sendVia.${i.lastSentVia || "other"}`)}${i.sendCount > 1 ? ` ×${i.sendCount}` : ""}` : "—"}
                </td>
                <td className="p-3 whitespace-nowrap text-right">
                  <div className="flex justify-end gap-2">
                    <a href={`/invoice/view/${i.publicToken}`} target="_blank" rel="noreferrer" className="border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-3 py-2 text-xs">{tl("view")}</a>
                    {i.status !== "Void" && <InvoiceSendMenu invoice={i} onSent={reemplazar} size="xs" />}
                  </div>
                </td>
              </tr>
            ))}
            {visibles.length === 0 && !error && (
              <tr><td className="p-3 text-gray-500" colSpan={10}>{loading ? "…" : tl("noRecords")}</td></tr>
            )}
          </tbody>
        </table>
        <div className="flex items-center justify-between px-4 py-3 border-t dark:border-gray-800 text-sm text-gray-500 dark:text-gray-400">
          <span>{tl("showing", { n: visibles.length, total: rows.length })}</span>
          <div className="flex items-center gap-2">
            <button type="button" disabled={pagina <= 1} onClick={() => setPage(pagina - 1)} className="px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 disabled:opacity-40">‹</button>
            <span>{pagina} / {totalPages}</span>
            <button type="button" disabled={pagina >= totalPages} onClick={() => setPage(pagina + 1)} className="px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 disabled:opacity-40">›</button>
            <button type="button" onClick={() => setTick((x) => x + 1)} className="px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700">{tl("refresh")}</button>
          </div>
        </div>
      </div>
    </div>
  );
}
