"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { getDistributors, updateDistributor } from "@/lib/api";

export default function DistributorsListPage() {
  const t = useTranslations("distributors");
  const tc = useTranslations("common");
  const [distributors, setDistributors] = useState([]);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");

  function load() {
    getDistributors().then(setDistributors).catch((e) => setError(e.message));
  }

  useEffect(load, []);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return distributors.filter((d) => {
      if (statusFilter && d.status !== statusFilter) return false;
      if (q && !`${d.name} ${d.email} ${d.phone}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [distributors, search, statusFilter]);

  async function toggleStatus(item) {
    try {
      await updateDistributor(item.id, { status: item.status === "Active" ? "Inactive" : "Active" });
      load();
    } catch (e) {
      setError(e.message);
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-semibold dark:text-gray-100 tracking-tight">{t("title")}</h1>
        <Link href="/dashboard/distributors/new" className="bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors px-4 py-2 text-sm">
          {t("newDistributor")}
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
            <tr className="text-left border-b dark:border-gray-800">
              <th className="p-3">{tc("name")}</th>
              <th className="p-3">{tc("phone")}</th>
              <th className="p-3">{tc("email")}</th>
              <th className="p-3">{t("orders")}</th>
              <th className="p-3">{t("status")}</th>
              <th className="p-3"></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((d) => (
              <tr key={d.id} className="border-b last:border-0 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800/60 transition-colors">
                <td className="p-3">{d.name}</td>
                <td className="p-3">{d.phone}</td>
                <td className="p-3">{d.email}</td>
                <td className="p-3">{d.stats?.orders ?? 0}</td>
                <td className="p-3">
                  <button
                    onClick={() => toggleStatus(d)}
                    className={`text-xs font-medium rounded-full px-2 py-1 ${d.status === "Active" ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"}`}
                  >
                    {t(`statuses.${d.status || "Active"}`)}
                  </button>
                </td>
                <td className="p-3"><Link href={`/dashboard/distributors/${d.id}`} className="text-blue-600 dark:text-blue-400 hover:underline">{tc("viewEdit")}</Link></td>
              </tr>
            ))}
            {filtered.length === 0 && !error && (
              <tr><td className="p-3 text-gray-500" colSpan={6}>{t("noRecords")}</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
