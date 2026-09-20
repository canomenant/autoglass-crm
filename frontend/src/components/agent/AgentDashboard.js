"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import moment from "moment";
import { Link } from "@/i18n/navigation";
import { getWorkOrders, getQuotes, getPayments, getAgentPendingCommission } from "@/lib/api";
import { money } from "@/components/OrderSummaryUI";
import WorkOrderStatusBadge from "@/components/WorkOrderStatusBadge";
import QuoteStatusBadge from "@/components/QuoteStatusBadge";
import { isCompletedWorkOrderStatus } from "@/lib/workOrderStatuses";
import { QuotesIcon, WorkOrdersIcon, DollarIcon, ClockIcon, PaymentsIcon, CheckIcon, CalendarIcon } from "@/components/Icons";

// El tablero del agente. El de la oficina enseña la empresa entera (ingresos, técnicos,
// distribuidores, el calendario por técnico) y para un agente casi nada de eso es suyo ni le
// carga: /technicians le responde 403 y el calendario salía vacío. Aquí sólo hay lo que él
// mueve: sus cotizaciones, los trabajos que salieron de ellas y lo que se le ha pagado.

const OPEN_STATUSES = ["Scheduled", "Assigned", "In Progress"];

function vehicleOf(x) {
  return [x?.vehicle?.year, x?.vehicle?.make, x?.vehicle?.model].filter(Boolean).join(" ");
}

function appointmentOf(w) {
  return [w.appointmentDate, w.appointmentTime].filter(Boolean).join(" · ");
}

const TONES = {
  blue: "bg-blue-50 text-blue-600 dark:bg-blue-500/10 dark:text-blue-400",
  green: "bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-400",
  amber: "bg-amber-50 text-amber-600 dark:bg-amber-500/10 dark:text-amber-400",
  slate: "bg-slate-100 text-slate-600 dark:bg-gray-800 dark:text-gray-300",
};

function Kpi({ icon: Icon, tone = "blue", label, value, sub }) {
  return (
    <div className="bg-white dark:bg-gray-900 dark:border dark:border-gray-800 rounded-xl shadow-sm p-4 flex items-start gap-3">
      <div className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 ${TONES[tone]}`}>
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

function Panel({ title, action, children }) {
  return (
    <section className="bg-white dark:bg-gray-900 dark:border dark:border-gray-800 rounded-xl shadow-sm p-5">
      <div className="flex items-center justify-between mb-3">
        <h2 className="font-semibold text-slate-800 dark:text-gray-100">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

function Empty({ children }) {
  return <p className="text-sm text-slate-400 dark:text-gray-500 py-2">{children}</p>;
}

const th = "py-2 pr-4 font-medium text-left text-xs uppercase tracking-wide text-slate-400 dark:text-gray-500";
const td = "py-2.5 pr-4 align-middle";
const rowCls = "border-b last:border-0 border-slate-50 dark:border-gray-800/60 hover:bg-slate-50 dark:hover:bg-gray-800/40 transition-colors";

export default function AgentDashboard({ user }) {
  const t = useTranslations("agentPortal");
  const [workOrders, setWorkOrders] = useState([]);
  const [quotes, setQuotes] = useState([]);
  const [payments, setPayments] = useState([]);
  // Lo que se le debe hoy, desde las obligaciones (payable): es la cifra que el agente viene a ver.
  const [pending, setPending] = useState({ pendingAmount: 0, pendingCount: 0, items: [] });
  const [error, setError] = useState("");

  useEffect(() => {
    getWorkOrders().then(setWorkOrders).catch((e) => setError(e.message));
    getQuotes().then(setQuotes).catch(() => {});
    getPayments().then(setPayments).catch(() => {});
    if (user?.entityId != null) getAgentPendingCommission(user.entityId).then(setPending).catch(() => {});
  }, [user?.entityId]);

  const data = useMemo(() => {
    const month = moment().format("YYYY-MM");
    const year = moment().format("YYYY");
    const dateOf = (q) => String(q.date || q.createdAt || "").slice(0, 10);

    const quotesThisMonth = quotes.filter((q) => dateOf(q).startsWith(month));
    const convertedThisMonth = quotesThisMonth.filter((q) => q.status === "Converted");

    const openJobs = workOrders.filter((w) => OPEN_STATUSES.includes(w.status));
    const awaiting = workOrders.filter((w) => isCompletedWorkOrderStatus(w.status) && !w.payment?.paid);

    const paid = payments.filter((p) => p.status === "Paid").sort((a, b) => String(b.paymentDate || "").localeCompare(String(a.paymentDate || "")));
    const commissionsPaid = paid.reduce((s, p) => s + Number(p.amount || 0), 0);
    const paidThisYear = paid.filter((p) => String(p.paymentDate || "").startsWith(year)).reduce((s, p) => s + Number(p.amount || 0), 0);
    const lastPayment = paid[0] || null;

    // Los abiertos, los de fecha más próxima primero; los que aún no tienen cita, al final.
    const upcoming = [...openJobs]
      .sort((a, b) => String(a.appointmentDate || "9999").localeCompare(String(b.appointmentDate || "9999")))
      .slice(0, 10);

    const recentQuotes = [...quotes].sort((a, b) => dateOf(b).localeCompare(dateOf(a))).slice(0, 8);

    return {
      quotesThisMonth: quotesThisMonth.length,
      convertedThisMonth: convertedThisMonth.length,
      openJobs: openJobs.length,
      awaitingCount: awaiting.length,
      awaitingAmount: awaiting.reduce((s, w) => s + Math.max(0, Number(w.totalSale || 0) - Number(w.payment?.amount || 0)), 0),
      commissionsPaid,
      paidThisYear,
      lastPayment,
      upcoming,
      awaiting: awaiting.slice(0, 10),
      recentQuotes,
      recentPayments: paid.slice(0, 5),
    };
  }, [workOrders, quotes, payments]);

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-3 mb-6">
        <div>
          <h1 className="text-2xl font-semibold dark:text-gray-100 tracking-tight">{t("greeting", { name: (user?.name || "").split(" ")[0] })}</h1>
          <p className="text-sm text-slate-500 dark:text-gray-400">{t("subtitle")}</p>
        </div>
        <Link href="/dashboard/quotes/new" className="bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors px-4 py-2 text-sm font-medium">
          + {t("newQuote")}
        </Link>
      </div>

      {error && <p className="text-red-600 dark:text-red-400 text-sm mb-4">{error}</p>}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <Kpi icon={QuotesIcon} label={t("kpis.quotesThisMonth")} value={data.quotesThisMonth} />
        <Kpi icon={CheckIcon} tone="green" label={t("kpis.convertedThisMonth")} value={data.convertedThisMonth} />
        <Kpi icon={WorkOrdersIcon} label={t("kpis.openJobs")} value={data.openJobs} />
        <Kpi icon={ClockIcon} tone="amber" label={t("kpis.awaitingPayment")} value={data.awaitingCount} sub={data.awaitingCount ? money(data.awaitingAmount) : undefined} />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <Kpi icon={DollarIcon} tone="amber" label={t("kpis.pendingCommission")} value={money(pending.pendingAmount)} sub={t("kpis.pendingCommissionJobs", { count: pending.pendingCount })} />
        <Kpi icon={PaymentsIcon} tone="green" label={t("kpis.commissionsPaid")} value={money(data.commissionsPaid)} />
        <Kpi icon={CalendarIcon} tone="slate" label={t("kpis.commissionPaidThisYear")} value={money(data.paidThisYear)} />
        <Kpi
          icon={PaymentsIcon}
          tone="slate"
          label={t("kpis.lastPayment")}
          value={data.lastPayment ? money(data.lastPayment.amount) : "—"}
          sub={data.lastPayment ? `${data.lastPayment.paymentDate || ""} · ${data.lastPayment.paymentNumber || ""}` : t("kpis.noPaymentsYet")}
        />
      </div>

      <Panel title={t("sections.pendingCommission")} action={<span className="text-sm font-semibold tabular-nums text-amber-600 dark:text-amber-400">{money(pending.pendingAmount)}</span>}>
        {pending.items.length === 0 ? <Empty>{t("empty.pendingCommission")}</Empty> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="border-b border-slate-100 dark:border-gray-800">
                <th className={th}>{t("columns.workOrder")}</th><th className={th}>{t("columns.customer")}</th><th className={th}>{t("columns.date")}</th><th className={th}>{t("columns.status")}</th><th className={`${th} text-right`}>{t("columns.commission")}</th>
              </tr></thead>
              <tbody>
                {pending.items.slice(0, 15).map((i) => (
                  <tr key={i.workOrderNo} className={rowCls}>
                    <td className={td}>{i.workOrderId ? <Link href={`/dashboard/workorders/${i.workOrderId}`} className="font-medium text-blue-600 dark:text-blue-400 hover:underline">{i.workOrderNo}</Link> : <span className="font-medium">{i.workOrderNo}</span>}</td>
                    <td className={td}><div className="text-slate-700 dark:text-gray-200">{i.customerName || "—"}</div><div className="text-xs text-slate-400">{i.vehicle}</div></td>
                    <td className={`${td} text-slate-600 dark:text-gray-300 whitespace-nowrap`}>{i.workDate || "—"}</td>
                    <td className={td}>{i.workOrderStatus ? <WorkOrderStatusBadge status={i.workOrderStatus} withDot /> : "—"}</td>
                    <td className={`${td} text-right tabular-nums font-semibold text-amber-600 dark:text-amber-400`}>{money(i.amount)}</td>
                  </tr>
                ))}
                {pending.items.length > 15 && (
                  <tr><td className={`${td} text-xs text-slate-400`} colSpan={5}>{t("sections.andMore", { count: pending.items.length - 15 })}</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 mb-6">
        <Panel title={t("sections.upcomingJobs")} action={<Link href="/dashboard/workorders" className="text-xs text-blue-600 dark:text-blue-400 hover:underline">{t("sections.viewAll")}</Link>}>
          {data.upcoming.length === 0 ? <Empty>{t("empty.upcomingJobs")}</Empty> : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="border-b border-slate-100 dark:border-gray-800">
                  <th className={th}>{t("columns.workOrder")}</th><th className={th}>{t("columns.customer")}</th><th className={th}>{t("columns.appointment")}</th><th className={th}>{t("columns.technician")}</th><th className={th}>{t("columns.status")}</th>
                </tr></thead>
                <tbody>
                  {data.upcoming.map((w) => (
                    <tr key={w.id} className={rowCls}>
                      <td className={td}><Link href={`/dashboard/workorders/${w.id}`} className="font-medium text-blue-600 dark:text-blue-400 hover:underline">{w.workOrderNo}</Link></td>
                      <td className={td}><div className="text-slate-700 dark:text-gray-200">{w.customerName || "—"}</div><div className="text-xs text-slate-400">{vehicleOf(w)}</div></td>
                      <td className={`${td} text-slate-600 dark:text-gray-300 whitespace-nowrap`}>{appointmentOf(w) || "—"}</td>
                      <td className={`${td} text-slate-600 dark:text-gray-300`}>{w.tech || "—"}</td>
                      <td className={td}><WorkOrderStatusBadge status={w.status} withDot /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>

        <Panel title={t("sections.awaitingPayment")}>
          {data.awaiting.length === 0 ? <Empty>{t("empty.awaitingPayment")}</Empty> : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="border-b border-slate-100 dark:border-gray-800">
                  <th className={th}>{t("columns.workOrder")}</th><th className={th}>{t("columns.customer")}</th><th className={th}>{t("columns.appointment")}</th><th className={`${th} text-right`}>{t("columns.total")}</th><th className={`${th} text-right`}>{t("columns.balance")}</th>
                </tr></thead>
                <tbody>
                  {data.awaiting.map((w) => {
                    const balance = Math.max(0, Number(w.totalSale || 0) - Number(w.payment?.amount || 0));
                    return (
                      <tr key={w.id} className={rowCls}>
                        <td className={td}><Link href={`/dashboard/workorders/${w.id}`} className="font-medium text-blue-600 dark:text-blue-400 hover:underline">{w.workOrderNo}</Link></td>
                        <td className={td}><div className="text-slate-700 dark:text-gray-200">{w.customerName || "—"}</div><div className="text-xs text-slate-400">{vehicleOf(w)}</div></td>
                        <td className={`${td} text-slate-600 dark:text-gray-300 whitespace-nowrap`}>{w.appointmentDate || "—"}</td>
                        <td className={`${td} text-right tabular-nums`}>{money(w.totalSale)}</td>
                        <td className={`${td} text-right tabular-nums font-semibold text-red-600 dark:text-red-400`}>{money(balance)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[1fr_380px] gap-6">
        <Panel title={t("sections.recentQuotes")} action={<Link href="/dashboard/quotes" className="text-xs text-blue-600 dark:text-blue-400 hover:underline">{t("sections.viewAll")}</Link>}>
          {data.recentQuotes.length === 0 ? <Empty>{t("empty.recentQuotes")}</Empty> : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="border-b border-slate-100 dark:border-gray-800">
                  <th className={th}>{t("columns.quote")}</th><th className={th}>{t("columns.customer")}</th><th className={th}>{t("columns.vehicle")}</th><th className={th}>{t("columns.date")}</th><th className={th}>{t("columns.status")}</th><th className={`${th} text-right`}>{t("columns.total")}</th>
                </tr></thead>
                <tbody>
                  {data.recentQuotes.map((q) => (
                    <tr key={q.id} className={rowCls}>
                      <td className={td}><Link href={`/dashboard/quotes/${q.id}`} className="font-medium text-blue-600 dark:text-blue-400 hover:underline">{q.quoteNo}</Link></td>
                      <td className={`${td} text-slate-700 dark:text-gray-200`}>{q.customerName || "—"}</td>
                      <td className={`${td} text-slate-600 dark:text-gray-300`}>{vehicleOf(q) || "—"}</td>
                      <td className={`${td} text-slate-500 dark:text-gray-400 whitespace-nowrap`}>{String(q.date || q.createdAt || "").slice(0, 10) || "—"}</td>
                      <td className={td}><QuoteStatusBadge status={q.status} withDot /></td>
                      <td className={`${td} text-right tabular-nums font-medium`}>{money(q.totals?.totalAmount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>

        <Panel title={t("sections.recentPayments")} action={<Link href="/dashboard/payments" className="text-xs text-blue-600 dark:text-blue-400 hover:underline">{t("sections.viewAll")}</Link>}>
          {data.recentPayments.length === 0 ? <Empty>{t("empty.recentPayments")}</Empty> : (
            <ul className="divide-y divide-slate-50 dark:divide-gray-800/60">
              {data.recentPayments.map((p) => (
                <li key={p.id} className="py-2.5 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <Link href={`/dashboard/payments/${p.id}`} className="font-medium text-blue-600 dark:text-blue-400 hover:underline">{p.paymentNumber}</Link>
                    <div className="text-xs text-slate-400">{p.paymentDate || "—"}{p.paymentMethod ? ` · ${p.paymentMethod}` : ""}</div>
                  </div>
                  <span className="font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">{money(p.amount)}</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </div>
  );
}
