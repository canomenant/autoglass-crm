"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import TechnicianForm from "@/components/TechnicianForm";
import { getTechnician, updateTechnician } from "@/lib/api";

function money(n) {
  return `$${Number(n || 0).toFixed(2)}`;
}

export default function TechnicianDetailPage() {
  const { id } = useParams();
  const t = useTranslations("technicians");
  const tc = useTranslations("common");
  const [technician, setTechnician] = useState(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  function load() {
    getTechnician(id).then(setTechnician).catch((e) => setError(e.message));
  }

  useEffect(load, [id]);

  async function handleSubmit(data) {
    try {
      const updated = await updateTechnician(id, data);
      setTechnician(updated);
      setMessage(t("updated"));
    } catch (e) {
      setError(e.message);
    }
  }

  if (error) return <p className="text-red-600 dark:text-red-400 text-sm">{error}</p>;
  if (!technician) return <p className="text-gray-500 text-sm">{tc("loading")}</p>;

  const stats = technician.stats || {};

  return (
    <div>
      <Link href="/dashboard/settings/technicians" className="text-sm text-gray-500">← {t("title")}</Link>
      <h1 className="text-2xl font-semibold dark:text-gray-100 tracking-tight my-4">{technician.name}</h1>

      {message && <p className="text-green-600 dark:text-green-400 text-sm mb-4">{message}</p>}

      <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
        <div className="bg-white dark:bg-gray-900 dark:border dark:border-gray-800 rounded-lg shadow p-4">
          <div className="text-xs text-gray-500 dark:text-gray-400">{t("completedJobs")}</div>
          <div className="text-xl font-bold dark:text-gray-100">{stats.completedJobs ?? 0}</div>
        </div>
        <div className="bg-white dark:bg-gray-900 dark:border dark:border-gray-800 rounded-lg shadow p-4">
          <div className="text-xs text-gray-500 dark:text-gray-400">{t("openJobs")}</div>
          <div className="text-xl font-bold dark:text-gray-100">{stats.openJobs ?? 0}</div>
        </div>
        <div className="bg-white dark:bg-gray-900 dark:border dark:border-gray-800 rounded-lg shadow p-4">
          <div className="text-xs text-gray-500 dark:text-gray-400">{t("revenueGenerated")}</div>
          <div className="text-xl font-bold dark:text-gray-100">{money(stats.revenueGenerated)}</div>
        </div>
        <div className="bg-white dark:bg-gray-900 dark:border dark:border-gray-800 rounded-lg shadow p-4">
          <div className="text-xs text-gray-500 dark:text-gray-400">{t("averageTicket")}</div>
          <div className="text-xl font-bold dark:text-gray-100">{money(stats.averageTicket)}</div>
        </div>
        <div className="bg-white dark:bg-gray-900 dark:border dark:border-gray-800 rounded-lg shadow p-4">
          <div className="text-xs text-gray-500 dark:text-gray-400">{t("lastWorkOrder")}</div>
          <div className="text-xl font-bold dark:text-gray-100">{stats.lastWorkOrder || "—"}</div>
        </div>
      </div>

      <TechnicianForm initialData={technician} onSubmit={handleSubmit} submitLabel={tc("saveChanges")} />
    </div>
  );
}
