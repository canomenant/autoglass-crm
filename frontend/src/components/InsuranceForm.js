"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";

const empty = { name: "", phone: "", email: "", address: "", notes: "" };

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

export default function InsuranceForm({ initialData, onSubmit, submitLabel }) {
  const tc = useTranslations("common");
  const [form, setForm] = useState({ ...empty, ...initialData });

  function handleSubmit(e) {
    e.preventDefault();
    onSubmit(form);
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <section className="bg-white dark:bg-gray-900 dark:border dark:border-gray-800 rounded-xl shadow-sm p-4 grid grid-cols-2 md:grid-cols-3 gap-4">
        <Field label={tc("name")} value={form.name} onChange={(v) => setForm({ ...form, name: v })} />
        <Field label={tc("phone")} value={form.phone} onChange={(v) => setForm({ ...form, phone: v })} />
        <Field label={tc("email")} value={form.email} onChange={(v) => setForm({ ...form, email: v })} />
        <Field label={tc("address")} value={form.address} onChange={(v) => setForm({ ...form, address: v })} />
      </section>
      <section className="bg-white dark:bg-gray-900 dark:border dark:border-gray-800 rounded-xl shadow-sm p-4">
        <Field label={tc("notes")} value={form.notes} onChange={(v) => setForm({ ...form, notes: v })} textarea />
      </section>
      <button type="submit" className="bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors px-6 py-2">{submitLabel || tc("save")}</button>
    </form>
  );
}
