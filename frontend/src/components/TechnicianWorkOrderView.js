"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { updateWorkOrder } from "@/lib/api";
import { WORK_ORDER_STATUSES } from "@/lib/workOrderStatuses";

function Row({ label, value }) {
  if (!value) return null;
  return (
    <div className="py-2 border-b last:border-0 dark:border-gray-800">
      <div className="text-xs text-gray-400 uppercase">{label}</div>
      <div className="text-base font-medium">{value}</div>
    </div>
  );
}

export default function TechnicianWorkOrderView({ workOrder, onChange }) {
  const t = useTranslations("workOrders");
  const tc = useTranslations("common");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const vehicle = [workOrder.vehicle?.year, workOrder.vehicle?.make, workOrder.vehicle?.model].filter(Boolean).join(" ");

  async function handleStatusChange(status) {
    try {
      const updated = await updateWorkOrder(workOrder.id, { status });
      onChange(updated);
      setMessage(t("updated"));
    } catch (e) {
      setError(e.message);
    }
  }

  async function handleNotesBlur(e) {
    try {
      const updated = await updateWorkOrder(workOrder.id, { specialInstructions: e.target.value });
      onChange(updated);
    } catch (e) {
      setError(e.message);
    }
  }

  function handleUploadPhotos(e) {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;
    Promise.all(
      files.map(
        (file) =>
          new Promise((resolve) => {
            const reader = new FileReader();
            reader.onload = () => resolve({ name: file.name, url: reader.result });
            reader.readAsDataURL(file);
          })
      )
    ).then(async (newPhotos) => {
      const techPhotos = [...(workOrder.techPhotos || []), ...newPhotos];
      try {
        const updated = await updateWorkOrder(workOrder.id, { techPhotos });
        onChange(updated);
      } catch (err) {
        setError(err.message);
      }
    });
    e.target.value = "";
  }

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold dark:text-gray-100 tracking-tight">
        {workOrder.workOrderNo} <span className="text-sm text-gray-500">({workOrder.quoteNo})</span>
      </h1>

      {message && <p className="text-green-600 dark:text-green-400 text-sm">{message}</p>}
      {error && <p className="text-red-600 dark:text-red-400 text-sm">{error}</p>}

      <section className="bg-white dark:bg-gray-900 dark:border dark:border-gray-800 rounded-xl shadow-sm p-4">
        <Row label={t("customerLabel")} value={workOrder.customerName} />
        <Row label={tc("phone")} value={workOrder.phone} />
        <Row label={tc("address")} value={workOrder.address} />
        <Row label={t("appointmentDay")} value={[workOrder.appointmentDate, workOrder.appointmentTime].filter(Boolean).join(" ")} />
        <Row label={t("vehicleLabel")} value={vehicle} />
        <Row label={t("partNumberLabel")} value={workOrder.partNumber} />
        <Row label={t("distributor")} value={workOrder.distributor} />
        <Row label={t("insuranceCompany")} value={workOrder.insuranceCompanyName} />
        <Row label={t("claimNumber")} value={workOrder.claimNumber} />
      </section>

      <section className="bg-white dark:bg-gray-900 dark:border dark:border-gray-800 rounded-xl shadow-sm p-4">
        <label className="block text-sm mb-1 text-gray-600 dark:text-gray-300">{t("status")}</label>
        <select
          value={workOrder.status}
          onChange={(e) => handleStatusChange(e.target.value)}
          className="w-full border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-shadow"
        >
          {WORK_ORDER_STATUSES.map((s) => <option key={s} value={s}>{t(`statuses.${s}`)}</option>)}
        </select>
      </section>

      <section className="bg-white dark:bg-gray-900 dark:border dark:border-gray-800 rounded-xl shadow-sm p-4">
        <label className="block text-sm mb-1 text-gray-600 dark:text-gray-300">{t("specialInstructions")}</label>
        <textarea
          defaultValue={workOrder.specialInstructions}
          onBlur={handleNotesBlur}
          className="w-full border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-shadow"
          rows={3}
        />
      </section>

      <section className="bg-white dark:bg-gray-900 dark:border dark:border-gray-800 rounded-xl shadow-sm p-4">
        <label className="block text-center border-2 border-dashed rounded-lg py-4 text-blue-600 font-semibold text-sm cursor-pointer">
          {t("uploadPhotos")}
          <input type="file" accept="image/*" multiple capture="environment" className="hidden" onChange={handleUploadPhotos} />
        </label>
        {workOrder.techPhotos?.length > 0 && (
          <div className="grid grid-cols-3 gap-2 mt-3">
            {workOrder.techPhotos.map((p, i) => (
              <img key={i} src={p.url} alt={p.name} className="w-full aspect-square object-cover rounded" />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
