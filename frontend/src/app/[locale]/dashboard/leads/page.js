"use client";

// Menú Leads: leads ofrecidos/vendidos, por comprador y estado, con ingresos del filtro.

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { getLeadSales, getLeadBuyers } from "@/lib/api";

const INPUT = "border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-3 py-2 text-sm";
const TONO = { offered: "bg-amber-100 text-amber-700", paid: "bg-blue-100 text-blue-700", delivered: "bg-green-100 text-green-700", expired: "bg-gray-200 text-gray-600", cancelled: "bg-gray-200 text-gray-600" };
const money = (n) => `$${Number(n || 0).toFixed(2)}`;

export default function LeadsPage() {
  const t = useTranslations("leads");
  const [rows, setRows] = useState([]);
  const [buyers, setBuyers] = useState([]);
  const [status, setStatus] = useState("");
  const [buyerId, setBuyerId] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [error, setError] = useState("");

  useEffect(() => { getLeadBuyers().then(setBuyers).catch(() => {}); }, []);
  useEffect(() => {
    getLeadSales({ status, buyerId, from, to }).then(setRows).catch((e) => setError(e.message));
  }, [status, buyerId, from, to]);

  const resumen = useMemo(() => {
    const vendidos = rows.filter((r) => ["paid", "delivered"].includes(r.status));
    return { total: rows.length, sold: vendidos.length, revenue: vendidos.reduce((s, r) => s + Number(r.price), 0), open: rows.filter((r) => r.status === "offered").length };
  }, [rows]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h1 className="text-2xl font-semibold dark:text-gray-100 tracking-tight">{t("title")}</h1>
        <Link href="/dashboard/settings/lead-buyers" className="text-sm text-blue-600 dark:text-blue-400">{t("manageBuyers")}</Link>
      </div>
      {error && <p className="text-red-600 text-sm">{error}</p>}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[["cards.total", resumen.total], ["cards.open", resumen.open], ["cards.sold", resumen.sold], ["cards.revenue", money(resumen.revenue)]].map(([k, v]) => (
          <div key={k} className="bg-white dark:bg-gray-900 dark:border dark:border-gray-800 rounded-xl shadow-sm p-4">
            <div className="text-xs text-gray-500 dark:text-gray-400">{t(k)}</div>
            <div className="text-xl font-semibold dark:text-gray-100">{v}</div>
          </div>
        ))}
      </div>

      <div className="bg-white dark:bg-gray-900 dark:border dark:border-gray-800 rounded-xl shadow-sm p-3 flex flex-wrap items-end gap-3">
        <label className="text-xs text-gray-500">{t("filterStatus")}<select value={status} onChange={(e) => setStatus(e.target.value)} className={`${INPUT} block mt-1`}>
          <option value="">{t("all")}</option>{["offered", "paid", "delivered", "expired", "cancelled"].map((s) => <option key={s} value={s}>{t(`status.${s}`)}</option>)}
        </select></label>
        <label className="text-xs text-gray-500">{t("filterBuyer")}<select value={buyerId} onChange={(e) => setBuyerId(e.target.value)} className={`${INPUT} block mt-1`}>
          <option value="">{t("all")}</option>{buyers.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select></label>
        <label className="text-xs text-gray-500">{t("from")}<input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={`${INPUT} block mt-1`} /></label>
        <label className="text-xs text-gray-500">{t("to")}<input type="date" value={to} onChange={(e) => setTo(e.target.value)} className={`${INPUT} block mt-1`} /></label>
      </div>

      <div className="bg-white dark:bg-gray-900 dark:border dark:border-gray-800 rounded-xl shadow-sm overflow-x-auto">
        <table className="w-full text-sm">
          <thead><tr className="text-left border-b dark:border-gray-800 text-xs text-gray-500">
            <th className="p-3">{t("date")}</th><th className="p-3">{t("workOrder")}</th><th className="p-3">{t("lead")}</th><th className="p-3">{t("offeredTo")}</th><th className="p-3">{t("buyer")}</th><th className="p-3 text-right">{t("price")}</th><th className="p-3">{t("statusCol")}</th>
          </tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-b last:border-0 dark:border-gray-800">
                <td className="p-3 whitespace-nowrap">{new Date(r.createdAt).toLocaleDateString()}</td>
                <td className="p-3 whitespace-nowrap"><Link href={`/dashboard/workorders/${r.workOrderId}`} className="text-blue-600 dark:text-blue-400 hover:underline">{r.workOrderNo}</Link></td>
                <td className="p-3">{r.teaser?.vehicle} · {r.teaser?.job}<div className="text-xs text-gray-400">{r.teaser?.area}</div></td>
                <td className="p-3 text-xs">{r.offers.map((o) => o.buyerName).join(", ")}</td>
                <td className="p-3">{r.buyerName || "—"}{r.paidVia ? <span className="text-xs text-gray-400"> · {r.paidVia}</span> : null}</td>
                <td className="p-3 text-right font-medium">{money(r.price)}</td>
                <td className="p-3"><span className={`text-xs font-semibold rounded-full px-2 py-1 ${TONO[r.status]}`}>{t(`status.${r.status}`)}</span></td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td className="p-3 text-gray-500" colSpan={7}>{t("noRows")}</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
