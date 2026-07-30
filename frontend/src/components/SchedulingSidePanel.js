"use client";

import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { isCompletedWorkOrderStatus, isTerminalWorkOrderStatus } from "@/lib/workOrderStatuses";

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function tomorrowStr() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}

function JobList({ title, count, items, emptyLabel }) {
  return (
    <div className="border-b last:border-0 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800/60 transition-colors py-3">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-xs font-semibold text-gray-500 uppercase">{title}</h3>
        <span className="text-xs font-medium bg-gray-100 rounded-full px-2 py-0.5">{count}</span>
      </div>
      <div className="space-y-1.5 max-h-40 overflow-y-auto">
        {items.map((wo) => (
          <Link key={wo.id} href={`/dashboard/workorders/${wo.id}`} className="block text-sm hover:bg-gray-50 rounded px-2 py-1 -mx-2">
            <span className="font-medium">{wo.workOrderNo}</span>{" "}
            <span className="text-gray-500">{wo.customerName}</span>
            {wo.appointmentTime && <span className="text-gray-400"> · {wo.appointmentTime}</span>}
          </Link>
        ))}
        {items.length === 0 && <p className="text-xs text-gray-400">{emptyLabel}</p>}
      </div>
    </div>
  );
}

export default function SchedulingSidePanel({ workOrders }) {
  const t = useTranslations("scheduling");
  const today = todayStr();
  const tomorrow = tomorrowStr();

  const todayJobs = workOrders.filter((w) => w.appointmentDate === today);
  const tomorrowJobs = workOrders.filter((w) => w.appointmentDate === tomorrow);
  const pendingConfirmations = workOrders.filter((w) => w.status === "Scheduled");
  const lateJobs = workOrders.filter(
    (w) => w.appointmentDate && w.appointmentDate < today && !isCompletedWorkOrderStatus(w.status) && !isTerminalWorkOrderStatus(w.status)
  );
  const pendingPayments = workOrders.filter((w) => isCompletedWorkOrderStatus(w.status) && !w.payment?.paid);
  const closedJobs = workOrders.filter((w) => w.status === "Closed");
  const cancelledJobs = workOrders.filter((w) => w.status === "Cancelled");

  return (
    <div className="bg-white dark:bg-gray-900 dark:border dark:border-gray-800 rounded-lg shadow p-4">
      <h2 className="font-semibold mb-2 dark:text-gray-100">{t("sidePanelTitle")}</h2>
      <JobList title={t("todaysJobs")} count={todayJobs.length} items={todayJobs} emptyLabel={t("noJobs")} />
      <JobList title={t("tomorrowsJobs")} count={tomorrowJobs.length} items={tomorrowJobs} emptyLabel={t("noJobs")} />
      <JobList title={t("pendingConfirmations")} count={pendingConfirmations.length} items={pendingConfirmations} emptyLabel={t("noJobs")} />
      <JobList title={t("lateJobs")} count={lateJobs.length} items={lateJobs} emptyLabel={t("noJobs")} />
      <JobList title={t("pendingPayments")} count={pendingPayments.length} items={pendingPayments} emptyLabel={t("noJobs")} />
      <JobList title={t("closedJobs")} count={closedJobs.length} items={closedJobs} emptyLabel={t("noJobs")} />
      <JobList title={t("cancelledJobs")} count={cancelledJobs.length} items={cancelledJobs} emptyLabel={t("noJobs")} />
    </div>
  );
}
