"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import PhoneInput from "./PhoneInput";

const empty = {
  firstName: "",
  lastName: "",
  phone: "",
  phoneAlt: "",
  email: "",
  address: "",
  addressType: "",
  unitNumber: "",
  vehicle: { year: "", make: "", model: "", bodyType: "", vin: "", plate: "" },
};

const ADDRESS_TYPES = ["House", "Apartment", "Unit", "Office", "Condo", "Mobile Home", "Business", "Warehouse", "Other"];
const SHOW_UNIT_FOR = ["Apartment", "Unit", "Condo", "Other"];

function Field({ label, value, onChange, required, type = "text" }) {
  return (
    <div>
      <label className="block text-sm mb-1 text-gray-600 dark:text-gray-300">
        {label}
        {required && <span className="text-red-500"> *</span>}
      </label>
      <input
        type={type}
        value={value}
        required={required}
        onChange={(e) => onChange(e.target.value)}
        className="w-full border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-shadow"
      />
    </div>
  );
}

export default function CustomerForm({ initialData, onSubmit, submitLabel }) {
  const tc = useTranslations("common");
  const [form, setForm] = useState({ ...empty, ...initialData });

  function set(path, value) {
    setForm((prev) => {
      if (path[0] === "vehicle") return { ...prev, vehicle: { ...prev.vehicle, [path[1]]: value } };
      return { ...prev, [path[0]]: value };
    });
  }

  function handleSubmit(e) {
    e.preventDefault();
    onSubmit(form);
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <section className="bg-white dark:bg-gray-900 dark:border dark:border-gray-800 rounded-xl shadow-sm p-4 grid grid-cols-2 md:grid-cols-3 gap-4">
        <Field label={tc("firstName")} value={form.firstName} onChange={(v) => set(["firstName"], v)} required />
        <Field label={tc("lastName")} value={form.lastName} onChange={(v) => set(["lastName"], v)} required />
        <div>
          <label className="block text-sm mb-1 text-gray-600 dark:text-gray-300">
            {tc("primaryPhone")}<span className="text-red-500"> *</span>
          </label>
          <PhoneInput value={form.phone} onChange={(v) => set(["phone"], v)} required />
        </div>
        <div>
          <label className="block text-sm mb-1 text-gray-600 dark:text-gray-300">{tc("alternatePhone")}</label>
          <PhoneInput value={form.phoneAlt} onChange={(v) => set(["phoneAlt"], v)} />
        </div>
        <Field label={tc("email")} type="email" value={form.email} onChange={(v) => set(["email"], v)} />
        <Field label={tc("address")} value={form.address} onChange={(v) => set(["address"], v)} />
        <div>
          <label className="block text-sm mb-1 text-gray-600 dark:text-gray-300">{tc("addressType")}</label>
          <select
            value={form.addressType}
            onChange={(e) => set(["addressType"], e.target.value)}
            className="w-full border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-shadow"
          >
            <option value="">{tc("selectAddressType")}</option>
            {ADDRESS_TYPES.map((a) => <option key={a} value={a}>{tc(`addressTypeOptions.${a}`)}</option>)}
          </select>
        </div>
        {SHOW_UNIT_FOR.includes(form.addressType) && (
          <Field label={tc("unitNumber")} value={form.unitNumber} onChange={(v) => set(["unitNumber"], v)} />
        )}
      </section>

      <section className="bg-white dark:bg-gray-900 dark:border dark:border-gray-800 rounded-xl shadow-sm p-4">
        <h2 className="font-semibold mb-3">{tc("vehicleTitle")}</h2>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          <Field label={tc("year")} value={form.vehicle.year} onChange={(v) => set(["vehicle", "year"], v)} />
          <Field label={tc("make")} value={form.vehicle.make} onChange={(v) => set(["vehicle", "make"], v)} />
          <Field label={tc("model")} value={form.vehicle.model} onChange={(v) => set(["vehicle", "model"], v)} />
          <Field label={tc("bodyType")} value={form.vehicle.bodyType} onChange={(v) => set(["vehicle", "bodyType"], v)} />
          <Field label={tc("vin")} value={form.vehicle.vin} onChange={(v) => set(["vehicle", "vin"], v)} />
          <Field label={tc("plate")} value={form.vehicle.plate} onChange={(v) => set(["vehicle", "plate"], v)} />
        </div>
      </section>

      <button type="submit" className="bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors px-6 py-2">
        {submitLabel || tc("save")}
      </button>
    </form>
  );
}
