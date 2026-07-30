"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { getPayments, getPaymentsDashboard, markPaymentReady, approvePayment, payPayment, cancelPayment, getCurrentUser } from "@/lib/api";
import { getPaymentPermissions } from "@/lib/permissions";

const TYPES = ["TECHNICIAN", "DISTRIBUTOR", "AGENT"];
const STATUSES = ["Pending", "Ready For Payment", "Approved", "Paid", "Cancelled"];

const STATUS_COLORS = {
  Pending: "bg-amber-100 text-amber-700",
  "Ready For Payment": "bg-purple-100 text-purple-700",
  Approved: "bg-blue-100 text-blue-700",
  Paid: "bg-green-100 text-green-700",
  Cancelled: "bg-gray-200 text-gray-600",
};

function money(n) {
  return `$${Number(n || 0).toFixed(2)}`;
}

function StatusBadge({ status }) {
  return (
    <span className={`text-xs font-medium rounded-full px-2 py-1 ${STATUS_COLORS[status] || "bg-gray-100 text-gray-600"}`}>
      {status}
    </span>
  );
}

function toCsv(rows) {
  const header = ["Payment No", "Type", "Status", "Amount", "Payment Method", "Payment Date", "Notes"];
  const lines = rows.map((p) =>
    [p.paymentNumber, p.type, p.status, p.amount, p.paymentMethod, p.paymentDate, p.notes]
      .map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`)
      .join(",")
  );
  return [header.join(","), ...lines].join("\n");
}

export default function PaymentsPage() {
  const t = useTranslations("payments");
  const tn = useTranslations("notes");
  const tc = useTranslations("common");
  const [payments, setPayments] = useState([]);
  const [kpis, setKpis] = useState(null);
  const [error, setError] = useState("");
  const [filters, setFilters] = useState({ search: "", type: "", status: "", dateFrom: "", dateTo: "" });
  const [user, setUser] = useState(null);
  const perms = getPaymentPermissions(user?.role);

  useEffect(() => {
    setUser(getCurrentUser());
  }, []);

  function load() {
    getPayments(filters).then(setPayments).catch((e) => setError(e.message));
    getPaymentsDashboard().then(setKpis).catch(() => {});
  }

  useEffect(load, [filters.type, filters.status, filters.dateFrom, filters.dateTo]);
  useEffect(() => {
    const timeout = setTimeout(load, 300);
    return () => clearTimeout(timeout);
  }, [filters.search]);

  async function handleMarkReady(id) {
    try {
      await markPaymentReady(id);
      load();
    } catch (e) {
      setError(e.message);
    }
  }

  async function handleApprove(id) {
    if (!confirm(t("confirmApprove"))) return;
    try {
      await approvePayment(id);
      load();
    } catch (e) {
      setError(e.message);
    }
  }

  async function handleMarkPaid(id) {
    try {
      await payPayment(id, {});
      load();
    } catch (e) {
      setError(e.message);
    }
  }

  async function handleCancel(id) {
    if (!confirm(t("confirmCancel"))) return;
    const reason = prompt(t("cancelReasonPrompt")) || "";
    try {
      await cancelPayment(id, reason);
      load();
    } catch (e) {
      setError(e.message);
    }
  }

  function handleExportCsv() {
    const csv = toCsv(payments);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "payments.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  const kpiCards = useMemo(() => {
    if (!kpis) return [];
    return [
      { label: t("kpiPendingTechnician"), value: kpis.pendingTechnician },
      { label: t("kpiPendingDistributor"), value: kpis.pendingDistributor },
      { label: t("kpiPendingAgent"), value: kpis.pendingAgent },
      { label: t("kpiTotalThisMonth"), value: money(kpis.totalThisMonth) },
      { label: t("kpiTotalPaidThisMonth"), value: money(kpis.totalPaidThisMonth) },
      { label: t("kpiOutstanding"), value: money(kpis.outstandingAmount) },
      { label: t("kpiAverageMonthly"), value: money(kpis.averageMonthlyPayments) },
      { label: tn("kpiActiveCreditNotes"), value: kpis.activeCreditNotes },
      { label: tn("kpiActiveDebitNotes"), value: kpis.activeDebitNotes },
      { label: tn("kpiNetFinancialAdjustments"), value: money(kpis.netFinancialAdjustments) },
    ];
  }, [kpis, t, tn]);

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <div>
          <h1 className="text-2xl font-semibold dark:text-gray-100 tracking-tight">{t("title")}</h1>
          <p className="text-sm text-gray-500">{t("subtitle")}</p>
        </div>
        <div className="flex gap-2">
          <button onClick={handleExportCsv} className="border rounded px-4 py-2 text-sm">{t("exportCsv")}</button>
          <button onClick={() => window.print()} className="border rounded px-4 py-2 text-sm">{t("print")}</button>
          {perms.create && (
            <Link href="/dashboard/payments/create" className="bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors px-4 py-2 text-sm">
              {t("newPayment")}
            </Link>
          )}
        </div>
      </div>

      <div className="flex gap-4 text-sm mb-6 border-b">
        <span className="px-1 py-2 border-b-2 border-gray-900 font-medium">{t("title")}</span>
        <Link href="/dashboard/payments/technicians" className="px-1 py-2 text-gray-500 hover:text-gray-900">{t("technicianReport")}</Link>
        <Link href="/dashboard/payments/distributors" className="px-1 py-2 text-gray-500 hover:text-gray-900">{t("distributorReport")}</Link>
        <Link href="/dashboard/payments/agents" className="px-1 py-2 text-gray-500 hover:text-gray-900">{t("agentReport")}</Link>
        <Link href="/dashboard/payments/credit-notes" className="px-1 py-2 text-gray-500 hover:text-gray-900">{tn("creditNotesTitle")}</Link>
        <Link href="/dashboard/payments/debit-notes" className="px-1 py-2 text-gray-500 hover:text-gray-900">{tn("debitNotesTitle")}</Link>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        {kpiCards.map((kpi) => (
          <div key={kpi.label} className="bg-white dark:bg-gray-900 dark:border dark:border-gray-800 rounded-xl shadow-sm p-4">
            <div className="text-xs text-gray-500">{kpi.label}</div>
            <div className="text-xl font-bold">{kpi.value}</div>
          </div>
        ))}
      </div>

      <div className="bg-white dark:bg-gray-900 dark:border dark:border-gray-800 rounded-xl shadow-sm p-4 mb-4 grid grid-cols-1 md:grid-cols-5 gap-3">
        <input
          value={filters.search}
          onChange={(e) => setFilters((f) => ({ ...f, search: e.target.value }))}
          placeholder={t("searchPlaceholder")}
          className="border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-shadow text-sm md:col-span-2"
        />
        <select value={filters.type} onChange={(e) => setFilters((f) => ({ ...f, type: e.target.value }))} className="border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-shadow text-sm">
          <option value="">{t("allTypes")}</option>
          {TYPES.map((tp) => <option key={tp} value={tp}>{t(`types.${tp}`)}</option>)}
        </select>
        <select value={filters.status} onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value }))} className="border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-shadow text-sm">
          <option value="">{t("allStatuses")}</option>
          {STATUSES.map((s) => <option key={s} value={s}>{t(`statuses.${s}`)}</option>)}
        </select>
        <div className="flex gap-2">
          <input type="date" value={filters.dateFrom} onChange={(e) => setFilters((f) => ({ ...f, dateFrom: e.target.value }))} className="border rounded px-2 py-2 text-sm w-1/2" />
          <input type="date" value={filters.dateTo} onChange={(e) => setFilters((f) => ({ ...f, dateTo: e.target.value }))} className="border rounded px-2 py-2 text-sm w-1/2" />
        </div>
      </div>

      {error && <p className="text-red-600 dark:text-red-400 text-sm mb-4">{error}</p>}

      <div className="bg-white dark:bg-gray-900 dark:border dark:border-gray-800 rounded-xl shadow-sm overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-white">
            <tr className="text-left border-b dark:border-gray-800">
              <th className="p-3">{t("paymentNo")}</th>
              <th className="p-3">{t("type")}</th>
              <th className="p-3">{t("amount")}</th>
              <th className="p-3">{t("status")}</th>
              <th className="p-3">{tc("date")}</th>
              <th className="p-3"></th>
            </tr>
          </thead>
          <tbody>
            {payments.map((p) => (
              <tr key={p.id} className="border-b last:border-0 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800/60 transition-colors">
                <td className="p-3 font-medium">
                  {p.paymentNumber || <span className="italic text-gray-400 font-normal">{t("draftNoNumber")}</span>}
                </td>
                <td className="p-3">{t(`types.${p.type}`)}</td>
                <td className="p-3">{money(p.amount)}</td>
                <td className="p-3"><StatusBadge status={p.status} /></td>
                <td className="p-3">{p.paymentDate || p.createdAt?.slice(0, 10)}</td>
                <td className="p-3">
                  <div className="flex items-center justify-end gap-3">
                    {perms.approve && p.status === "Pending" && (
                      <button onClick={() => handleMarkReady(p.id)} className="text-purple-600 text-xs">{t("markReady")}</button>
                    )}
                    {perms.approve && p.status === "Ready For Payment" && (
                      <button onClick={() => handleApprove(p.id)} className="text-blue-600 text-xs">{t("approve")}</button>
                    )}
                    {perms.pay && p.status === "Approved" && (
                      <button onClick={() => handleMarkPaid(p.id)} className="text-green-600 text-xs">{t("markPaid")}</button>
                    )}
                    {perms.edit && p.status !== "Paid" && p.status !== "Cancelled" && (
                      <button onClick={() => handleCancel(p.id)} className="text-red-500 text-xs">{t("cancelPayment")}</button>
                    )}
                    <Link href={`/dashboard/payments/${p.id}`} className="text-gray-600 text-xs">{tc("viewEdit")}</Link>
                  </div>
                </td>
              </tr>
            ))}
            {payments.length === 0 && !error && (
              <tr><td className="p-3 text-gray-500" colSpan={6}>{t("noRecords")}</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
