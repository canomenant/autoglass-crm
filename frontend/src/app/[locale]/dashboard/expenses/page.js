"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { getExpenses, createExpense } from "@/lib/api";
import { DollarIcon, ExpensesIcon, TagIcon, TrendingUpIcon, CloseIcon, PlusIcon, DownloadIcon } from "@/components/Icons";

function money(n) {
  return `$${Number(n || 0).toFixed(2)}`;
}

function toCsv(rows) {
  const header = ["Date", "Category", "Amount", "Notes"];
  const lines = rows.map((e) =>
    [e.date, e.category, Number(e.amount || 0).toFixed(2), e.notes]
      .map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`)
      .join(",")
  );
  return [header.join(","), ...lines].join("\n");
}

function StatCard({ icon: Icon, iconClass, label, value }) {
  return (
    <div className="bg-white dark:bg-gray-900 dark:border dark:border-gray-800 rounded-xl shadow-sm hover:shadow-md transition-shadow p-4 flex items-start gap-3">
      <div className={`w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 ${iconClass}`}>
        <Icon className="w-5 h-5" />
      </div>
      <div className="min-w-0">
        <div className="text-xs text-slate-500 dark:text-gray-400 truncate">{label}</div>
        <div className="text-2xl font-bold text-slate-800 dark:text-gray-100 truncate">{value}</div>
      </div>
    </div>
  );
}

const emptyForm = { category: "", date: "", amount: "", notes: "" };

function AddExpenseModal({ onClose, onCreated }) {
  const t = useTranslations("expenses");
  const tc = useTranslations("common");
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  function set(field, value) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      await createExpense({ ...form, amount: Number(form.amount || 0) });
      onCreated();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white dark:bg-gray-900 rounded-xl shadow-xl w-full max-w-md">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 dark:border-gray-800">
          <h2 className="font-semibold text-slate-800 dark:text-gray-100">{t("newExpense")}</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 dark:hover:text-gray-200 p-1 rounded-lg hover:bg-slate-100 dark:hover:bg-gray-800 transition-colors">
            <CloseIcon className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
          {error && <p className="text-red-600 dark:text-red-400 text-sm">{error}</p>}

          <div>
            <label className="block text-xs mb-1 text-slate-500 dark:text-gray-400">{tc("category")}</label>
            <input required value={form.category} onChange={(e) => set("category", e.target.value)} className="w-full border border-slate-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-shadow" />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs mb-1 text-slate-500 dark:text-gray-400">{tc("date")}</label>
              <input type="date" required value={form.date} onChange={(e) => set("date", e.target.value)} className="w-full border border-slate-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-shadow" />
            </div>
            <div>
              <label className="block text-xs mb-1 text-slate-500 dark:text-gray-400">{tc("amount")}</label>
              <input type="number" step="0.01" required value={form.amount} onChange={(e) => set("amount", e.target.value)} className="w-full border border-slate-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-shadow" />
            </div>
          </div>

          <div>
            <label className="block text-xs mb-1 text-slate-500 dark:text-gray-400">{tc("notes")}</label>
            <textarea value={form.notes} onChange={(e) => set("notes", e.target.value)} rows={3} className="w-full border border-slate-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-shadow" />
          </div>

          <div className="flex items-center justify-end gap-3 pt-2">
            <button type="button" onClick={onClose} className="text-sm font-medium text-slate-500 dark:text-gray-400 hover:text-slate-700 dark:hover:text-gray-200 px-4 py-2 transition-colors">
              {tc("cancel")}
            </button>
            <button type="submit" disabled={saving} className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg px-4 py-2 transition-colors">
              {t("createExpense")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function ExpensesListPage() {
  const t = useTranslations("expenses");
  const tc = useTranslations("common");
  const [expenses, setExpenses] = useState([]);
  const [error, setError] = useState("");
  const [showModal, setShowModal] = useState(false);
  const [filters, setFilters] = useState({ dateFrom: "", dateTo: "", category: "" });

  function load() {
    getExpenses().then(setExpenses).catch((e) => setError(e.message));
  }

  useEffect(load, []);

  function setFilter(field, value) {
    setFilters((prev) => ({ ...prev, [field]: value }));
  }

  const categoryOptions = useMemo(() => {
    return [...new Set(expenses.map((e) => e.category).filter(Boolean))].sort();
  }, [expenses]);

  const filteredExpenses = useMemo(() => {
    return expenses
      .filter((e) => {
        if (filters.dateFrom && e.date < filters.dateFrom) return false;
        if (filters.dateTo && e.date > filters.dateTo) return false;
        if (filters.category && e.category !== filters.category) return false;
        return true;
      })
      .sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  }, [expenses, filters]);

  const stats = useMemo(() => {
    const total = filteredExpenses.reduce((sum, e) => sum + Number(e.amount || 0), 0);
    const count = filteredExpenses.length;
    const categories = new Set(filteredExpenses.map((e) => e.category).filter(Boolean)).size;
    const average = count ? total / count : 0;
    return { total, count, categories, average };
  }, [filteredExpenses]);

  function handleCreated() {
    setShowModal(false);
    load();
  }

  function handleExportCsv() {
    const csv = toCsv(filteredExpenses);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "expenses.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-2xl font-semibold dark:text-gray-100 tracking-tight">{t("title")}</h1>
        <div className="flex items-center gap-3">
          <button onClick={handleExportCsv} className="flex items-center gap-1.5 border border-slate-200 dark:border-gray-700 text-slate-600 dark:text-gray-300 hover:bg-slate-50 dark:hover:bg-gray-800 text-sm font-medium rounded-lg px-4 py-2 transition-colors">
            <DownloadIcon className="w-4 h-4" />
            {t("exportCsv")}
          </button>
          <button onClick={() => setShowModal(true)} className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg px-4 py-2 transition-colors">
            <PlusIcon className="w-4 h-4" />
            {t("newExpense")}
          </button>
        </div>
      </div>

      {error && <p className="text-red-600 dark:text-red-400 text-sm">{error}</p>}

      <div className="bg-white dark:bg-gray-900 dark:border dark:border-gray-800 rounded-xl shadow-sm p-4 flex flex-wrap items-end gap-4">
        <div>
          <label htmlFor="expense-date-from" className="block text-xs mb-1 text-slate-500 dark:text-gray-400">{t("dateFrom")}</label>
          <input id="expense-date-from" type="date" value={filters.dateFrom} onChange={(e) => setFilter("dateFrom", e.target.value)} className="border border-slate-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none" />
        </div>
        <div>
          <label htmlFor="expense-date-to" className="block text-xs mb-1 text-slate-500 dark:text-gray-400">{t("dateTo")}</label>
          <input id="expense-date-to" type="date" value={filters.dateTo} onChange={(e) => setFilter("dateTo", e.target.value)} className="border border-slate-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none" />
        </div>
        <div>
          <label htmlFor="expense-category" className="block text-xs mb-1 text-slate-500 dark:text-gray-400">{tc("category")}</label>
          <select id="expense-category" value={filters.category} onChange={(e) => setFilter("category", e.target.value)} className="border border-slate-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none min-w-[160px]">
            <option value="">{t("allCategories")}</option>
            {categoryOptions.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard icon={DollarIcon} iconClass="bg-blue-50 text-blue-600 dark:bg-blue-500/10 dark:text-blue-400" label={tc("total")} value={money(stats.total)} />
        <StatCard icon={ExpensesIcon} iconClass="bg-slate-100 text-slate-600 dark:bg-gray-800 dark:text-gray-300" label={t("title")} value={stats.count} />
        <StatCard icon={TagIcon} iconClass="bg-blue-50 text-blue-600 dark:bg-blue-500/10 dark:text-blue-400" label={tc("category")} value={stats.categories} />
        <StatCard icon={TrendingUpIcon} iconClass="bg-slate-100 text-slate-600 dark:bg-gray-800 dark:text-gray-300" label={t("average")} value={money(stats.average)} />
      </div>

      <div className="bg-white dark:bg-gray-900 dark:border dark:border-gray-800 rounded-xl shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left border-b border-slate-100 dark:border-gray-800 text-slate-400 dark:text-gray-500">
                <th className="p-4 font-medium">{tc("date")}</th>
                <th className="p-4 font-medium">{tc("category")}</th>
                <th className="p-4 font-medium text-right">{tc("amount")}</th>
                <th className="p-4 font-medium">{tc("notes")}</th>
                <th className="p-4 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {filteredExpenses.map((e, i) => (
                <tr key={e.id} className={`border-b last:border-0 border-slate-50 dark:border-gray-800/60 hover:bg-blue-50/50 dark:hover:bg-gray-800/40 transition-colors ${i % 2 === 1 ? "bg-slate-50/60 dark:bg-gray-800/20" : ""}`}>
                  <td className="p-4 text-slate-500 dark:text-gray-400">{e.date}</td>
                  <td className="p-4">
                    <span className="inline-block px-2 py-0.5 rounded-full text-xs font-medium bg-blue-50 text-blue-700 dark:bg-blue-500/10 dark:text-blue-400">{e.category}</span>
                  </td>
                  <td className="p-4 text-right font-medium text-slate-700 dark:text-gray-200">{money(e.amount)}</td>
                  <td className="p-4 text-slate-500 dark:text-gray-400 max-w-xs truncate">{e.notes}</td>
                  <td className="p-4 text-right">
                    <Link href={`/dashboard/expenses/${e.id}`} className="text-blue-600 dark:text-blue-400 hover:underline font-medium">{tc("viewEdit")}</Link>
                  </td>
                </tr>
              ))}
              {filteredExpenses.length === 0 && !error && (
                <tr><td className="p-4 text-slate-400" colSpan={5}>{t("noRecords")}</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {showModal && <AddExpenseModal onClose={() => setShowModal(false)} onCreated={handleCreated} />}
    </div>
  );
}
