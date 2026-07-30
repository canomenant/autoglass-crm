"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import moment from "moment";
import { Link } from "@/i18n/navigation";
import { getWorkOrders, getInsuranceCompanies, getDistributors, getTechnicians, getAgents } from "@/lib/api";
import SchedulingCalendar from "@/components/SchedulingCalendar";
import SchedulingSidePanel from "@/components/SchedulingSidePanel";
import { isCompletedWorkOrderStatus } from "@/lib/workOrderStatuses";
import { STATUS_BADGE_CLASSES } from "@/lib/workOrderStatusColors";
import { ClockIcon, DollarIcon, TeamIcon, ActivityIcon } from "@/components/Icons";

function money(n) {
  return `$${Number(n || 0).toFixed(2)}`;
}

const GROUP_STYLES = {
  jobs: { icon: ClockIcon, iconClass: "bg-blue-50 text-blue-600 dark:bg-blue-500/10 dark:text-blue-400" },
  revenue: { icon: DollarIcon, iconClass: "bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-400" },
  team: { icon: TeamIcon, iconClass: "bg-slate-100 text-slate-600 dark:bg-gray-800 dark:text-gray-300" },
};

function KpiSection({ title, group, items }) {
  const { icon: GroupIcon, iconClass } = GROUP_STYLES[group];
  return (
    <div className="mb-6">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-gray-500 mb-3">{title}</h2>
      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-5 gap-4">
        {items.map((kpi) => (
          <div
            key={kpi.label}
            className="bg-white dark:bg-gray-900 dark:border dark:border-gray-800 rounded-xl shadow-sm hover:shadow-md transition-shadow p-4 flex items-start gap-3"
          >
            <div className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 ${iconClass}`}>
              <GroupIcon className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <div className="text-xs text-slate-500 dark:text-gray-400 truncate">{kpi.label}</div>
              <div className="text-xl font-bold text-slate-800 dark:text-gray-100 truncate">{kpi.value}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function DashboardPage() {
  const t = useTranslations("dashboard");
  const [workOrders, setWorkOrders] = useState([]);
  const [technicians, setTechnicians] = useState([]);
  const [agents, setAgents] = useState([]);
  const [companies, setCompanies] = useState([]);
  const [distributors, setDistributors] = useState([]);
  const [error, setError] = useState("");

  function load() {
    getWorkOrders().then(setWorkOrders).catch((e) => setError(e.message));
  }

  useEffect(() => {
    load();
    getTechnicians().then(setTechnicians).catch(() => {});
    getAgents().then(setAgents).catch(() => {});
    getInsuranceCompanies().then(setCompanies).catch(() => {});
    getDistributors().then(setDistributors).catch(() => {});
  }, []);

  const kpis = useMemo(() => {
    const today = moment().format("YYYY-MM-DD");
    const tomorrow = moment().add(1, "day").format("YYYY-MM-DD");
    const weekStart = moment().startOf("week").format("YYYY-MM-DD");
    const weekEnd = moment().endOf("week").format("YYYY-MM-DD");

    const isThisWeek = (d) => d && d >= weekStart && d <= weekEnd;
    const isThisMonth = (d) => d && moment(d).isSame(moment(), "month");

    const pendingJobs = workOrders.filter((w) => w.status === "Scheduled").length;
    const todayJobs = workOrders.filter((w) => w.appointmentDate === today).length;
    const tomorrowJobs = workOrders.filter((w) => w.appointmentDate === tomorrow).length;
    const thisWeekJobs = workOrders.filter((w) => isThisWeek(w.appointmentDate)).length;
    const inProgress = workOrders.filter((w) => w.status === "In Progress").length;
    const completed = workOrders.filter((w) => isCompletedWorkOrderStatus(w.status)).length;
    const paid = workOrders.filter((w) => isCompletedWorkOrderStatus(w.status) && w.payment?.paid).length;
    const pendingPayments = workOrders.filter((w) => isCompletedWorkOrderStatus(w.status) && !w.payment?.paid).length;
    const closed = workOrders.filter((w) => w.status === "Closed").length;
    const revenueToday = workOrders
      .filter((w) => w.payment?.paid && w.appointmentDate === today)
      .reduce((sum, w) => sum + Number(w.payment.amount || 0), 0);
    const revenueThisWeek = workOrders
      .filter((w) => w.payment?.paid && isThisWeek(w.appointmentDate))
      .reduce((sum, w) => sum + Number(w.payment.amount || 0), 0);
    const revenueThisMonth = workOrders
      .filter((w) => w.payment?.paid && isThisMonth(w.appointmentDate))
      .reduce((sum, w) => sum + Number(w.payment.amount || 0), 0);
    const outstandingBalance = workOrders
      .filter((w) => isCompletedWorkOrderStatus(w.status) && !w.payment?.paid)
      .reduce((sum, w) => sum + Number(w.payment?.amount || w.totalSale || 0), 0);

    const personalWOs = workOrders.filter((w) => w.workOrderType !== "Insurance");
    const insuranceWOs = workOrders.filter((w) => w.workOrderType === "Insurance");
    const personalRevenue = personalWOs.filter((w) => w.payment?.paid).reduce((sum, w) => sum + Number(w.payment.amount || 0), 0);
    const insuranceRevenue = insuranceWOs.filter((w) => w.payment?.paid).reduce((sum, w) => sum + Number(w.payment.amount || 0), 0);

    const totalTechnicians = technicians.length;
    const activeTechnicians = technicians.filter((t) => t.status === "Active").length;
    const totalAgents = agents.length;
    const activeAgents = agents.filter((a) => a.status === "Active").length;
    const totalDistributors = distributors.length;
    const activeDistributors = distributors.filter((d) => d.status === "Active").length;

    return {
      jobs: [
        { label: t("pendingJobs"), value: pendingJobs },
        { label: t("todaysJobs"), value: todayJobs },
        { label: t("tomorrowsJobs"), value: tomorrowJobs },
        { label: t("thisWeekJobs"), value: thisWeekJobs },
        { label: t("inProgress"), value: inProgress },
        { label: t("completed"), value: completed },
        { label: t("paid"), value: paid },
        { label: t("pendingPayment"), value: pendingPayments },
        { label: t("closed"), value: closed },
      ],
      revenue: [
        { label: t("revenueToday"), value: money(revenueToday) },
        { label: t("revenueThisWeek"), value: money(revenueThisWeek) },
        { label: t("revenueThisMonth"), value: money(revenueThisMonth) },
        { label: t("outstandingBalance"), value: money(outstandingBalance) },
        { label: t("personalRevenue"), value: money(personalRevenue) },
        { label: t("insuranceRevenue"), value: money(insuranceRevenue) },
      ],
      team: [
        { label: t("personalWorkOrders"), value: personalWOs.length },
        { label: t("insuranceWorkOrders"), value: insuranceWOs.length },
        { label: t("totalDistributors"), value: totalDistributors },
        { label: t("activeDistributors"), value: activeDistributors },
        { label: t("totalTechnicians"), value: totalTechnicians },
        { label: t("activeTechnicians"), value: activeTechnicians },
        { label: t("totalAgents"), value: totalAgents },
        { label: t("activeAgents"), value: activeAgents },
      ],
    };
  }, [workOrders, technicians, agents, distributors, t]);

  const recentActivity = useMemo(() => {
    return [...workOrders]
      .sort((a, b) => new Date(b.updatedAt || b.createdAt || 0) - new Date(a.updatedAt || a.createdAt || 0))
      .slice(0, 8);
  }, [workOrders]);

  return (
    <div>
      <h1 className="text-2xl font-semibold dark:text-gray-100 tracking-tight mb-6 dark:text-gray-100">{t("title")}</h1>

      {error && <p className="text-red-600 dark:text-red-400 text-sm mb-4">{error}</p>}

      <KpiSection title={t("jobsSectionTitle")} group="jobs" items={kpis.jobs} />
      <KpiSection title={t("revenueSectionTitle")} group="revenue" items={kpis.revenue} />
      <KpiSection title={t("teamSectionTitle")} group="team" items={kpis.team} />

      <div className="grid grid-cols-1 xl:grid-cols-[1fr_320px] gap-6 mb-6">
        <SchedulingCalendar workOrders={workOrders} technicians={technicians} companies={companies} distributors={distributors} onRefresh={load} />
        <SchedulingSidePanel workOrders={workOrders} />
      </div>

      <div className="bg-white dark:bg-gray-900 dark:border dark:border-gray-800 rounded-xl shadow-sm p-6">
        <div className="flex items-center gap-2 mb-4">
          <ActivityIcon className="w-5 h-5 text-blue-600 dark:text-blue-400" />
          <h2 className="font-semibold text-slate-800 dark:text-gray-100">{t("recentActivity")}</h2>
        </div>
        {recentActivity.length === 0 ? (
          <p className="text-sm text-slate-400 dark:text-gray-500">{t("noRecentActivity")}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left border-b border-slate-100 dark:border-gray-800 text-slate-400 dark:text-gray-500">
                  <th className="py-2 pr-4 font-medium">{t("workOrder")}</th>
                  <th className="py-2 pr-4 font-medium">{t("customer")}</th>
                  <th className="py-2 pr-4 font-medium">{t("status")}</th>
                  <th className="py-2 pr-4 font-medium">{t("appointmentDate")}</th>
                  <th className="py-2 pr-0 font-medium text-right">{t("amount")}</th>
                </tr>
              </thead>
              <tbody>
                {recentActivity.map((w) => (
                  <tr key={w.id} className="border-b last:border-0 border-slate-50 dark:border-gray-800/60 hover:bg-slate-50 dark:hover:bg-gray-800/40 transition-colors">
                    <td className="py-2.5 pr-4">
                      <Link href={`/dashboard/workorders/${w.id}`} className="font-medium text-blue-600 dark:text-blue-400 hover:underline">
                        {w.workOrderNo}
                      </Link>
                    </td>
                    <td className="py-2.5 pr-4 text-slate-600 dark:text-gray-300">{w.customerName || "—"}</td>
                    <td className="py-2.5 pr-4">
                      <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_BADGE_CLASSES[w.status] || "bg-slate-100 text-slate-600"}`}>
                        {w.status}
                      </span>
                    </td>
                    <td className="py-2.5 pr-4 text-slate-500 dark:text-gray-400">{w.appointmentDate || "—"}</td>
                    <td className="py-2.5 pr-0 text-right font-medium text-slate-700 dark:text-gray-200">{money(w.payment?.amount || w.totalSale)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
