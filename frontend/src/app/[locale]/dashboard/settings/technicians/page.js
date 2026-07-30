"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { getTechnicians, deleteTechnician, updateTechnician } from "@/lib/api";

export default function TechniciansListPage() {
  const t = useTranslations("technicians");
  const tc = useTranslations("common");
  const [items, setItems] = useState([]);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");

  function load() {
    getTechnicians().then(setItems).catch((e) => setError(e.message));
  }

  useEffect(load, []);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return items.filter((i) => {
      if (statusFilter && i.status !== statusFilter) return false;
      if (q && !`${i.name} ${i.companyName} ${i.email} ${i.phone}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [items, search, statusFilter]);

  async function handleDelete(id) {
    if (!confirm(tc("confirmDelete"))) return;
    try {
      await deleteTechnician(id);
      load();
    } catch (e) {
      setError(e.message);
    }
  }

  async function toggleStatus(item) {
    try {
      await updateTechnician(item.id, { status: item.status === "Active" ? "Inactive" : "Active" });
      load();
    } catch (e) {
      setError(e.message);
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Link href="/dashboard/settings" className="w-9 h-9 flex items-center justify-center rounded-lg bg-white shadow text-gray-500">‹</Link>
          <h1 className="text-2xl font-semibold dark:text-gray-100 tracking-tight">{t("title")}</h1>
        </div>
        <Link href="/dashboard/settings/technicians/new" className="bg-gray-900 hover:bg-gray-800 dark:bg-blue-600 dark:hover:bg-blue-700 text-white rounded-full transition-colors px-5 py-2.5 text-sm font-medium">
          {t("newTechnician")}
        </Link>
      </div>

      <div className="flex flex-col sm:flex-row gap-3 mb-4">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={tc("search")}
          className="flex-1 border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-shadow"
        />
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-3 py-2 text-sm"
        >
          <option value="">{tc("allStatuses")}</option>
          <option value="Active">{t("statuses.Active")}</option>
          <option value="Inactive">{t("statuses.Inactive")}</option>
        </select>
      </div>

      {error && <p className="text-red-600 dark:text-red-400 text-sm mb-4">{error}</p>}

      <div className="bg-white dark:bg-gray-900 dark:border dark:border-gray-800 rounded-xl shadow-sm overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left border-b dark:border-gray-800 text-xs text-gray-400 uppercase tracking-wide">
              <th className="p-4">{t("technicianName")}</th>
              <th className="p-4">{tc("phone")}</th>
              <th className="p-4">{tc("email")}</th>
              <th className="p-4">{t("completedJobs")}</th>
              <th className="p-4">{t("revenueGenerated")}</th>
              <th className="p-4">{t("status")}</th>
              <th className="p-4 text-right">{tc("behavior")}</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((item) => (
              <tr key={item.id} className="border-b last:border-0 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800/60 transition-colors">
                <td className="p-4 font-medium">{item.name}</td>
                <td className="p-4">{item.phone}</td>
                <td className="p-4">{item.email}</td>
                <td className="p-4">{item.stats?.completedJobs ?? 0}</td>
                <td className="p-4">${Number(item.stats?.revenueGenerated ?? 0).toFixed(2)}</td>
                <td className="p-4">
                  <button
                    onClick={() => toggleStatus(item)}
                    className={`text-xs font-medium rounded-full px-2 py-1 ${item.status === "Active" ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"}`}
                  >
                    {t(`statuses.${item.status}`)}
                  </button>
                </td>
                <td className="p-4">
                  <div className="flex justify-end gap-3">
                    <Link href={`/dashboard/settings/technicians/${item.id}`} className="text-blue-600 dark:text-blue-400 hover:underline">{tc("viewEdit")}</Link>
                    <button onClick={() => handleDelete(item.id)} className="text-red-500 hover:underline">{tc("delete")}</button>
                  </div>
                </td>
              </tr>
            ))}
            {filtered.length === 0 && !error && (
              <tr><td className="p-4 text-gray-500" colSpan={7}>{tc("noRecords")}</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
