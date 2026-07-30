"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { getInsuranceCompanies } from "@/lib/api";

export default function InsuranceListPage() {
  const t = useTranslations("insurance");
  const tc = useTranslations("common");
  const [companies, setCompanies] = useState([]);
  const [error, setError] = useState("");

  useEffect(() => {
    getInsuranceCompanies().then(setCompanies).catch((e) => setError(e.message));
  }, []);

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-semibold dark:text-gray-100 tracking-tight">{t("title")}</h1>
        <Link href="/dashboard/settings/insurance-companies/new" className="bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors px-4 py-2 text-sm">
          {t("newCompany")}
        </Link>
      </div>

      {error && <p className="text-red-600 dark:text-red-400 text-sm mb-4">{error}</p>}

      <div className="bg-white dark:bg-gray-900 dark:border dark:border-gray-800 rounded-xl shadow-sm overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left border-b dark:border-gray-800">
              <th className="p-3">{tc("name")}</th>
              <th className="p-3">{tc("phone")}</th>
              <th className="p-3">{tc("email")}</th>
              <th className="p-3"></th>
            </tr>
          </thead>
          <tbody>
            {companies.map((c) => (
              <tr key={c.id} className="border-b last:border-0 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800/60 transition-colors">
                <td className="p-3">{c.name}</td>
                <td className="p-3">{c.phone}</td>
                <td className="p-3">{c.email}</td>
                <td className="p-3"><Link href={`/dashboard/settings/insurance-companies/${c.id}`} className="text-blue-600 dark:text-blue-400 hover:underline">{tc("viewEdit")}</Link></td>
              </tr>
            ))}
            {companies.length === 0 && !error && (
              <tr><td className="p-3 text-gray-500" colSpan={4}>{t("noRecords")}</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
