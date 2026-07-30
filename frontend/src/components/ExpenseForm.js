"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";

const empty = { category: "", date: "", amount: 0, notes: "" };

export default function ExpenseForm({ initialData, onSubmit, submitLabel }) {
  const tc = useTranslations("common");
  const [form, setForm] = useState({ ...empty, ...initialData });

  function handleSubmit(e) {
    e.preventDefault();
    onSubmit(form);
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <section className="bg-white dark:bg-gray-900 dark:border dark:border-gray-800 rounded-xl shadow-sm p-4 grid grid-cols-2 md:grid-cols-3 gap-4">
        <div>
          <label className="block text-sm mb-1 text-gray-600 dark:text-gray-300">{tc("category")}</label>
          <input value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} className="w-full border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-shadow" />
        </div>
        <div>
          <label className="block text-sm mb-1 text-gray-600 dark:text-gray-300">{tc("date")}</label>
          <input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} className="w-full border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-shadow" />
        </div>
        <div>
          <label className="block text-sm mb-1 text-gray-600 dark:text-gray-300">{tc("amount")}</label>
          <input type="number" value={form.amount} onChange={(e) => setForm({ ...form, amount: Number(e.target.value) })} className="w-full border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-shadow" />
        </div>
      </section>
      <section className="bg-white dark:bg-gray-900 dark:border dark:border-gray-800 rounded-xl shadow-sm p-4">
        <label className="block text-sm mb-1 text-gray-600 dark:text-gray-300">{tc("notes")}</label>
        <textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} className="w-full border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-shadow" rows={3} />
      </section>
      <button type="submit" className="bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors px-6 py-2">{submitLabel || tc("save")}</button>
    </form>
  );
}
