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
  const [saving, setSaving] = useState(false);

  function load() {
    getTechnician(id).then(setTechnician).catch((e) => setError(e.message));
  }

  useEffect(load, [id]);

  async function handleSubmit(data) {
    // Se limpian ANTES de guardar. El aviso no se borraba nunca, así que a partir del primer
    // guardado quedaba fijo en pantalla: el segundo y el tercero no cambiaban nada visible y
    // parecía que el botón no hacía nada. Y un error viejo tapaba la página entera con el
    // return de abajo, aunque el guardado siguiente hubiera ido bien.
    setMessage("");
    setError("");
    setSaving(true);
    try {
      const updated = await updateTechnician(id, data);
      setTechnician(updated);
      setMessage(t("updated"));
      // Se retira solo: así el siguiente guardado vuelve a mostrarlo y se ve que ocurrió algo.
      setTimeout(() => setMessage(""), 4000);
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  // Sólo cuando aún no hay ficha que mostrar: un fallo al guardar se enseña junto al formulario
  // (abajo), no sustituyendo la pantalla y perdiendo lo que la persona acababa de escribir.
  if (error && !technician) return <p className="text-red-600 dark:text-red-400 text-sm">{error}</p>;
  if (!technician) return <p className="text-gray-500 text-sm">{tc("loading")}</p>;

  const stats = technician.stats || {};

  return (
    <div>
      <Link href="/dashboard/settings/technicians" className="text-sm text-gray-500">← {t("title")}</Link>
      <h1 className="text-2xl font-semibold dark:text-gray-100 tracking-tight my-4">{technician.name}</h1>

      {message && <p className="text-green-600 dark:text-green-400 text-sm mb-4">{message}</p>}
      {error && technician && <p className="text-red-600 dark:text-red-400 text-sm mb-4">{error}</p>}

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
