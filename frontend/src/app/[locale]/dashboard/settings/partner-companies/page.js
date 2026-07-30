"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import SettingsIcon from "@/components/SettingsIcon";
import {
  getPartnerCompanies,
  createPartnerCompany,
  updatePartnerCompany,
  deletePartnerCompany,
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

const empty = { companyName: "", contactName: "", phone: "", email: "", leadPrice: "", notes: "", active: true };

export default function PartnerCompaniesPage() {
  const t = useTranslations("partnerCompanies");
  const tc = useTranslations("common");
  const [items, setItems] = useState([]);
  const [error, setError] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(empty);

  function load() {
    getPartnerCompanies().then(setItems).catch((e) => setError(e.message));
  }

  useEffect(load, []);

  function openNew() {
    setEditing(null);
    setForm(empty);
    setModalOpen(true);
  }

  function openEdit(item) {
    setEditing(item);
    setForm({ ...item });
    setModalOpen(true);
  }

  async function handleSave(e) {
    e.preventDefault();
    try {
      const payload = { ...form, leadPrice: Number(form.leadPrice) };
      if (editing) {
        await updatePartnerCompany(editing.id, payload);
      } else {
        await createPartnerCompany(payload);
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
      await deletePartnerCompany(id);
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
          <SettingsIcon name="briefcase" className="w-6 h-6 text-gray-800" />
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

      <div className="bg-white dark:bg-gray-900 dark:border dark:border-gray-800 rounded-xl shadow-sm overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left border-b dark:border-gray-800 text-xs text-gray-400 uppercase tracking-wide">
              <th className="p-4">{t("companyName")}</th>
              <th className="p-4">{t("contactName")}</th>
              <th className="p-4">{tc("phone")}</th>
              <th className="p-4">{t("leadPrice")}</th>
              <th className="p-4">{t("active")}</th>
              <th className="p-4 text-right">{tc("behavior")}</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id} className="border-b last:border-0 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800/60 transition-colors">
                <td className="p-4 font-medium">{item.companyName}</td>
                <td className="p-4">{item.contactName}</td>
                <td className="p-4">{item.phone}</td>
                <td className="p-4">${Number(item.leadPrice).toFixed(2)}</td>
                <td className="p-4">{item.active ? tc("yes") : tc("no")}</td>
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
              <tr><td className="p-4 text-gray-500" colSpan={6}>{tc("noRecords")}</td></tr>
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
                <label className="block text-sm mb-1 text-gray-600 dark:text-gray-300">{t("companyName")}</label>
                <input value={form.companyName} onChange={(e) => setForm({ ...form, companyName: e.target.value })} className="w-full border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-shadow" required />
              </div>
              <div>
                <label className="block text-sm mb-1 text-gray-600 dark:text-gray-300">{t("contactName")}</label>
                <input value={form.contactName} onChange={(e) => setForm({ ...form, contactName: e.target.value })} className="w-full border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-shadow" />
              </div>
              <div>
                <label className="block text-sm mb-1 text-gray-600 dark:text-gray-300">{tc("phone")}</label>
                <input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} className="w-full border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-shadow" />
              </div>
              <div>
                <label className="block text-sm mb-1 text-gray-600 dark:text-gray-300">{tc("email")}</label>
                <input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className="w-full border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-shadow" />
              </div>
              <div>
                <label className="block text-sm mb-1 text-gray-600 dark:text-gray-300">{t("leadPrice")}</label>
                <input type="number" step="0.01" value={form.leadPrice} onChange={(e) => setForm({ ...form, leadPrice: e.target.value })} className="w-full border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-shadow" />
              </div>
              <label className="flex items-center gap-2 mt-6">
                <input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} />
                {t("active")}
              </label>
            </div>
            <div>
              <label className="block text-sm mb-1 text-gray-600 dark:text-gray-300">{tc("notes")}</label>
              <textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} className="w-full border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-shadow" rows={2} />
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
