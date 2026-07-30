"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { getWorkOrders, getInsuranceCompanies, getTechnicians, getInvoices, getTableViews } from "@/lib/api";
import { WORK_ORDER_STATUSES } from "@/lib/workOrderStatuses";
import { STATUS_COLORS, STATUS_BADGE_CLASSES } from "@/lib/workOrderStatusColors";
import { DEFAULT_COLUMNS, getColumnValue, MONEY_COLUMNS } from "@/lib/workOrdersTableColumns";
import ConfigureViewModal from "@/components/ConfigureViewModal";
import { SettingsIcon } from "@/components/Icons";

const MODULE = "workorders";
const PIN_WIDTH = 160;
const WORK_ORDER_TYPES = ["Personal", "Insurance"];
const TYPE_BADGE_CLASSES = {
  Personal: "bg-blue-100 text-blue-700",
  Insurance: "bg-green-100 text-green-700",
};
const TYPE_DOT_CLASSES = {
  Personal: "bg-blue-500",
  Insurance: "bg-green-500",
};
const TYPE_CHIP_SELECTED = {
  Personal: "bg-blue-500 text-white border-blue-600 shadow-sm",
  Insurance: "bg-green-500 text-white border-green-600 shadow-sm",
};

const STATUS_DOT_CLASSES = {
  Scheduled: "bg-gray-400",
  Assigned: "bg-purple-500",
  "In Progress": "bg-orange-500",
  Completed: "bg-green-500",
  Paid: "bg-emerald-500",
  Closed: "bg-green-800",
  Cancelled: "bg-red-500",
};
const STATUS_CHIP_SELECTED = {
  Scheduled: "bg-gray-500 text-white border-gray-600 shadow-sm",
  Assigned: "bg-purple-500 text-white border-purple-600 shadow-sm",
  "In Progress": "bg-orange-500 text-white border-orange-600 shadow-sm",
  Completed: "bg-green-500 text-white border-green-600 shadow-sm",
  Paid: "bg-emerald-500 text-white border-emerald-600 shadow-sm",
  Closed: "bg-green-800 text-white border-green-900 shadow-sm",
  Cancelled: "bg-red-500 text-white border-red-600 shadow-sm",
};

function FilterChip({ active, dotClass, badgeClass, selectedClass, onClick, children }) {
  const idleClass = badgeClass
    ? `${badgeClass} border-transparent hover:shadow-sm`
    : "bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 border-transparent hover:border-gray-300 dark:hover:border-gray-600";
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 text-xs font-medium rounded-full px-3 py-1.5 border transition-all ${active ? selectedClass : idleClass}`}
    >
      {dotClass && <span className={`w-2 h-2 rounded-full flex-shrink-0 ${active ? "bg-white" : dotClass}`} />}
      {children}
    </button>
  );
}

function money(n) {
  return `$${Number(n || 0).toFixed(2)}`;
}

function ChevronIcon({ open }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={`w-4 h-4 transition-transform ${open ? "rotate-90" : ""}`}>
      <polyline points="9,6 15,12 9,18" />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
      <circle cx="11" cy="11" r="7" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  );
}

export default function WorkOrdersListPage() {
  const t = useTranslations("workOrders");
  const tc = useTranslations("common");
  const tl = useTranslations("workOrdersList");
  const tt = useTranslations("tableConfigWO");
  const [workOrders, setWorkOrders] = useState([]);
  const [companies, setCompanies] = useState([]);
  const [technicians, setTechnicians] = useState([]);
  const [invoices, setInvoices] = useState([]);
  const [error, setError] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState(new Set());
  const [columns, setColumns] = useState(DEFAULT_COLUMNS);
  const [modalOpen, setModalOpen] = useState(false);

  useEffect(() => {
    getWorkOrders().then(setWorkOrders).catch((e) => setError(e.message));
    getInsuranceCompanies().then(setCompanies).catch(() => {});
    getTechnicians().then(setTechnicians).catch(() => {});
    getInvoices().then(setInvoices).catch(() => {});
    getTableViews(MODULE)
      .then((views) => {
        const defaultView = views.find((v) => v.isDefault);
        if (defaultView) setColumns(defaultView.columns);
      })
      .catch(() => {});
  }, []);

  function handleApply(newColumns) {
    setColumns(newColumns);
    setModalOpen(false);
  }

  const counts = useMemo(() => {
    const byStatus = Object.fromEntries(WORK_ORDER_STATUSES.map((s) => [s, 0]));
    let personal = 0;
    let insurance = 0;
    workOrders.forEach((w) => {
      if (byStatus[w.status] !== undefined) byStatus[w.status] += 1;
      if (w.workOrderType === "Insurance") insurance += 1;
      else personal += 1;
    });
    return { total: workOrders.length, personal, insurance, ...byStatus };
  }, [workOrders]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return workOrders.filter((w) => {
      if (statusFilter && w.status !== statusFilter) return false;
      if (typeFilter && (w.workOrderType || "Personal") !== typeFilter) return false;
      if (q) {
        const haystack = [w.workOrderNo, w.customerName, w.phone, w.claimNumber, w.vehicle?.vin, w.vehicle?.plate]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
  }, [workOrders, statusFilter, typeFilter, search]);

  function toggleExpanded(id) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const ctx = { companies, users: technicians, invoices };
  const orderedColumns = [...columns.filter((c) => c.visible && c.pinned), ...columns.filter((c) => c.visible && !c.pinned)];
  const pinnedKeys = orderedColumns.filter((c) => c.pinned).map((c) => c.key);

  function pinStyle(key) {
    const pinIndex = pinnedKeys.indexOf(key);
    if (pinIndex === -1) return {};
    return { position: "sticky", left: pinIndex * PIN_WIDTH, zIndex: 5, background: "white", minWidth: PIN_WIDTH, maxWidth: PIN_WIDTH };
  }

  function renderCell(key, w) {
    if (key === "acciones") {
      return (
        <Link href={`/dashboard/workorders/${w.id}`} className="text-blue-600 dark:text-blue-400 hover:underline">
          {tc("viewEdit")}
        </Link>
      );
    }
    if (key === "status") {
      return (
        <span className={`text-xs font-medium rounded-full px-2 py-1 whitespace-nowrap ${STATUS_BADGE_CLASSES[w.status] || "bg-gray-100 text-gray-600"}`}>
          {t(`statuses.${w.status}`)}
        </span>
      );
    }
    const value = getColumnValue(key, w, ctx);
    if (MONEY_COLUMNS.has(key)) return money(value);
    return value || "";
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6 gap-2">
        <h1 className="text-2xl font-semibold dark:text-gray-100 tracking-tight">{t("title")}</h1>
        <button
          type="button"
          onClick={() => setModalOpen(true)}
          className="border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-shadow text-sm flex items-center gap-2 text-gray-600"
        >
          <SettingsIcon className="w-4 h-4" /> {tt("configureView")}
        </button>
      </div>

      {error && <p className="text-red-600 dark:text-red-400 text-sm mb-4">{error}</p>}

      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-5 gap-3 mb-3">
        <button
          type="button"
          onClick={() => { setStatusFilter(""); setTypeFilter(""); }}
          className={`text-left bg-white dark:bg-gray-900 dark:border dark:border-gray-800 rounded-xl shadow-sm p-3 border-2 transition-colors ${!statusFilter && !typeFilter ? "border-gray-900 dark:border-blue-500" : "border-transparent"}`}
        >
          <div className="text-xs text-gray-400 uppercase">{tl("totalWorkOrders")}</div>
          <div className="text-2xl font-bold dark:text-gray-100">{counts.total}</div>
        </button>
        <button
          type="button"
          onClick={() => setTypeFilter("Personal")}
          className={`text-left bg-white dark:bg-gray-900 dark:border dark:border-gray-800 rounded-xl shadow-sm p-3 border-2 transition-colors ${typeFilter === "Personal" ? "border-gray-900 dark:border-blue-500" : "border-transparent"}`}
        >
          <div className="flex items-center gap-1.5 text-xs text-gray-400 uppercase">
            <span className="w-2 h-2 rounded-full flex-shrink-0 bg-blue-500" />
            {tl("personalOrders")}
          </div>
          <div className="text-2xl font-bold dark:text-gray-100">{counts.personal}</div>
        </button>
        <button
          type="button"
          onClick={() => setTypeFilter("Insurance")}
          className={`text-left bg-white dark:bg-gray-900 dark:border dark:border-gray-800 rounded-xl shadow-sm p-3 border-2 transition-colors ${typeFilter === "Insurance" ? "border-gray-900 dark:border-blue-500" : "border-transparent"}`}
        >
          <div className="flex items-center gap-1.5 text-xs text-gray-400 uppercase">
            <span className="w-2 h-2 rounded-full flex-shrink-0 bg-green-500" />
            {tl("insuranceOrders")}
          </div>
          <div className="text-2xl font-bold dark:text-gray-100">{counts.insurance}</div>
        </button>
        {WORK_ORDER_STATUSES.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setStatusFilter(s)}
            className={`text-left bg-white dark:bg-gray-900 dark:border dark:border-gray-800 rounded-xl shadow-sm p-3 border-2 transition-colors ${statusFilter === s ? "border-gray-900 dark:border-blue-500" : "border-transparent"}`}
          >
            <div className="flex items-center gap-1.5 text-xs text-gray-400 uppercase">
              <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: STATUS_COLORS[s] }} />
              {t(`statuses.${s}`)}
            </div>
            <div className="text-2xl font-bold dark:text-gray-100">{counts[s]}</div>
          </button>
        ))}
      </div>

      <div className="bg-white dark:bg-gray-900 dark:border dark:border-gray-800 rounded-xl shadow-sm p-4 mb-4">
        <h2 className="text-sm font-semibold dark:text-gray-100 mb-3">{tl("filtersTitle")}</h2>

        <div className="mb-3">
          <div className="text-xs text-gray-400 uppercase mb-1.5">{tl("type")}</div>
          <div className="flex flex-wrap items-center gap-2">
            <FilterChip active={typeFilter === ""} onClick={() => setTypeFilter("")} selectedClass="bg-gray-900 dark:bg-blue-600 text-white border-gray-900 dark:border-blue-600 shadow-sm">
              {tc("allStatuses")}
            </FilterChip>
            {WORK_ORDER_TYPES.map((ty) => (
              <FilterChip
                key={ty}
                active={typeFilter === ty}
                onClick={() => setTypeFilter(ty)}
                dotClass={TYPE_DOT_CLASSES[ty]}
                badgeClass={TYPE_BADGE_CLASSES[ty]}
                selectedClass={TYPE_CHIP_SELECTED[ty]}
              >
                {tl(`type${ty}`)}
              </FilterChip>
            ))}
          </div>
        </div>

        <div>
          <div className="text-xs text-gray-400 uppercase mb-1.5">{t("status")}</div>
          <div className="flex flex-wrap items-center gap-2">
            <FilterChip active={statusFilter === ""} onClick={() => setStatusFilter("")} selectedClass="bg-gray-900 dark:bg-blue-600 text-white border-gray-900 dark:border-blue-600 shadow-sm">
              {tc("allStatuses")}
            </FilterChip>
            {WORK_ORDER_STATUSES.map((s) => (
              <FilterChip
                key={s}
                active={statusFilter === s}
                onClick={() => setStatusFilter(s)}
                dotClass={STATUS_DOT_CLASSES[s]}
                badgeClass={STATUS_BADGE_CLASSES[s]}
                selectedClass={STATUS_CHIP_SELECTED[s]}
              >
                {t(`statuses.${s}`)}
              </FilterChip>
            ))}
          </div>
        </div>
      </div>

      <div className="relative max-w-sm mb-4">
        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"><SearchIcon /></span>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={tl("searchPlaceholder")}
          className="w-full border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded-lg pl-9 pr-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-shadow text-sm"
        />
      </div>

      <div className="bg-white dark:bg-gray-900 dark:border dark:border-gray-800 rounded-xl shadow-sm overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left border-b dark:border-gray-800">
              <th className="p-3 w-8"></th>
              {orderedColumns.map((col) => (
                <th key={col.key} className="p-3 whitespace-nowrap" style={pinStyle(col.key)}>{tt(`columns.${col.key}`)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.map((w) => {
              const isOpen = expanded.has(w.id);
              return (
                <Fragment key={w.id}>
                  <tr className="border-b last:border-0 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800/60 transition-colors">
                    <td className="p-3">
                      <button type="button" onClick={() => toggleExpanded(w.id)} className="text-gray-400 hover:text-gray-700 dark:hover:text-gray-200">
                        <ChevronIcon open={isOpen} />
                      </button>
                    </td>
                    {orderedColumns.map((col) => (
                      <td key={col.key} className="p-3 whitespace-nowrap" style={pinStyle(col.key)}>{renderCell(col.key, w)}</td>
                    ))}
                  </tr>
                  {isOpen && (
                    <tr className="border-b last:border-0 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/40">
                      <td className="p-3" />
                      <td className="p-3" colSpan={orderedColumns.length}>
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-6 gap-y-2 text-xs">
                          <div><span className="text-gray-400">{tc("phone")}: </span>{w.phone || "—"}</div>
                          <div><span className="text-gray-400">{t("claimNumber")}: </span>{w.claimNumber || "—"}</div>
                          <div><span className="text-gray-400">{t("partNumberLabel")} </span>{w.partNumber || "—"}</div>
                          <div><span className="text-gray-400">{t("distributor")}: </span>{w.distributor || "—"}</div>
                          <div><span className="text-gray-400">{tc("vin")}: </span>{w.vehicle?.vin || "—"}</div>
                          <div><span className="text-gray-400">{tc("plate")}: </span>{w.vehicle?.plate || "—"}</div>
                          <div className="col-span-2 sm:col-span-4"><span className="text-gray-400">{tl("notes")}: </span>{w.specialInstructions || "—"}</div>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
            {filtered.length === 0 && !error && (
              <tr><td className="p-3 text-gray-500" colSpan={orderedColumns.length + 1}>{t("noRecords")}</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {modalOpen && (
        <ConfigureViewModal
          module={MODULE}
          columns={columns}
          defaultColumns={DEFAULT_COLUMNS}
          onApply={handleApply}
          onClose={() => setModalOpen(false)}
          title={tt("modalTitle")}
          subtitle={tt("modalSubtitle")}
          applyLabel={tt("apply")}
          t={tt}
          previewRows={filtered.slice(0, 6)}
          renderPreviewCell={renderCell}
          previewFilters={{
            date: (w) => w.appointmentDate,
            status: {
              allLabel: tc("allStatuses"),
              get: (w) => w.status,
              options: WORK_ORDER_STATUSES.map((s) => ({ value: s, label: t(`statuses.${s}`) })),
            },
            technician: {
              allLabel: tt("allTechnicians"),
              get: (w) => w.tech,
              options: technicians.map((tech) => ({ value: tech.name, label: tech.name })),
            },
          }}
        />
      )}
    </div>
  );
}
