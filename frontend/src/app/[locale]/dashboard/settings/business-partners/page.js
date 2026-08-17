"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import SettingsIcon from "@/components/SettingsIcon";
import CurrencyInput from "@/components/CurrencyInput";
import {
  getBusinessPartners, createBusinessPartner, updateBusinessPartner, deleteBusinessPartner,
  getJobTypes, getPartnerDistributionSettings, updatePartnerDistributionSettings,
} from "@/lib/api";

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

function emptyForm() {
  return { name: "", active: true, rates: [] };
}

export default function BusinessPartnersPage() {
  const t = useTranslations("businessPartners");
  const tc = useTranslations("common");
  const [items, setItems] = useState([]);
  const [jobTypes, setJobTypes] = useState([]);
  const [error, setError] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(emptyForm);

  const [startDate, setStartDate] = useState("");
  const [startDateSaving, setStartDateSaving] = useState(false);
  const [startDateMessage, setStartDateMessage] = useState("");

  function load() {
    getBusinessPartners().then(setItems).catch((e) => setError(e.message));
  }

  useEffect(() => {
    load();
    getJobTypes().then(setJobTypes).catch((e) => setError(e.message));
    getPartnerDistributionSettings().then((s) => setStartDate(s.startDate || "")).catch((e) => setError(e.message));
  }, []);

  function rateFor(rates, jobTypeId) {
    return rates.find((r) => r.jobTypeId === jobTypeId)?.amount ?? 0;
  }

  function setRate(jobTypeId, amount) {
    setForm((prev) => {
      const rates = prev.rates.filter((r) => r.jobTypeId !== jobTypeId);
      if (amount > 0) rates.push({ jobTypeId, amount });
      return { ...prev, rates };
    });
  }

  function openNew() {
    setEditing(null);
    setForm(emptyForm());
    setModalOpen(true);
  }

  function openEdit(item) {
    setEditing(item);
    setForm({ name: item.name, active: item.active !== false, rates: item.rates || [] });
    setModalOpen(true);
  }

  async function handleSave(e) {
    e.preventDefault();
    try {
      if (editing) {
        await updateBusinessPartner(editing.id, form);
      } else {
        await createBusinessPartner(form);
      }
      setModalOpen(false);
      load();
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleDelete(id) {
    if (!confirm(tc("confirmDelete"))) return;
    try {
      await deleteBusinessPartner(id);
      load();
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleSaveStartDate() {
    setStartDateSaving(true);
    setStartDateMessage("");
    try {
      await updatePartnerDistributionSettings({ startDate: startDate || null });
      setStartDateMessage(t("startDateSaved"));
    } catch (err) {
      setError(err.message);
    } finally {
      setStartDateSaving(false);
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Link href="/dashboard/settings" className="w-9 h-9 flex items-center justify-center rounded-lg bg-white shadow text-gray-500">
            ‹
          </Link>
          <SettingsIcon name="handshake" className="w-6 h-6 text-gray-800" />
          <div>
            <h1 className="text-xl font-bold leading-tight">{t("title")}</h1>
            <p className="text-sm text-gray-500">{t("subtitle")}</p>
          </div>
        </div>
        <button onClick={openNew} className="bg-gray-900 hover:bg-gray-800 dark:bg-blue-600 dark:hover:bg-blue-700 text-white rounded-full transition-colors px-5 py-2.5 text-sm font-medium">
          {tc("newRecordButton")}
        </button>
      </div>

      {error && <p className="text-red-600 dark:text-red-400 text-sm mb-4">{error}</p>}

      <div className="bg-white dark:bg-gray-900 dark:border dark:border-gray-800 rounded-xl shadow-sm p-4 mb-4">
        <h2 className="text-sm font-semibold mb-1">{t("startDateTitle")}</h2>
        <p className="text-xs text-gray-500 mb-3">{t("startDateHint")}</p>
        <div className="flex items-end gap-3">
          <div>
            <label className="block text-xs mb-1 text-gray-500">{t("startDate")}</label>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
            />
          </div>
          <button
            type="button"
            onClick={handleSaveStartDate}
            disabled={startDateSaving}
            className="bg-gray-900 hover:bg-gray-800 dark:bg-blue-600 dark:hover:bg-blue-700 text-white rounded-lg transition-colors px-4 py-2 text-sm disabled:opacity-50"
          >
            {tc("save")}
          </button>
          {startDateMessage && <span className="text-xs text-green-600">{startDateMessage}</span>}
        </div>
      </div>

      <div className="bg-white dark:bg-gray-900 dark:border dark:border-gray-800 rounded-xl shadow-sm overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left border-b dark:border-gray-800 text-xs text-gray-400 uppercase tracking-wide">
              <th className="p-4">#</th>
              <th className="p-4">{t("name")}</th>
              <th className="p-4">{t("active")}</th>
              <th className="p-4">{t("ratesConfigured")}</th>
              <th className="p-4 text-right">{tc("behavior")}</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item, i) => (
              <tr key={item.id} className="border-b last:border-0 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800/60 transition-colors">
                <td className="p-4 font-medium text-gray-400">{i + 1}</td>
                <td className="p-4 max-w-xs truncate">{item.name}</td>
                <td className="p-4">
                  <span className={`text-xs font-medium rounded-full px-2 py-1 ${item.active !== false ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-600"}`}>
                    {item.active !== false ? t("active") : t("inactive")}
                  </span>
                </td>
                <td className="p-4 text-gray-600">{(item.rates || []).length}</td>
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
            {items.length === 0 && !error && (
              <tr><td className="p-4 text-gray-500" colSpan={5}>{tc("noRecords")}</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {modalOpen && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <form onSubmit={handleSave} className="bg-white dark:bg-gray-800 dark:border dark:border-gray-700 rounded-xl shadow-xl p-6 w-full max-w-lg space-y-4 max-h-[90vh] overflow-y-auto">
            <h2 className="text-lg font-semibold">{editing ? tc("editRecord") : tc("newRecord")}</h2>
            <div>
              <label className="block text-sm mb-1 text-gray-600 dark:text-gray-300">{t("name")}</label>
              <input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                className="w-full border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-shadow"
                required
              />
            </div>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={form.active}
                onChange={(e) => setForm({ ...form, active: e.target.checked })}
              />
              {t("active")}
            </label>

            <div>
              <label className="block text-sm mb-2 text-gray-600 dark:text-gray-300">{t("ratesByJobType")}</label>
              <p className="text-xs text-gray-500 mb-2">{t("ratesHint")}</p>
              <div className="border border-gray-200 dark:border-gray-700 rounded-lg divide-y divide-gray-100 dark:divide-gray-700 max-h-72 overflow-y-auto">
                {jobTypes.map((jt) => (
                  <div key={jt.id} className="flex items-center justify-between gap-3 px-3 py-2">
                    <span className="text-sm text-gray-700 dark:text-gray-200 truncate">{jt.name}</span>
                    <div className="w-28 flex-shrink-0">
                      <CurrencyInput
                        value={rateFor(form.rates, jt.id)}
                        onChange={(v) => setRate(jt.id, v)}
                        compact
                      />
                    </div>
                  </div>
                ))}
                {jobTypes.length === 0 && <p className="text-xs text-gray-400 p-3">{tc("noRecords")}</p>}
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
