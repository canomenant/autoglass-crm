"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import DistributorForm from "@/components/DistributorForm";
import { getDistributor, updateDistributor } from "@/lib/api";

export default function EditDistributorPage() {
  const { id } = useParams();
  const t = useTranslations("distributors");
  const tc = useTranslations("common");
  const [distributor, setDistributor] = useState(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    getDistributor(id).then(setDistributor).catch((e) => setError(e.message));
  }, [id]);

  async function handleSubmit(data) {
    try {
      const updated = await updateDistributor(id, data);
      setDistributor(updated);
      setMessage(t("updated"));
    } catch (e) {
      setError(e.message);
    }
  }

  if (error) return <p className="text-red-600 dark:text-red-400 text-sm">{error}</p>;
  if (!distributor) return <p className="text-gray-500 text-sm">{tc("loading")}</p>;

  const stats = distributor.stats || {};

  return (
    <div>
      <h1 className="text-2xl font-semibold dark:text-gray-100 tracking-tight mb-6">{distributor.name}</h1>
      {message && <p className="text-green-600 dark:text-green-400 text-sm mb-4">{message}</p>}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <div className="bg-white dark:bg-gray-900 dark:border dark:border-gray-800 rounded-lg shadow p-4">
          <div className="text-xs text-gray-500 dark:text-gray-400">{t("orders")}</div>
          <div className="text-xl font-bold dark:text-gray-100">{stats.orders ?? 0}</div>
        </div>
        <div className="bg-white dark:bg-gray-900 dark:border dark:border-gray-800 rounded-lg shadow p-4">
          <div className="text-xs text-gray-500 dark:text-gray-400">{t("totalPurchased")}</div>
          <div className="text-xl font-bold dark:text-gray-100">${Number(stats.totalPurchased ?? 0).toFixed(2)}</div>
        </div>
        <div className="bg-white dark:bg-gray-900 dark:border dark:border-gray-800 rounded-lg shadow p-4">
          <div className="text-xs text-gray-500 dark:text-gray-400">{t("averageCost")}</div>
          <div className="text-xl font-bold dark:text-gray-100">${Number(stats.averageCost ?? 0).toFixed(2)}</div>
        </div>
        <div className="bg-white dark:bg-gray-900 dark:border dark:border-gray-800 rounded-lg shadow p-4">
          <div className="text-xs text-gray-500 dark:text-gray-400">{t("openBalances")}</div>
          <div className="text-xl font-bold dark:text-gray-100">${Number(stats.openBalances ?? 0).toFixed(2)}</div>
        </div>
      </div>

      <DistributorForm initialData={distributor} onSubmit={handleSubmit} submitLabel={tc("saveChanges")} />
    </div>
  );
}
