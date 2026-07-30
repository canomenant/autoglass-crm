"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import SettingsIcon from "@/components/SettingsIcon";
import CurrencyInput from "@/components/CurrencyInput";
import { getZipCodes, createZipCode, updateZipCode, deleteZipCode } from "@/lib/api";

function EditIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
      <line x1="4" y1="7" x2="20" y2="7" />
      <path d="M6 7V4.5A1.5 1.5 0 0 1 7.5 3h9A1.5 1.5 0 0 1 18 4.5V7" />
      <path d="M19 7l-.9 12.1a2 2 0 0 1-2 1.9H7.9a2 2 0 0 1-2-1.9L5 7" />
      <line x1="10" y1="11" x2="10" y2="16" />
      <line x1="14" y1="11" x2="14" y2="16" />
    </svg>
  );
}

const emptyForm = {
  zipcode: "",
  city: "",
  county: "",
  state: "CA",
  tax: "",
  serviceArea: true,
  longTripRequired: false,
  longTripFee: 0,
  distanceFromBase: "",
};

export default function ZipCodePage() {
  const t = useTranslations("settingsCatalog.zipCode");
  const tc = useTranslations("common");
  const [items, setItems] = useState([]);
  const [error, setError] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [search, setSearch] = useState("");
  const [form, setForm] = useState(emptyForm);

  function load() {
    getZipCodes().then(setItems).catch((e) => setError(e.message));
  }

  useEffect(load, []);

  const filtered = search
    ? items.filter((i) =>
        `${i.zipcode} ${i.city} ${i.county} ${i.state}`.toLowerCase().includes(search.toLowerCase())
      )
    : items;

  function openNew() {
    setEditing(null);
    setForm(emptyForm);
    setModalOpen(true);
  }

  function openEdit(item) {
    setEditing(item);
    setForm({
      zipcode: item.zipcode,
      city: item.city,
      county: item.county,
      state: item.state,
      tax: item.tax,
      serviceArea: item.serviceArea ?? true,
      longTripRequired: item.longTripRequired ?? false,
      longTripFee: item.longTripFee ?? 0,
      distanceFromBase: item.distanceFromBase ?? "",
    });
    setModalOpen(true);
  }

  async function handleSave(e) {
    e.preventDefault();
    try {
      const payload = { ...form, tax: Number(form.tax), distanceFromBase: Number(form.distanceFromBase) || 0 };
      if (editing) {
        await updateZipCode(editing.id, payload);
      } else {
        await createZipCode(payload);
      }
      setModalOpen(false);
      load();
    } catch (e) {
      setError(e.message);
    }
  }

  async function handleDelete(id) {
    if (!confirm(tc("confirmDelete"))) return;
    try {
      await deleteZipCode(id);
      load();
    } catch (e) {
      setError(e.message);
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Link href="/dashboard/settings" className="w-9 h-9 flex items-center justify-center rounded-lg bg-white shadow text-gray-500">
            ‹
          </Link>
          <SettingsIcon name="map-pin" className="w-6 h-6 text-gray-800" />
          <div>
            <h1 className="text-xl font-bold leading-tight">{t("title")}</h1>
            <p className="text-sm text-gray-500">{t("subtitle")}</p>
          </div>
        </div>
        <button onClick={openNew} className="bg-gray-900 hover:bg-gray-800 dark:bg-blue-600 dark:hover:bg-blue-700 text-white rounded-full transition-colors px-5 py-2.5 text-sm font-medium">
          {tc("newRecordButton")}
        </button>
      </div>

      <div className="mb-4">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={tc("search")}
          className="w-full max-w-sm border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-shadow"
        />
      </div>

      {error && <p className="text-red-600 dark:text-red-400 text-sm mb-4">{error}</p>}

      <div className="bg-white dark:bg-gray-900 dark:border dark:border-gray-800 rounded-xl shadow-sm overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left border-b dark:border-gray-800 text-xs text-gray-400 uppercase tracking-wide">
              <th className="p-4">{t("zipcode")}</th>
              <th className="p-4">{t("city")}</th>
              <th className="p-4">{t("county")}</th>
              <th className="p-4">{t("state")}</th>
              <th className="p-4">{t("tax")}</th>
              <th className="p-4">{t("serviceArea")}</th>
              <th className="p-4">{t("longTripFee")}</th>
              <th className="p-4">{t("distanceFromBase")}</th>
              <th className="p-4 text-right">{tc("behavior")}</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((item) => (
              <tr key={item.id} className="border-b last:border-0 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800/60 transition-colors">
                <td className="p-4 font-medium">{item.zipcode}</td>
                <td className="p-4">{item.city}</td>
                <td className="p-4 text-gray-500">{item.county}</td>
                <td className="p-4 text-gray-500">{item.state}</td>
                <td className="p-4">{(Number(item.tax) * 100).toFixed(2)}%</td>
                <td className="p-4">
                  {item.serviceArea ? (
                    <span className="text-xs font-medium rounded-full px-2 py-1 bg-green-100 text-green-700">{tc("yes")}</span>
                  ) : (
                    <span className="text-xs font-medium rounded-full px-2 py-1 bg-red-100 text-red-700">{tc("no")}</span>
                  )}
                </td>
                <td className="p-4">{item.longTripRequired ? `$${Number(item.longTripFee || 0).toFixed(2)}` : "-"}</td>
                <td className="p-4 text-gray-500">{item.distanceFromBase ? `${item.distanceFromBase} mi` : "-"}</td>
                <td className="p-4">
                  <div className="flex justify-end gap-2">
                    <button onClick={() => openEdit(item)} className="w-8 h-8 flex items-center justify-center rounded-lg bg-gray-100 text-gray-600">
                      <EditIcon />
                    </button>
                    <button onClick={() => handleDelete(item.id)} className="w-8 h-8 flex items-center justify-center rounded-lg bg-red-50 text-red-500">
                      <TrashIcon />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {filtered.length === 0 && !error && (
              <tr><td className="p-4 text-gray-500" colSpan={9}>{tc("noRecords")}</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {modalOpen && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <form onSubmit={handleSave} className="bg-white dark:bg-gray-800 dark:border dark:border-gray-700 rounded-xl shadow-xl p-6 w-full max-w-md space-y-4">
            <h2 className="text-lg font-semibold">{editing ? tc("editRecord") : tc("newRecord")}</h2>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm mb-1 text-gray-600 dark:text-gray-300">{t("zipcode")}</label>
                <input
                  value={form.zipcode}
                  onChange={(e) => setForm({ ...form, zipcode: e.target.value })}
                  className="w-full border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-shadow"
                  required
                />
              </div>
              <div>
                <label className="block text-sm mb-1 text-gray-600 dark:text-gray-300">{t("state")}</label>
                <input
                  value={form.state}
                  onChange={(e) => setForm({ ...form, state: e.target.value })}
                  className="w-full border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-shadow"
                  required
                />
              </div>
            </div>
            <div>
              <label className="block text-sm mb-1 text-gray-600 dark:text-gray-300">{t("city")}</label>
              <input
                value={form.city}
                onChange={(e) => setForm({ ...form, city: e.target.value })}
                className="w-full border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-shadow"
                required
              />
            </div>
            <div>
              <label className="block text-sm mb-1 text-gray-600 dark:text-gray-300">{t("county")}</label>
              <input
                value={form.county}
                onChange={(e) => setForm({ ...form, county: e.target.value })}
                className="w-full border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-shadow"
                required
              />
            </div>
            <div>
              <label className="block text-sm mb-1 text-gray-600 dark:text-gray-300">{t("tax")}</label>
              <input
                type="number"
                step="0.0001"
                value={form.tax}
                onChange={(e) => setForm({ ...form, tax: e.target.value })}
                className="w-full border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-shadow"
                required
              />
            </div>

            <div className="border-t dark:border-gray-700 pt-3 space-y-3">
              <label className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300">
                <input
                  type="checkbox"
                  checked={form.serviceArea}
                  onChange={(e) => setForm({ ...form, serviceArea: e.target.checked })}
                />
                {t("serviceArea")}
              </label>
              <label className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300">
                <input
                  type="checkbox"
                  checked={form.longTripRequired}
                  onChange={(e) => setForm({ ...form, longTripRequired: e.target.checked })}
                />
                {t("longTripRequired")}
              </label>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm mb-1 text-gray-600 dark:text-gray-300">{t("longTripFee")}</label>
                  <CurrencyInput value={form.longTripFee} onChange={(v) => setForm({ ...form, longTripFee: v })} />
                </div>
                <div>
                  <label className="block text-sm mb-1 text-gray-600 dark:text-gray-300">{t("distanceFromBase")}</label>
                  <input
                    type="number"
                    step="0.1"
                    min="0"
                    value={form.distanceFromBase}
                    onChange={(e) => setForm({ ...form, distanceFromBase: e.target.value })}
                    className="w-full border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-shadow"
                  />
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={() => setModalOpen(false)} className="px-4 py-2 rounded text-sm">
                {tc("cancel")}
              </button>
              <button type="submit" className="bg-gray-900 hover:bg-gray-800 dark:bg-blue-600 dark:hover:bg-blue-700 text-white rounded-lg transition-colors px-4 py-2 text-sm">
                {tc("save")}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
