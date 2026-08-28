"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import NoteForm from "@/components/NoteForm";
import { getDebitNote, updateDebitNote, applyDebitNote, voidDebitNote } from "@/lib/api";

export default function DebitNoteDetailPage() {
  const { id } = useParams();
  const t = useTranslations("notes");
  const tc = useTranslations("common");
  const [note, setNote] = useState(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  function load() {
    getDebitNote(id).then(setNote).catch((e) => setError(e.message));
  }

  useEffect(load, [id]);

  async function handleSubmit(data) {
    setError("");
    try {
      const updated = await updateDebitNote(id, data);
      setNote(updated);
      setMessage(t("updated"));
    } catch (e) {
      setError(e.message);
    }
  }

  async function handleApply() {
    if (!confirm(t("confirmApply"))) return;
    setError("");
    try {
      setNote(await applyDebitNote(id));
    } catch (e) {
      setError(e.message);
    }
  }

  async function handleVoid() {
    if (!confirm(t("confirmVoid"))) return;
    const reason = prompt(t("voidReasonPrompt")) || "";
    setError("");
    try {
      setNote(await voidDebitNote(id, reason));
    } catch (e) {
      setError(e.message);
    }
  }

  if (error && !note) return <p className="text-red-600 dark:text-red-400 text-sm">{error}</p>;
  if (!note) return <p className="text-gray-500 text-sm">{tc("loading")}</p>;

  return (
    <div>
      <Link href="/dashboard/payments/debit-notes" className="text-sm text-gray-500">← {t("debitNotesTitle")}</Link>

      <div className="flex items-center justify-between my-4">
        <h1 className="text-2xl font-semibold dark:text-gray-100 tracking-tight">{note.noteNumber}</h1>
        <div className="flex gap-2">
          {note.status === "Active" && note.relatedPaymentId && (
            <button onClick={handleApply} className="bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors px-4 py-2 text-sm">{t("apply")}</button>
          )}
          {note.status === "Active" && !note.relatedPaymentId && (
            <span className="text-xs text-amber-700 dark:text-amber-500 self-center max-w-[260px]">{t("applyNeedsPayment")}</span>
          )}
          {note.status !== "Void" && note.status !== "Cancelled" && (
            <button onClick={handleVoid} className="border border-red-300 text-red-600 rounded px-4 py-2 text-sm">{t("voidNote")}</button>
          )}
        </div>
      </div>

      {message && <p className="text-green-600 dark:text-green-400 text-sm mb-4">{message}</p>}
      {error && <p className="text-red-600 dark:text-red-400 text-sm mb-4">{error}</p>}

      <div className="bg-gray-50 rounded-lg p-4 mb-6 flex flex-wrap gap-6">
        <div>
          <div className="text-xs text-gray-500">{t("status")}</div>
          <div className="font-semibold">{t(`statuses.${note.status}`)}</div>
        </div>
        <div>
          <div className="text-xs text-gray-500">{tc("amount")}</div>
          <div className="font-semibold">${Number(note.amount).toFixed(2)}</div>
        </div>
      </div>

      <NoteForm noteType="DEBIT" initialData={note} onSubmit={handleSubmit} submitLabel={tc("saveChanges")} />

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
              {(note.auditLog || []).slice().reverse().map((entry, i) => (
                <tr key={i} className="border-b last:border-0 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800/60 transition-colors">
                  <td className="p-2">{new Date(entry.timestamp).toLocaleString()}</td>
                  <td className="p-2">{entry.user}</td>
                  <td className="p-2">{entry.action}</td>
                </tr>
              ))}
              {(!note.auditLog || note.auditLog.length === 0) && (
                <tr><td className="p-2 text-gray-500" colSpan={3}>{t("noAuditRecords")}</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
