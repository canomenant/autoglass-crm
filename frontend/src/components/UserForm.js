"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";

const ROLES = ["Admin", "Tech", "Sales", "Employee"];

const empty = {
  name: "",
  email: "",
  phone: "",
  role: "Employee",
  password: "",
  bank: { bankName: "", accountNumber: "" },
  commission: 0,
  salary: 0,
  notes: "",
};

export default function UserForm({ initialData, onSubmit, submitLabel }) {
  const t = useTranslations("users");
  const tc = useTranslations("common");
  const isEdit = !!initialData;
  const [form, setForm] = useState({ ...empty, ...initialData, password: "" });
  const [error, setError] = useState("");

  function set(path, value) {
    setForm((prev) => {
      if (path[0] === "bank") return { ...prev, bank: { ...prev.bank, [path[1]]: value } };
      return { ...prev, [path[0]]: value };
    });
  }

  function handleSubmit(e) {
    e.preventDefault();
    setError("");
    // On create there's no other way to ever assign this account a password later except this
    // form, so leaving it blank would produce a user nobody can log in as — required here.
    // On edit, blank means "leave the current password alone" (see AgentForm for the same rule).
    if (!isEdit && !form.password) {
      setError(t("passwordRequired"));
      return;
    }
    const { password, ...rest } = form;
    onSubmit(password ? { ...form, mustChangePassword: true } : rest);
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <section className="bg-white dark:bg-gray-900 dark:border dark:border-gray-800 rounded-xl shadow-sm p-4 grid grid-cols-2 md:grid-cols-3 gap-4">
        <div>
          <label className="block text-sm mb-1 text-gray-600 dark:text-gray-300">{tc("name")}</label>
          <input value={form.name} onChange={(e) => set(["name"], e.target.value)} className="w-full border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-shadow" />
        </div>
        <div>
          <label className="block text-sm mb-1 text-gray-600 dark:text-gray-300">{tc("email")}</label>
          <input value={form.email} onChange={(e) => set(["email"], e.target.value)} className="w-full border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-shadow" />
        </div>
        <div>
          <label className="block text-sm mb-1 text-gray-600 dark:text-gray-300">{tc("phone")}</label>
          <input value={form.phone} onChange={(e) => set(["phone"], e.target.value)} className="w-full border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-shadow" />
        </div>
        <div>
          <label className="block text-sm mb-1 text-gray-600 dark:text-gray-300">{t("role")}</label>
          <select value={form.role} onChange={(e) => set(["role"], e.target.value)} className="w-full border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-shadow">
            {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-sm mb-1 text-gray-600 dark:text-gray-300">
            {t("password")}
            {!isEdit && <span className="text-red-500"> *</span>}
          </label>
          <input
            type="password"
            value={form.password}
            onChange={(e) => set(["password"], e.target.value)}
            placeholder={isEdit ? t("passwordPlaceholder") : ""}
            autoComplete="new-password"
            required={!isEdit}
            className="w-full border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-shadow"
          />
        </div>
      </section>

      {error && <p className="text-red-600 dark:text-red-400 text-sm">{error}</p>}

      <section className="bg-white dark:bg-gray-900 dark:border dark:border-gray-800 rounded-xl shadow-sm p-4">
        <h2 className="font-semibold mb-3">{t("bankSection")}</h2>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          <div>
            <label className="block text-sm mb-1 text-gray-600 dark:text-gray-300">{t("bankName")}</label>
            <input value={form.bank.bankName} onChange={(e) => set(["bank", "bankName"], e.target.value)} className="w-full border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-shadow" />
          </div>
          <div>
            <label className="block text-sm mb-1 text-gray-600 dark:text-gray-300">{t("accountNumber")}</label>
            <input value={form.bank.accountNumber} onChange={(e) => set(["bank", "accountNumber"], e.target.value)} className="w-full border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-shadow" />
          </div>
          <div>
            <label className="block text-sm mb-1 text-gray-600 dark:text-gray-300">{t("commission")}</label>
            <input type="number" value={form.commission} onChange={(e) => set(["commission"], Number(e.target.value))} className="w-full border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-shadow" />
          </div>
          <div>
            <label className="block text-sm mb-1 text-gray-600 dark:text-gray-300">{t("salary")}</label>
            <input type="number" value={form.salary} onChange={(e) => set(["salary"], Number(e.target.value))} className="w-full border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-shadow" />
          </div>
        </div>
      </section>

      <section className="bg-white dark:bg-gray-900 dark:border dark:border-gray-800 rounded-xl shadow-sm p-4">
        <label className="block text-sm mb-1 text-gray-600 dark:text-gray-300">{tc("notes")}</label>
        <textarea value={form.notes} onChange={(e) => set(["notes"], e.target.value)} className="w-full border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-shadow" rows={3} />
      </section>

      <button type="submit" className="bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors px-6 py-2">{submitLabel || tc("save")}</button>
    </form>
  );
}
