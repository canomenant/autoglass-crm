"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";

const empty = {
  name: "",
  companyName: "",
  phone: "",
  mobile: "",
  email: "",
  address: "",
  city: "",
  state: "",
  zipCode: "",
  taxId: "",
  driverLicense: "",
  insuranceExpiration: "",
  notes: "",
  photo: null,
  status: "Active",
  defaultLaborRate: 0,
  defaultCommission: 0,
  serviceAreas: [],
  languages: [],
  canReceiveSms: true,
  canReceiveLinks: true,
  calendarColor: "#2563eb",
};

function Field({ label, value, onChange, type = "text", textarea }) {
  return (
    <div>
      <label className="block text-sm mb-1 text-gray-600 dark:text-gray-300">{label}</label>
      {textarea ? (
        <textarea value={value} onChange={(e) => onChange(e.target.value)} className="w-full border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-shadow" rows={3} />
      ) : (
        <input
          type={type}
          value={value}
          onChange={(e) => onChange(type === "number" ? Number(e.target.value) : e.target.value)}
          className="w-full border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-shadow"
        />
      )}
    </div>
  );
}

export default function TechnicianForm({ initialData, onSubmit, submitLabel }) {
  const t = useTranslations("technicians");
  const tc = useTranslations("common");
  const [form, setForm] = useState({
    ...empty,
    ...initialData,
    serviceAreas: initialData?.serviceAreas?.join(", ") ?? "",
    languages: initialData?.languages?.join(", ") ?? "",
  });

  function set(field, value) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  function handlePhoto(file) {
    const reader = new FileReader();
    reader.onload = () => set("photo", { name: file.name, url: reader.result });
    reader.readAsDataURL(file);
  }

  function handleSubmit(e) {
    e.preventDefault();
    onSubmit({
      ...form,
      serviceAreas: form.serviceAreas.split(",").map((s) => s.trim()).filter(Boolean),
      languages: form.languages.split(",").map((s) => s.trim()).filter(Boolean),
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <section className="bg-white dark:bg-gray-900 dark:border dark:border-gray-800 rounded-xl shadow-sm p-4">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-semibold">{t("basicInfo")}</h2>
          <label className="flex items-center gap-2 text-sm">
            {t("status")}
            <select
              value={form.status}
              onChange={(e) => set("status", e.target.value)}
              className="border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-2 py-1 text-sm"
            >
              <option value="Active">{t("statuses.Active")}</option>
              <option value="Inactive">{t("statuses.Inactive")}</option>
            </select>
          </label>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Field label={t("technicianName")} value={form.name} onChange={(v) => set("name", v)} />
          <Field label={t("companyName")} value={form.companyName} onChange={(v) => set("companyName", v)} />
          <Field label={tc("phone")} value={form.phone} onChange={(v) => set("phone", v)} />
          <Field label={t("mobile")} value={form.mobile} onChange={(v) => set("mobile", v)} />
          <Field label={tc("email")} type="email" value={form.email} onChange={(v) => set("email", v)} />
          <Field label={tc("address")} value={form.address} onChange={(v) => set("address", v)} />
          <Field label={tc("city")} value={form.city} onChange={(v) => set("city", v)} />
          <Field label={tc("state")} value={form.state} onChange={(v) => set("state", v)} />
          <Field label={tc("zipCode")} value={form.zipCode} onChange={(v) => set("zipCode", v)} />
          <Field label={t("taxId")} value={form.taxId} onChange={(v) => set("taxId", v)} />
          <Field label={t("driverLicense")} value={form.driverLicense} onChange={(v) => set("driverLicense", v)} />
          <Field label={t("insuranceExpiration")} type="date" value={form.insuranceExpiration} onChange={(v) => set("insuranceExpiration", v)} />
        </div>
        <div className="mt-4">
          <Field label={tc("notes")} value={form.notes} onChange={(v) => set("notes", v)} textarea />
        </div>
        <div className="mt-4">
          <label className="block text-sm mb-1 text-gray-600 dark:text-gray-300">{t("photo")}</label>
          {form.photo ? (
            <div className="flex items-center gap-3">
              <img src={form.photo.url} alt={form.photo.name} className="w-16 h-16 rounded-lg object-cover" />
              <button type="button" onClick={() => set("photo", null)} className="text-red-500 text-xs">✕</button>
            </div>
          ) : (
            <label className="inline-block border-2 border-dashed rounded-lg px-4 py-3 text-sm text-blue-600 cursor-pointer">
              {t("uploadPhoto")}
              <input
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files[0];
                  if (file) handlePhoto(file);
                  e.target.value = "";
                }}
              />
            </label>
          )}
        </div>
      </section>

      <section className="bg-white dark:bg-gray-900 dark:border dark:border-gray-800 rounded-xl shadow-sm p-4">
        <h2 className="font-semibold mb-4">{t("additionalSettings")}</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Field label={t("defaultLaborRate")} type="number" value={form.defaultLaborRate} onChange={(v) => set("defaultLaborRate", v)} />
          <Field label={t("defaultCommission")} type="number" value={form.defaultCommission} onChange={(v) => set("defaultCommission", v)} />
          <div>
            <label className="block text-sm mb-1 text-gray-600 dark:text-gray-300">{t("calendarColor")}</label>
            <input type="color" value={form.calendarColor} onChange={(e) => set("calendarColor", e.target.value)} className="w-full h-10 border border-gray-200 dark:border-gray-700 rounded-lg" />
          </div>
          <Field label={t("serviceAreas")} value={form.serviceAreas} onChange={(v) => set("serviceAreas", v)} />
          <Field label={t("languages")} value={form.languages} onChange={(v) => set("languages", v)} />
        </div>
        <div className="flex gap-6 mt-4">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={form.canReceiveSms} onChange={(e) => set("canReceiveSms", e.target.checked)} />
            {t("canReceiveSms")}
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={form.canReceiveLinks} onChange={(e) => set("canReceiveLinks", e.target.checked)} />
            {t("canReceiveLinks")}
          </label>
        </div>
      </section>

      <button type="submit" className="bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors px-6 py-2">{submitLabel || tc("save")}</button>
    </form>
  );
}
