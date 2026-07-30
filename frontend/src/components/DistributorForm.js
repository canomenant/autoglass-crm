"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";

const empty = {
  name: "",
  contactName: "",
  phone: "",
  mobile: "",
  email: "",
  address: "",
  city: "",
  state: "",
  zipCode: "",
  website: "",
  accountNumber: "",
  paymentTerms: "",
  taxId: "",
  notes: "",
  logo: null,
  status: "Active",
};

function Field({ label, value, onChange, textarea }) {
  return (
    <div>
      <label className="block text-sm mb-1 text-gray-600 dark:text-gray-300">{label}</label>
      {textarea ? (
        <textarea value={value} onChange={(e) => onChange(e.target.value)} className="w-full border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-shadow" rows={3} />
      ) : (
        <input value={value} onChange={(e) => onChange(e.target.value)} className="w-full border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-shadow" />
      )}
    </div>
  );
}

export default function DistributorForm({ initialData, onSubmit, submitLabel }) {
  const t = useTranslations("distributors");
  const tc = useTranslations("common");
  const [form, setForm] = useState({ ...empty, ...initialData });

  function set(field, value) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  function handleLogo(file) {
    const reader = new FileReader();
    reader.onload = () => set("logo", { name: file.name, url: reader.result });
    reader.readAsDataURL(file);
  }

  function handleSubmit(e) {
    e.preventDefault();
    onSubmit(form);
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <section className="bg-white dark:bg-gray-900 dark:border dark:border-gray-800 rounded-xl shadow-sm p-4">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-semibold">{t("basicInfo")}</h2>
          <label className="flex items-center gap-2 text-sm">
            {t("status")}
            <select
              value={form.status}
              onChange={(e) => set("status", e.target.value)}
              className="border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-2 py-1 text-sm"
            >
              <option value="Active">{t("statuses.Active")}</option>
              <option value="Inactive">{t("statuses.Inactive")}</option>
            </select>
          </label>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          <Field label={tc("name")} value={form.name} onChange={(v) => set("name", v)} />
          <Field label={t("contactName")} value={form.contactName} onChange={(v) => set("contactName", v)} />
          <Field label={tc("phone")} value={form.phone} onChange={(v) => set("phone", v)} />
          <Field label={t("mobile")} value={form.mobile} onChange={(v) => set("mobile", v)} />
          <Field label={tc("email")} value={form.email} onChange={(v) => set("email", v)} />
          <Field label={tc("address")} value={form.address} onChange={(v) => set("address", v)} />
          <Field label={tc("city")} value={form.city} onChange={(v) => set("city", v)} />
          <Field label={tc("state")} value={form.state} onChange={(v) => set("state", v)} />
          <Field label={tc("zipCode")} value={form.zipCode} onChange={(v) => set("zipCode", v)} />
          <Field label={t("website")} value={form.website} onChange={(v) => set("website", v)} />
          <Field label={t("accountNumber")} value={form.accountNumber} onChange={(v) => set("accountNumber", v)} />
          <Field label={t("paymentTerms")} value={form.paymentTerms} onChange={(v) => set("paymentTerms", v)} />
          <Field label={t("taxId")} value={form.taxId} onChange={(v) => set("taxId", v)} />
        </div>
      </section>
      <section className="bg-white dark:bg-gray-900 dark:border dark:border-gray-800 rounded-xl shadow-sm p-4">
        <Field label={tc("notes")} value={form.notes} onChange={(v) => set("notes", v)} textarea />
        <div className="mt-4">
          <label className="block text-sm mb-1 text-gray-600 dark:text-gray-300">{t("logo")}</label>
          {form.logo ? (
            <div className="flex items-center gap-3">
              <img src={form.logo.url} alt={form.logo.name} className="w-16 h-16 rounded-lg object-cover" />
              <button type="button" onClick={() => set("logo", null)} className="text-red-500 text-xs">✕</button>
            </div>
          ) : (
            <label className="inline-block border-2 border-dashed rounded-lg px-4 py-3 text-sm text-blue-600 cursor-pointer">
              {t("uploadLogo")}
              <input
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files[0];
                  if (file) handleLogo(file);
                  e.target.value = "";
                }}
              />
            </label>
          )}
        </div>
      </section>
      <button type="submit" className="bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors px-6 py-2">{submitLabel || tc("save")}</button>
    </form>
  );
}
