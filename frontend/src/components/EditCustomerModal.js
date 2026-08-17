"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import PhoneInput from "./PhoneInput";
import AddressAutocomplete from "./AddressAutocomplete";

function Field({ label, value, onChange, type = "text", required }) {
  return (
    <div>
      <label className="block text-sm mb-1 text-gray-600 dark:text-gray-300">
        {label}
        {required && <span className="text-red-500"> *</span>}
      </label>
      <input
        type={type}
        value={value}
        required={required}
        onChange={(e) => onChange(e.target.value)}
        className="w-full border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-shadow"
      />
    </div>
  );
}

export default function EditCustomerModal({ customer, onClose, onSave }) {
  const tc = useTranslations("common");
  const t = useTranslations("quoteForm");
  const [form, setForm] = useState({
    firstName: customer.firstName || "",
    lastName: customer.lastName || "",
    phone: customer.phone || "",
    email: customer.email || "",
    address: customer.address || "",
    city: customer.city || "",
    state: customer.state || "",
    zipCode: customer.zipCode || "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  function set(field, value) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  function handleAddressSelected(data) {
    setForm((prev) => ({
      ...prev,
      city: data.city || prev.city,
      state: data.state || prev.state,
      zipCode: data.postalCode || prev.zipCode,
    }));
  }

  async function handleSave() {
    setSaving(true);
    setError("");
    try {
      await onSave(form);
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-slate-900/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white dark:bg-gray-900 dark:border dark:border-gray-800 rounded-2xl shadow-2xl w-full max-w-lg flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-6 py-5 border-b border-slate-100 dark:border-gray-800">
          <h2 className="font-semibold text-lg">{t("editCustomerTitle")}</h2>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 text-xl leading-none">
            ✕
          </button>
        </div>

        <div className="px-6 py-5 space-y-4">
          <p className="text-xs text-amber-700 bg-amber-50 dark:bg-amber-900/20 dark:text-amber-400 border border-amber-200 dark:border-amber-900 rounded-lg px-3 py-2">
            {t("editCustomerScopeWarning")}
          </p>

          {error && <p className="text-red-600 dark:text-red-400 text-sm">{error}</p>}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Field label={tc("firstName")} value={form.firstName} onChange={(v) => set("firstName", v)} required />
            <Field label={tc("lastName")} value={form.lastName} onChange={(v) => set("lastName", v)} required />
            <div>
              <label className="block text-sm mb-1 text-gray-600 dark:text-gray-300">
                {tc("primaryPhone")}<span className="text-red-500"> *</span>
              </label>
              <PhoneInput value={form.phone} onChange={(v) => set("phone", v)} required />
            </div>
            <Field label={tc("email")} type="email" value={form.email} onChange={(v) => set("email", v)} />
            <div className="md:col-span-2">
              <AddressAutocomplete
                label={tc("address")}
                value={form.address}
                onChange={(v) => set("address", v)}
                onPlaceSelected={handleAddressSelected}
              />
            </div>
          </div>
        </div>

        <div className="px-6 py-4 border-t border-slate-100 dark:border-gray-800 bg-slate-50 dark:bg-gray-900 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 rounded-lg transition-colors px-4 py-2 text-sm">
            {tc("cancel")}
          </button>
          <button type="button" onClick={handleSave} disabled={saving} className="bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors px-6 py-2 text-sm disabled:opacity-40">
            {tc("save")}
          </button>
        </div>
      </div>
    </div>
  );
}
