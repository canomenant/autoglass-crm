"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import moment from "moment";
import { Link } from "@/i18n/navigation";
import { getPayments } from "@/lib/api";
import { money } from "@/components/OrderSummaryUI";
import { PaymentsIcon, DollarIcon, CalendarIcon } from "@/components/Icons";

// "Mis comisiones": la lista de lo que se le ha pagado al agente, y nada más. La pantalla de
// Payments de la oficina le salía entera —pestañas de técnicos y distribuidores, notas de crédito,
// conciliación, el modo de cotejo bancario y hasta las cuentas del banco en el filtro— con dos
// llamadas en 403 de fondo. Nada de eso es suyo.

const STATUS_TONE = {
  Paid: "bg-green-100 text-green-800 dark:bg-green-500/15 dark:text-green-300",
  Approved: "bg-green-100 text-green-800 dark:bg-green-500/15 dark:text-green-300",
  "Ready For Payment": "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300",
  Pending: "bg-gray-200 text-gray-700 dark:bg-gray-700 dark:text-gray-200",
  Cancelled: "bg-red-100 text-red-800 dark:bg-red-500/15 dark:text-red-300",
};

function Kpi({ icon: Icon, label, value, sub }) {
  return (
    <div className="bg-white dark:bg-gray-900 dark:border dark:border-gray-800 rounded-xl shadow-sm p-4 flex items-start gap-3">
      <div className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-400">
        <Icon className="w-5 h-5" />
      </div>
      <div className="min-w-0">
        <div className="text-xs text-slate-500 dark:text-gray-400 leading-tight">{label}</div>
        <div className="text-lg font-bold text-slate-800 dark:text-gray-100 tabular-nums break-words">{value}</div>
        {sub && <div className="text-xs text-slate-400 dark:text-gray-500 truncate">{sub}</div>}
      </div>
    </div>
  );
}

const th = "p-3 font-medium text-left text-xs uppercase tracking-wide text-slate-400 dark:text-gray-500";
const td = "p-3 align-middle";

export default function AgentPaymentsView() {
  const t = useTranslations("agentPortal");
  const tp = useTranslations("payments");
  const [payments, setPayments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    getPayments()
      .then(setPayments)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  const view = useMemo(() => {
    const year = moment().format("YYYY");
    const sorted = [...payments].sort((a, b) => String(b.paymentDate || "").localeCompare(String(a.paymentDate || "")));
    const paid = sorted.filter((p) => p.status === "Paid");
    return {
      rows: sorted,
      totalPaid: paid.reduce((s, p) => s + Number(p.amount || 0), 0),
      paidThisYear: paid.filter((p) => String(p.paymentDate || "").startsWith(year)).reduce((s, p) => s + Number(p.amount || 0), 0),
      last: paid[0] || null,
    };
  }, [payments]);

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold dark:text-gray-100 tracking-tight">{t("payments.title")}</h1>
        <p className="text-sm text-slate-500 dark:text-gray-400">{t("payments.subtitle")}</p>
      </div>

      {error && <p className="text-red-600 dark:text-red-400 text-sm mb-4">{error}</p>}

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <Kpi icon={DollarIcon} label={t("kpis.commissionsPaid")} value={money(view.totalPaid)} />
        <Kpi icon={CalendarIcon} label={t("kpis.commissionPaidThisYear")} value={money(view.paidThisYear)} />
        <Kpi
          icon={PaymentsIcon}
          label={t("kpis.lastPayment")}
          value={view.last ? money(view.last.amount) : "—"}
          sub={view.last ? `${view.last.paymentDate || ""} · ${view.last.paymentNumber || ""}` : t("kpis.noPaymentsYet")}
        />
      </div>

      <div className="bg-white dark:bg-gray-900 dark:border dark:border-gray-800 rounded-xl shadow-sm overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-100 dark:border-gray-800">
              <th className={th}>{t("columns.payment")}</th>
              <th className={th}>{t("columns.date")}</th>
              <th className={th}>{t("columns.method")}</th>
              <th className={`${th} text-right`}>{t("columns.jobs")}</th>
              <th className={`${th} text-right`}>{t("columns.commission")}</th>
              <th className={`${th} text-right`}>{t("columns.bonus")}</th>
              <th className={`${th} text-right`}>{t("columns.deductions")}</th>
              <th className={`${th} text-right`}>{t("columns.netPaid")}</th>
              <th className={th}>{t("columns.status")}</th>
              <th className={th}></th>
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td className={`${td} text-slate-400`} colSpan={10}>…</td></tr>}
            {!loading && view.rows.length === 0 && (
              <tr><td className={`${td} text-slate-400`} colSpan={10}>{t("empty.recentPayments")}</td></tr>
            )}
            {view.rows.map((p) => {
              const deductions = Number(p.deductions || 0) + Number(p.creditNotesTotal || 0);
              const jobs = Number(p.obligationsCount || 0) || (p.workOrderIds || []).length;
              return (
                <tr key={p.id} className="border-b last:border-0 border-slate-50 dark:border-gray-800/60 hover:bg-slate-50 dark:hover:bg-gray-800/40 transition-colors">
                  <td className={td}><Link href={`/dashboard/payments/${p.id}`} className="font-medium text-blue-600 dark:text-blue-400 hover:underline">{p.paymentNumber || "—"}</Link></td>
                  <td className={`${td} whitespace-nowrap text-slate-600 dark:text-gray-300`}>{p.paymentDate || "—"}</td>
                  <td className={`${td} text-slate-600 dark:text-gray-300`}>{p.paymentMethod || "—"}</td>
                  <td className={`${td} text-right tabular-nums`}>{jobs || "—"}</td>
                  <td className={`${td} text-right tabular-nums`}>{money(p.grossAmount)}</td>
                  <td className={`${td} text-right tabular-nums`}>{Number(p.bonus || 0) ? money(p.bonus) : "—"}</td>
                  <td className={`${td} text-right tabular-nums`}>{deductions ? money(deductions) : "—"}</td>
                  <td className={`${td} text-right tabular-nums font-semibold text-emerald-600 dark:text-emerald-400`}>{money(p.amount)}</td>
                  <td className={td}>
                    <span className={`inline-block text-xs font-medium rounded-full px-2 py-0.5 ${STATUS_TONE[p.status] || STATUS_TONE.Pending}`}>{tp(`statuses.${p.status}`)}</span>
                  </td>
                  <td className={`${td} text-right whitespace-nowrap`}>
                    <Link href={`/dashboard/payments/${p.id}`} className="text-xs text-blue-600 dark:text-blue-400 hover:underline">{t("payments.viewStatement")}</Link>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
