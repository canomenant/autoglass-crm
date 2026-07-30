"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { getPaymentMethods } from "@/lib/api";

function Field({ label, value, onChange, type = "text", placeholder }) {
  return (
    <div>
      <label className="block text-sm mb-1 text-gray-600 dark:text-gray-300">{label}</label>
      <input
        type={type}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(type === "number" ? Number(e.target.value) : e.target.value)}
        className="w-full border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-shadow text-sm"
      />
    </div>
  );
}

// Edit-only form for an EXISTING payment batch: payment method/date/notes and the type-specific
// adjustment fields (bonus/deductions for Technician, invoice/PO/tax for Distributor). The Work
// Order composition and entity (Technician/Agent/Distributor) are fixed at creation time via
// PaymentBatchWizard and cannot be changed here — cancel and re-create if the selection was wrong.
export default function PaymentForm({ type, initialData, onSubmit, submitLabel }) {
  const t = useTranslations("payments");
  const tc = useTranslations("common");
  const [form, setForm] = useState({
    paymentMethod: "", paymentDate: "", notes: "",
    bonus: 0, deductions: 0,
    invoiceNumber: "", poNumber: "", taxAmount: 0,
    attachment: null,
    ...initialData,
  });
  const [paymentMethods, setPaymentMethods] = useState([]);

  useEffect(() => {
    getPaymentMethods().then(setPaymentMethods).catch(() => {});
  }, []);

  function set(field, value) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  function handleAttachment(file) {
    const reader = new FileReader();
    reader.onload = () => set("attachment", { name: file.name, url: reader.result });
    reader.readAsDataURL(file);
  }

  function handleSubmit(e) {
    e.preventDefault();
    onSubmit(form);
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {type === "TECHNICIAN" && (
        <section className="bg-white dark:bg-gray-900 dark:border dark:border-gray-800 rounded-xl shadow-sm p-4">
          <h2 className="font-semibold mb-4">{t("adjustmentsAndDetails")}</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Field label={t("bonus")} type="number" value={form.bonus} onChange={(v) => set("bonus", v)} />
            <Field label={t("deductions")} type="number" value={form.deductions} onChange={(v) => set("deductions", v)} />
          </div>
        </section>
      )}

      {type === "DISTRIBUTOR" && (
        <section className="bg-white dark:bg-gray-900 dark:border dark:border-gray-800 rounded-xl shadow-sm p-4">
          <h2 className="font-semibold mb-4">{t("adjustmentsAndDetails")}</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Field label={t("invoiceNumber")} value={form.invoiceNumber} onChange={(v) => set("invoiceNumber", v)} />
            <Field label={t("poNumber")} value={form.poNumber} onChange={(v) => set("poNumber", v)} />
            <Field label={t("taxAmount")} type="number" value={form.taxAmount} onChange={(v) => set("taxAmount", v)} />
          </div>
          <div className="mt-4">
            <label className="block text-sm mb-1 text-gray-600 dark:text-gray-300">{t("attachment")}</label>
            {form.attachment ? (
              <div className="flex items-center gap-3 text-sm">
                <a href={form.attachment.url} target="_blank" rel="noreferrer" className="text-blue-600 dark:text-blue-400 hover:underline">{form.attachment.name}</a>
                <button type="button" onClick={() => set("attachment", null)} className="text-red-500 text-xs">✕</button>
              </div>
            ) : (
              <label className="inline-block border-2 border-dashed rounded-lg px-4 py-3 text-sm text-blue-600 cursor-pointer">
                {t("uploadInvoice")}
                <input
                  type="file"
                  accept="application/pdf,image/*"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files[0];
                    if (file) handleAttachment(file);
                    e.target.value = "";
                  }}
                />
              </label>
            )}
          </div>
        </section>
      )}

      <section className="bg-white dark:bg-gray-900 dark:border dark:border-gray-800 rounded-xl shadow-sm p-4 grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="block text-sm mb-1 text-gray-600 dark:text-gray-300">{t("paymentMethod")}</label>
          <select
            value={form.paymentMethod}
            onChange={(e) => set("paymentMethod", e.target.value)}
            className="w-full border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-shadow text-sm"
          >
            <option value="">{t("selectPaymentMethod")}</option>
            {paymentMethods.map((m) => (
              <option key={m.id} value={m.name}>{m.name}</option>
            ))}
          </select>
        </div>
        <Field label={t("paymentDate")} type="date" value={form.paymentDate} onChange={(v) => set("paymentDate", v)} />
      </section>

      <section className="bg-white dark:bg-gray-900 dark:border dark:border-gray-800 rounded-xl shadow-sm p-4">
        <label className="block text-sm mb-1 text-gray-600 dark:text-gray-300">{tc("notes")}</label>
        <textarea
          value={form.notes}
          onChange={(e) => set("notes", e.target.value)}
          className="w-full border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-shadow text-sm"
          rows={3}
        />
      </section>

      <button type="submit" className="bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors px-6 py-2">
        {submitLabel || tc("save")}
      </button>
    </form>
  );
}
