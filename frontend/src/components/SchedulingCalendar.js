"use client";

import { useMemo, useState } from "react";
import { Calendar, momentLocalizer, Views } from "react-big-calendar";
import withDragAndDrop from "react-big-calendar/lib/addons/dragAndDrop";
import moment from "moment";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { updateWorkOrder } from "@/lib/api";
import { getStatusColor, STATUS_COLORS } from "@/lib/workOrderStatusColors";
import { WORK_ORDER_STATUSES } from "@/lib/workOrderStatuses";
import "react-big-calendar/lib/css/react-big-calendar.css";
import "react-big-calendar/lib/addons/dragAndDrop/styles.css";

const localizer = momentLocalizer(moment);
const DnDCalendar = withDragAndDrop(Calendar);

const STATUSES = WORK_ORDER_STATUSES;

function woToEvent(wo) {
  if (!wo.appointmentDate) return null;
  const time = wo.appointmentTime || "09:00";
  const start = moment(`${wo.appointmentDate} ${time}`, "YYYY-MM-DD HH:mm").toDate();
  const duration = wo.appointmentDurationMinutes || 60;
  const end = moment(start).add(duration, "minutes").toDate();
  return {
    id: wo.id,
    title: wo.workOrderNo,
    start,
    end,
    resource: wo,
  };
}

export default function SchedulingCalendar({ workOrders, technicians, companies, distributors, onRefresh }) {
  const t = useTranslations("scheduling");
  const tw = useTranslations("workOrders");
  const [view, setView] = useState(Views.WEEK);
  const [date, setDate] = useState(new Date());
  const [contextMenu, setContextMenu] = useState(null);
  const [filters, setFilters] = useState({
    technicianId: "",
    status: "",
    insuranceCompanyId: "",
    distributor: "",
    jobType: "",
    dateFrom: "",
    dateTo: "",
    paymentStatus: "",
  });

  const jobTypes = useMemo(() => [...new Set(workOrders.map((w) => w.jobType).filter(Boolean))], [workOrders]);

  const filtered = useMemo(() => {
    return workOrders.filter((wo) => {
      if (filters.technicianId && String(wo.technicianId) !== filters.technicianId) return false;
      if (filters.status && wo.status !== filters.status) return false;
      if (filters.insuranceCompanyId && String(wo.insuranceCompanyId) !== filters.insuranceCompanyId) return false;
      if (filters.distributor && wo.distributor !== filters.distributor) return false;
      if (filters.jobType && wo.jobType !== filters.jobType) return false;
      if (filters.dateFrom && (!wo.appointmentDate || wo.appointmentDate < filters.dateFrom)) return false;
      if (filters.dateTo && (!wo.appointmentDate || wo.appointmentDate > filters.dateTo)) return false;
      if (filters.paymentStatus === "Paid" && !wo.payment?.paid) return false;
      if (filters.paymentStatus === "Unpaid" && wo.payment?.paid) return false;
      return true;
    });
  }, [workOrders, filters]);

  const events = useMemo(() => filtered.map(woToEvent).filter(Boolean), [filtered]);

  function companyName(id) {
    return companies.find((c) => c.id === id)?.name || "";
  }

  async function persist(id, data) {
    try {
      await updateWorkOrder(id, data);
      onRefresh();
    } catch (e) {
      alert(e.message);
    }
  }

  function handleEventDrop({ event, start }) {
    const wo = event.resource;
    persist(wo.id, {
      appointmentDate: moment(start).format("YYYY-MM-DD"),
      appointmentTime: moment(start).format("HH:mm"),
    });
  }

  function handleEventResize({ event, start, end }) {
    const wo = event.resource;
    const minutes = moment(end).diff(moment(start), "minutes");
    persist(wo.id, {
      appointmentDate: moment(start).format("YYYY-MM-DD"),
      appointmentTime: moment(start).format("HH:mm"),
      appointmentDurationMinutes: minutes,
    });
  }

  function eventPropGetter(event) {
    const color = getStatusColor(event.resource);
    return { style: { backgroundColor: color, borderColor: color } };
  }

  function tooltipAccessor(event) {
    const wo = event.resource;
    return [
      wo.customerName,
      wo.phone && `${t("phone")}: ${wo.phone}`,
      wo.address && `${t("address")}: ${wo.address}`,
      [wo.vehicle?.year, wo.vehicle?.make, wo.vehicle?.model].filter(Boolean).join(" "),
      wo.insuranceCompanyId && `${t("insurance")}: ${companyName(wo.insuranceCompanyId)}`,
      wo.tech && `${t("technician")}: ${wo.tech}`,
      `${t("status")}: ${wo.status}`,
    ]
      .filter(Boolean)
      .join("\n");
  }

  function EventContent({ event }) {
    const wo = event.resource;
    return (
      <div
        onContextMenu={(e) => {
          e.preventDefault();
          setContextMenu({ x: e.clientX, y: e.clientY, wo });
        }}
        className="text-[11px] leading-tight overflow-hidden"
      >
        <div className="font-semibold truncate">{wo.workOrderNo} · {wo.customerName}</div>
        <div className="truncate">{[wo.vehicle?.year, wo.vehicle?.make, wo.vehicle?.model].filter(Boolean).join(" ")}</div>
        <div className="truncate">{wo.tech} {wo.jobType ? `· ${wo.jobType}` : ""}</div>
      </div>
    );
  }

  function closeMenu() {
    setContextMenu(null);
  }

  async function handleStatusChange(wo, status) {
    await persist(wo.id, { status });
    closeMenu();
  }

  async function handleMarkPaid(wo) {
    await persist(wo.id, { payment: { ...wo.payment, paid: true } });
    closeMenu();
  }

  return (
    <div className="bg-white dark:bg-gray-900 dark:border dark:border-gray-800 rounded-lg shadow p-4" onClick={closeMenu}>
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-2 mb-4">
        <select value={filters.technicianId} onChange={(e) => setFilters((f) => ({ ...f, technicianId: e.target.value }))} className="border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-2 py-1.5 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-shadow text-xs dark:bg-gray-800 dark:border-gray-700 dark:text-gray-100">
          <option value="">{t("allTechnicians")}</option>
          {technicians.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
        </select>
        <select value={filters.status} onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value }))} className="border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-2 py-1.5 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-shadow text-xs dark:bg-gray-800 dark:border-gray-700 dark:text-gray-100">
          <option value="">{t("allStatuses")}</option>
          {STATUSES.map((s) => <option key={s} value={s}>{tw(`statuses.${s}`)}</option>)}
        </select>
        <select value={filters.insuranceCompanyId} onChange={(e) => setFilters((f) => ({ ...f, insuranceCompanyId: e.target.value }))} className="border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-2 py-1.5 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-shadow text-xs dark:bg-gray-800 dark:border-gray-700 dark:text-gray-100">
          <option value="">{t("allInsurance")}</option>
          {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <select value={filters.distributor} onChange={(e) => setFilters((f) => ({ ...f, distributor: e.target.value }))} className="border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-2 py-1.5 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-shadow text-xs dark:bg-gray-800 dark:border-gray-700 dark:text-gray-100">
          <option value="">{t("allDistributors")}</option>
          {distributors.map((d) => <option key={d.id} value={d.name}>{d.name}</option>)}
        </select>
        <select value={filters.jobType} onChange={(e) => setFilters((f) => ({ ...f, jobType: e.target.value }))} className="border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-2 py-1.5 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-shadow text-xs dark:bg-gray-800 dark:border-gray-700 dark:text-gray-100">
          <option value="">{t("allJobTypes")}</option>
          {jobTypes.map((j) => <option key={j} value={j}>{j}</option>)}
        </select>
        <select value={filters.paymentStatus} onChange={(e) => setFilters((f) => ({ ...f, paymentStatus: e.target.value }))} className="border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-2 py-1.5 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-shadow text-xs dark:bg-gray-800 dark:border-gray-700 dark:text-gray-100">
          <option value="">{t("allPaymentStatus")}</option>
          <option value="Paid">{t("paid")}</option>
          <option value="Unpaid">{t("unpaid")}</option>
        </select>
        <input type="date" value={filters.dateFrom} onChange={(e) => setFilters((f) => ({ ...f, dateFrom: e.target.value }))} className="border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-2 py-1.5 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-shadow text-xs dark:bg-gray-800 dark:border-gray-700 dark:text-gray-100" />
        <input type="date" value={filters.dateTo} onChange={(e) => setFilters((f) => ({ ...f, dateTo: e.target.value }))} className="border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-2 py-1.5 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-shadow text-xs dark:bg-gray-800 dark:border-gray-700 dark:text-gray-100" />
      </div>

      <div className="overflow-x-auto">
        <DnDCalendar
          localizer={localizer}
          events={events}
          view={view}
          onView={setView}
          date={date}
          onNavigate={setDate}
          views={[Views.DAY, Views.WEEK, Views.MONTH, Views.AGENDA]}
          startAccessor="start"
          endAccessor="end"
          style={{ height: 650, minWidth: 700 }}
          eventPropGetter={eventPropGetter}
          tooltipAccessor={tooltipAccessor}
          onSelectEvent={(event) => { window.location.href = `/dashboard/workorders/${event.resource.id}`; }}
          onEventDrop={handleEventDrop}
          onEventResize={handleEventResize}
          resizable
          draggableAccessor={() => true}
          components={{ event: EventContent }}
          min={moment().set({ hour: 7, minute: 0 }).toDate()}
          max={moment().set({ hour: 18, minute: 0 }).toDate()}
        />
      </div>

      {contextMenu && (
        <div
          className="fixed bg-white dark:bg-gray-800 dark:border dark:border-gray-700 rounded-xl shadow-xl border py-1 z-50 text-sm min-w-[180px]"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          <Link href={`/dashboard/workorders/${contextMenu.wo.id}`} className="block px-4 py-2 hover:bg-gray-50">
            {t("openWorkOrder")}
          </Link>
          <div className="px-4 py-1 text-xs text-gray-400 uppercase mt-1">{t("changeStatus")}</div>
          {STATUSES.map((s) => (
            <button key={s} onClick={() => handleStatusChange(contextMenu.wo, s)} className="block w-full text-left px-4 py-1.5 hover:bg-gray-50">
              {tw(`statuses.${s}`)}
            </button>
          ))}
          <div className="border-t mt-1 pt-1">
            <button onClick={() => handleMarkPaid(contextMenu.wo)} className="block w-full text-left px-4 py-2 hover:bg-gray-50">
              {t("markAsPaid")}
            </button>
            {contextMenu.wo.address && (
              <a
                href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(contextMenu.wo.address)}`}
                target="_blank"
                rel="noreferrer"
                className="block px-4 py-2 hover:bg-gray-50"
              >
                {t("openMaps")}
              </a>
            )}
          </div>
        </div>
      )}

      <div className="flex flex-wrap gap-3 mt-4 text-xs text-gray-500">
        {WORK_ORDER_STATUSES.map((key) => (
          <div key={key} className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded-sm inline-block" style={{ backgroundColor: STATUS_COLORS[key] }} />
            {tw(`statuses.${key}`)}
          </div>
        ))}
      </div>
    </div>
  );
}
