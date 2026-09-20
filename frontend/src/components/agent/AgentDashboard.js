"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import moment from "moment";
import { Link } from "@/i18n/navigation";
import { getWorkOrders, getQuotes, getPayments, getAgentPendingCommission, getTechnicians, getInsuranceCompanies, getDistributorsBasic } from "@/lib/api";
import { money } from "@/components/OrderSummaryUI";
import SchedulingCalendar from "@/components/SchedulingCalendar";
import { isCompletedWorkOrderStatus } from "@/lib/workOrderStatuses";
import { QuotesIcon, WorkOrdersIcon, DollarIcon, ClockIcon, PaymentsIcon, CheckIcon, CalendarIcon } from "@/components/Icons";

// El tablero del agente: sus cifras arriba y, debajo, el calendario y el mapa de TODOS los
// trabajos (los agentes se cubren entre sí y atienden a cualquier cliente). Las listas de
// próximos trabajos, pendientes de cobro y cotizaciones recientes se quitaron porque ya viven en
// Work Orders; la comisión pendiente y los pagos recientes se movieron a "Mis Comisiones"
// (Antonio, 20-sep-2026).

const OPEN_STATUSES = ["Scheduled", "Assigned", "In Progress"];

const TONES = {
  blue: "bg-blue-50 text-blue-600 dark:bg-blue-500/10 dark:text-blue-400",
  green: "bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-400",
  amber: "bg-amber-50 text-amber-600 dark:bg-amber-500/10 dark:text-amber-400",
  slate: "bg-slate-100 text-slate-600 dark:bg-gray-800 dark:text-gray-300",
};

function Kpi({ icon: Icon, tone = "blue", label, value, sub, href }) {
  const body = (
    <div className="bg-white dark:bg-gray-900 dark:border dark:border-gray-800 rounded-xl shadow-sm hover:shadow-md transition-shadow p-4 flex items-start gap-3 h-full">
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
  return href ? <Link href={href} className="block">{body}</Link> : body;
}

export default function AgentDashboard({ user }) {
  const t = useTranslations("agentPortal");
  // Las cifras de arriba son SUYAS (sus cotizaciones y las órdenes que salieron de ellas).
  const [myWorkOrders, setMyWorkOrders] = useState([]);
  const [quotes, setQuotes] = useState([]);
  const [payments, setPayments] = useState([]);
  const [pending, setPending] = useState({ pendingAmount: 0, pendingCount: 0 });
  // El calendario y el mapa son de TODOS los trabajos, como en la oficina.
  const [allWorkOrders, setAllWorkOrders] = useState([]);
  const [technicians, setTechnicians] = useState([]);
  const [companies, setCompanies] = useState([]);
  const [distributors, setDistributors] = useState([]);
  const [error, setError] = useState("");

  const loadAll = useCallback(() => {
    getWorkOrders({ scope: "all" }).then(setAllWorkOrders).catch((e) => setError(e.message));
  }, []);

  useEffect(() => {
    getWorkOrders().then(setMyWorkOrders).catch((e) => setError(e.message));
    getQuotes().then(setQuotes).catch(() => {});
    getPayments().then(setPayments).catch(() => {});
    if (user?.entityId != null) getAgentPendingCommission(user.entityId).then(setPending).catch(() => {});
    loadAll();
    getTechnicians().then(setTechnicians).catch(() => {});
    getInsuranceCompanies().then(setCompanies).catch(() => {});
    getDistributorsBasic().then(setDistributors).catch(() => {});
  }, [user?.entityId, loadAll]);

  const kpis = useMemo(() => {
    const month = moment().format("YYYY-MM");
    const year = moment().format("YYYY");
    const dateOf = (q) => String(q.date || q.createdAt || "").slice(0, 10);
    const quotesThisMonth = quotes.filter((q) => dateOf(q).startsWith(month));
    const awaiting = myWorkOrders.filter((w) => isCompletedWorkOrderStatus(w.status) && !w.payment?.paid);
    const paid = payments.filter((p) => p.status === "Paid").sort((a, b) => String(b.paymentDate || "").localeCompare(String(a.paymentDate || "")));
    return {
      quotesThisMonth: quotesThisMonth.length,
      convertedThisMonth: quotesThisMonth.filter((q) => q.status === "Converted").length,
      openJobs: myWorkOrders.filter((w) => OPEN_STATUSES.includes(w.status)).length,
      awaitingCount: awaiting.length,
      awaitingAmount: awaiting.reduce((s, w) => s + Math.max(0, Number(w.totalSale || 0) - Number(w.payment?.amount || 0)), 0),
      commissionsPaid: paid.reduce((s, p) => s + Number(p.amount || 0), 0),
      paidThisYear: paid.filter((p) => String(p.paymentDate || "").startsWith(year)).reduce((s, p) => s + Number(p.amount || 0), 0),
      lastPayment: paid[0] || null,
    };
  }, [myWorkOrders, quotes, payments]);

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

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
        <Kpi icon={QuotesIcon} label={t("kpis.quotesThisMonth")} value={kpis.quotesThisMonth} href="/dashboard/quotes" />
        <Kpi icon={CheckIcon} tone="green" label={t("kpis.convertedThisMonth")} value={kpis.convertedThisMonth} href="/dashboard/quotes" />
        <Kpi icon={WorkOrdersIcon} label={t("kpis.openJobs")} value={kpis.openJobs} href="/dashboard/workorders" />
        <Kpi icon={ClockIcon} tone="amber" label={t("kpis.awaitingPayment")} value={kpis.awaitingCount} sub={kpis.awaitingCount ? money(kpis.awaitingAmount) : undefined} href="/dashboard/workorders" />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <Kpi icon={DollarIcon} tone="amber" label={t("kpis.pendingCommission")} value={money(pending.pendingAmount)} sub={t("kpis.pendingCommissionJobs", { count: pending.pendingCount })} href="/dashboard/payments" />
        <Kpi icon={PaymentsIcon} tone="green" label={t("kpis.commissionsPaid")} value={money(kpis.commissionsPaid)} href="/dashboard/payments" />
        <Kpi icon={CalendarIcon} tone="slate" label={t("kpis.commissionPaidThisYear")} value={money(kpis.paidThisYear)} href="/dashboard/payments" />
        <Kpi
          icon={PaymentsIcon}
          tone="slate"
          label={t("kpis.lastPayment")}
          value={kpis.lastPayment ? money(kpis.lastPayment.amount) : "—"}
          sub={kpis.lastPayment ? `${kpis.lastPayment.paymentDate || ""} · ${kpis.lastPayment.paymentNumber || ""}` : t("kpis.noPaymentsYet")}
          href={kpis.lastPayment ? `/dashboard/payments/${kpis.lastPayment.id}` : "/dashboard/payments"}
        />
      </div>

      <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-gray-500 mb-3">{t("sections.calendar")}</h2>
      <div className="mb-6">
        <SchedulingCalendar workOrders={allWorkOrders} technicians={technicians} companies={companies} distributors={distributors} onRefresh={loadAll} />
      </div>

      <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-gray-500 mb-3">{t("sections.map")}</h2>
      <SchedulingCalendar workOrders={allWorkOrders} technicians={technicians} companies={companies} distributors={distributors} onRefresh={loadAll} defaultView="map" views={["map"]} />
    </div>
  );
}
