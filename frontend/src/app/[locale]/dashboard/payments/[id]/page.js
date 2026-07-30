"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import PaymentForm from "@/components/PaymentForm";
import {
  getPayment,
  updatePayment,
  markPaymentReady,
  approvePayment,
  payPayment,
  cancelPayment,
  getPaymentNotes,
  getWorkOrders,
  getCurrentUser,
} from "@/lib/api";
import { getPaymentPermissions } from "@/lib/permissions";

function money(n) {
  return `$${Number(n || 0).toFixed(2)}`;
}

export default function PaymentDetailPage() {
  const { id } = useParams();
  const t = useTranslations("payments");
  const tn = useTranslations("notes");
  const tc = useTranslations("common");
  const [payment, setPayment] = useState(null);
  const [notes, setNotes] = useState([]);
  const [linkedWorkOrders, setLinkedWorkOrders] = useState([]);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const user = getCurrentUser();
  const perms = getPaymentPermissions(user?.role);

  function load() {
    getPayment(id)
      .then((p) => {
        setPayment(p);
        return getWorkOrders().then((all) => {
          const idSet = new Set(p.workOrderIds || []);
          setLinkedWorkOrders(all.filter((w) => idSet.has(w.id)));
        });
      })
      .catch((e) => setError(e.message));
    getPaymentNotes(id).then(setNotes).catch(() => {});
  }

  useEffect(load, [id]);

  async function handleSubmit(data) {
    try {
      const updated = await updatePayment(id, data);
      setPayment(updated);
      setMessage(t("updated"));
    } catch (e) {
      setError(e.message);
    }
  }

  async function handleAction(action) {
    try {
      let updated;
      if (action === "mark-ready") updated = await markPaymentReady(id);
      if (action === "approve") updated = await approvePayment(id);
      if (action === "pay") updated = await payPayment(id, {});
      if (action === "cancel") {
        if (!confirm(t("confirmCancel"))) return;
        const reason = prompt(t("cancelReasonPrompt")) || "";
        updated = await cancelPayment(id, reason);
      }
      setPayment(updated);
    } catch (e) {
      setError(e.message);
    }
  }

  if (error) return <p className="text-red-600 dark:text-red-400 text-sm">{error}</p>;
  if (!payment) return <p className="text-gray-500 text-sm">{tc("loading")}</p>;

  return (
    <div>
      <Link href="/dashboard/payments" className="text-sm text-gray-500">← {t("backToPayments")}</Link>

      <div className="flex items-center justify-between my-4">
        <h1 className="text-2xl font-semibold dark:text-gray-100 tracking-tight">
          {payment.paymentNumber ? t("paymentDetail", { no: payment.paymentNumber }) : t("paymentDetailDraft")}
        </h1>
        <div className="flex gap-2">
          {perms.approve && payment.status === "Pending" && (
            <button onClick={() => handleAction("mark-ready")} className="border rounded px-4 py-2 text-sm">{t("markReady")}</button>
          )}
          {perms.approve && payment.status === "Ready For Payment" && (
            <button onClick={() => handleAction("approve")} className="bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors px-4 py-2 text-sm">{t("approve")}</button>
          )}
          {perms.pay && payment.status === "Approved" && (
            <button onClick={() => handleAction("pay")} className="bg-green-600 text-white rounded px-4 py-2 text-sm">{t("markPaid")}</button>
          )}
          {perms.edit && payment.status !== "Paid" && payment.status !== "Cancelled" && (
            <button onClick={() => handleAction("cancel")} className="border border-red-300 text-red-600 rounded px-4 py-2 text-sm">{t("cancelPayment")}</button>
          )}
        </div>
      </div>

      {message && <p className="text-green-600 dark:text-green-400 text-sm mb-4">{message}</p>}

      <div className="bg-gray-50 rounded-lg p-4 mb-6 flex flex-wrap gap-6">
        <div>
          <div className="text-xs text-gray-500">{t("type")}</div>
          <div className="font-semibold">{t(`types.${payment.type}`)}</div>
        </div>
        <div>
          <div className="text-xs text-gray-500">{t("status")}</div>
          <div className="font-semibold">{t(`statuses.${payment.status}`)}</div>
        </div>
        <div>
          <div className="text-xs text-gray-500">{t("amount")}</div>
          <div className="font-semibold">{money(payment.amount)}</div>
        </div>
        {(payment.creditNotesTotal > 0 || payment.debitNotesTotal > 0) && (
          <>
            <div>
              <div className="text-xs text-gray-500">{tn("creditNotesTitle")}</div>
              <div className="font-semibold text-green-700">- {money(payment.creditNotesTotal)}</div>
            </div>
            <div>
              <div className="text-xs text-gray-500">{tn("debitNotesTitle")}</div>
              <div className="font-semibold text-red-700">+ {money(payment.debitNotesTotal)}</div>
            </div>
          </>
        )}
      </div>

      <section className="bg-white dark:bg-gray-900 dark:border dark:border-gray-800 rounded-xl shadow-sm p-4 mb-6">
        <h2 className="font-semibold mb-3">{t("linkedWorkOrders", { count: linkedWorkOrders.length })}</h2>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left border-b dark:border-gray-800 text-xs text-gray-400 uppercase">
              <th className="p-2">{t("workOrder")}</th>
              <th className="p-2">{t("customer")}</th>
              <th className="p-2">{t("vehicle")}</th>
              <th className="p-2">{t("appointmentDate")}</th>
              <th className="p-2"></th>
            </tr>
          </thead>
          <tbody>
            {linkedWorkOrders.map((w) => (
              <tr key={w.id} className="border-b last:border-0 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800/60 transition-colors">
                <td className="p-2 font-medium">{w.workOrderNo}</td>
                <td className="p-2">{w.customerName || "—"}</td>
                <td className="p-2">{[w.vehicle?.year, w.vehicle?.make, w.vehicle?.model].filter(Boolean).join(" ") || "—"}</td>
                <td className="p-2">{w.appointmentDate || "—"}</td>
                <td className="p-2"><Link href={`/dashboard/workorders/${w.id}`} className="text-blue-600 text-xs">{tc("viewEdit")}</Link></td>
              </tr>
            ))}
            {linkedWorkOrders.length === 0 && <tr><td className="p-2 text-gray-500" colSpan={5}>{t("noRecords")}</td></tr>}
          </tbody>
        </table>
      </section>

      <section className="bg-white dark:bg-gray-900 dark:border dark:border-gray-800 rounded-xl shadow-sm p-4 mb-6">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold">{tn("linkedNotes")}</h2>
          <div className="flex gap-2">
            <Link href="/dashboard/payments/credit-notes/create" className="text-xs text-blue-600">{tn("newCreditNote")}</Link>
            <Link href="/dashboard/payments/debit-notes/create" className="text-xs text-blue-600">{tn("newDebitNote")}</Link>
          </div>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left border-b dark:border-gray-800 text-xs text-gray-400 uppercase">
              <th className="p-2">{tn("noteNo")}</th>
              <th className="p-2">{t("type")}</th>
              <th className="p-2">{tc("amount")}</th>
              <th className="p-2">{t("status")}</th>
              <th className="p-2"></th>
            </tr>
          </thead>
          <tbody>
            {notes.map((n) => (
              <tr key={n.id} className="border-b last:border-0 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800/60 transition-colors">
                <td className="p-2">{n.noteNumber}</td>
                <td className="p-2">{n.noteType === "CREDIT" ? tn("creditNotesTitle") : tn("debitNotesTitle")}</td>
                <td className="p-2">{money(n.amount)}</td>
                <td className="p-2">{tn(`statuses.${n.status}`)}</td>
                <td className="p-2">
                  <Link
                    href={`/dashboard/payments/${n.noteType === "CREDIT" ? "credit-notes" : "debit-notes"}/${n.id}`}
                    className="text-blue-600 text-xs"
                  >
                    {tc("viewEdit")}
                  </Link>
                </td>
              </tr>
            ))}
            {notes.length === 0 && <tr><td className="p-2 text-gray-500" colSpan={5}>{tn("noRecords")}</td></tr>}
          </tbody>
        </table>
      </section>

      {perms.edit ? (
        <PaymentForm type={payment.type} initialData={payment} onSubmit={handleSubmit} submitLabel={tc("saveChanges")} />
      ) : (
        <p className="text-sm text-gray-500">{tc("viewEdit")}</p>
      )}

      <section className="bg-white dark:bg-gray-900 dark:border dark:border-gray-800 rounded-xl shadow-sm p-4 mt-6">
        <h2 className="font-semibold mb-3">{t("auditTrail")}</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left border-b dark:border-gray-800 text-xs text-gray-400 uppercase">
                <th className="p-2">{t("auditTimestamp")}</th>
                <th className="p-2">{t("auditUser")}</th>
                <th className="p-2">{t("auditAction")}</th>
              </tr>
            </thead>
            <tbody>
              {(payment.auditLog || []).slice().reverse().map((entry, i) => (
                <tr key={i} className="border-b last:border-0 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800/60 transition-colors">
                  <td className="p-2">{new Date(entry.timestamp).toLocaleString()}</td>
                  <td className="p-2">{entry.user}</td>
                  <td className="p-2">{entry.action}</td>
                </tr>
              ))}
              {(!payment.auditLog || payment.auditLog.length === 0) && (
                <tr><td className="p-2 text-gray-500" colSpan={3}>{t("noAuditRecords")}</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
