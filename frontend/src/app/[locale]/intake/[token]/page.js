"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import Image from "next/image";
import { getIntake, submitIntake, decodeIntakeVin } from "@/lib/api";
import PhoneInput from "@/components/PhoneInput";

const ADDRESS_TYPES = ["House", "Apartment", "Unit", "Office", "Condo", "Mobile Home", "Business", "Warehouse", "Other"];
const SHOW_UNIT_FOR = ["Apartment", "Unit", "Condo", "Other"];
const PHOTO_CATEGORIES = ["driverSide", "passengerSide", "front", "rear", "damageArea", "insuranceCard"];

const empty = {
  newCustomer: { firstName: "", lastName: "", phone: "", phoneAlt: "", email: "", address: "", addressType: "", unitNumber: "", city: "", state: "" },
  zipCode: "",
  vehicle: { year: "", make: "", model: "", bodyType: "", vin: "", plate: "" },
  insuranceCompanyId: "",
  policyNumber: "",
  claimNumber: "",
  glassType: "",
  damageNotes: "",
  intakePhotos: { driverSide: [], passengerSide: [], front: [], rear: [], damageArea: [], insuranceCard: [] },
};

function Field({ label, value, onChange, type = "text", placeholder, required }) {
  return (
    <div>
      <label className="block text-sm mb-1 text-gray-600 dark:text-gray-300">
        {label}
        {required && <span className="text-red-500"> *</span>}
      </label>
      <input
        type={type}
        value={value}
        placeholder={placeholder}
        required={required}
        onChange={(e) => onChange(e.target.value)}
        className="w-full border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-shadow"
      />
    </div>
  );
}

function PhotoCategory({ label, photos, onAdd, onRemove, max = 3 }) {
  return (
    <div>
      <h4 className="text-xs font-medium text-gray-500 mb-2">{label}</h4>
      <div className="grid grid-cols-3 gap-2">
        {Array.from({ length: max }).map((_, i) => {
          const photo = photos[i];
          return (
            <div key={i} className="relative aspect-square border-2 border-dashed rounded-lg overflow-hidden bg-white dark:bg-gray-800">
              {photo ? (
                <>
                  <img src={photo.url} alt={photo.name} className="w-full h-full object-cover" />
                  <button
                    type="button"
                    onClick={() => onRemove(i)}
                    className="absolute top-1 right-1 w-5 h-5 rounded-full bg-black/60 text-white text-xs flex items-center justify-center"
                  >
                    ✕
                  </button>
                </>
              ) : (
                <label className="w-full h-full flex items-center justify-center text-blue-600 text-2xl cursor-pointer">
                  +
                  <input
                    type="file"
                    accept="image/*"
                    capture="environment"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files[0];
                      if (file) onAdd(file);
                      e.target.value = "";
                    }}
                  />
                </label>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function CustomerIntakePage() {
  const { token } = useParams();
  const t = useTranslations("intake");
  const [form, setForm] = useState(empty);
  const [insuranceCompanies, setInsuranceCompanies] = useState([]);
  const [status, setStatus] = useState("");
  const [loadError, setLoadError] = useState("");
  const [loadErrorCode, setLoadErrorCode] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [saved, setSaved] = useState(false);
  const [vinDecoding, setVinDecoding] = useState(false);

  useEffect(() => {
    getIntake(token)
      .then((res) => {
        setForm({
          newCustomer: { ...empty.newCustomer, ...res.quote.newCustomer },
          zipCode: res.quote.zipCode || "",
          vehicle: { ...empty.vehicle, ...res.quote.vehicle },
          insuranceCompanyId: res.quote.insuranceCompanyId || "",
          policyNumber: res.quote.policyNumber || "",
          claimNumber: res.quote.claimNumber || "",
          glassType: res.quote.glassType || "",
          damageNotes: res.quote.damageNotes || "",
          intakePhotos: { ...empty.intakePhotos, ...res.quote.intakePhotos },
        });
        setInsuranceCompanies(res.insuranceCompanies || []);
        setStatus(res.quote.status);
      })
      .catch((e) => {
        setLoadError(e.message);
        setLoadErrorCode(e.message.includes("expired") ? 410 : 404);
      });
  }, [token]);

  function set(path, value) {
    setForm((prev) => {
      const next = { ...prev };
      if (path[0] === "newCustomer" || path[0] === "vehicle") {
        next[path[0]] = { ...prev[path[0]], [path[1]]: value };
      } else {
        next[path[0]] = value;
      }
      return next;
    });
  }

  function handleAddressTypeChange(value) {
    setForm((prev) => ({
      ...prev,
      newCustomer: { ...prev.newCustomer, addressType: value, unitNumber: SHOW_UNIT_FOR.includes(value) ? prev.newCustomer.unitNumber : "" },
    }));
  }

  async function handleVinChange(vin) {
    set(["vehicle", "vin"], vin);
    if (vin.length !== 17) return;
    setVinDecoding(true);
    try {
      const result = await decodeIntakeVin(token, vin);
      if (result.year || result.make || result.model || result.bodyType) {
        setForm((prev) => ({
          ...prev,
          vehicle: {
            ...prev.vehicle,
            vin,
            year: result.year || prev.vehicle.year,
            make: result.make || prev.vehicle.make,
            model: result.model || prev.vehicle.model,
            bodyType: result.bodyType || prev.vehicle.bodyType,
          },
        }));
      }
    } catch {
      // Best-effort auto-fill; customer can still enter these fields manually.
    } finally {
      setVinDecoding(false);
    }
  }

  function addPhoto(category, file) {
    const reader = new FileReader();
    reader.onload = () => {
      setForm((prev) => {
        if ((prev.intakePhotos[category] || []).length >= 3) return prev;
        return { ...prev, intakePhotos: { ...prev.intakePhotos, [category]: [...prev.intakePhotos[category], { name: file.name, url: reader.result }] } };
      });
    };
    reader.readAsDataURL(file);
  }

  function removePhoto(category, index) {
    setForm((prev) => ({
      ...prev,
      intakePhotos: { ...prev.intakePhotos, [category]: prev.intakePhotos[category].filter((_, i) => i !== index) },
    }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setSaving(true);
    setSaveError("");
    try {
      const res = await submitIntake(token, form);
      setStatus(res.quote.status);
      setSaved(true);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (e) {
      setSaveError(e.message);
    } finally {
      setSaving(false);
    }
  }

  if (loadError) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-100 dark:bg-gray-950 p-4">
        <div className="bg-white dark:bg-gray-900 rounded-xl shadow-sm p-6 max-w-sm text-center">
          <p className="text-red-600 dark:text-red-400 font-medium mb-1">
            {loadErrorCode === 410 ? t("linkExpired") : t("linkInvalid")}
          </p>
          <p className="text-sm text-gray-500">{t("contactUs")}</p>
        </div>
      </div>
    );
  }

  if (!form.newCustomer.firstName && !status) {
    return <div className="min-h-screen flex items-center justify-center text-gray-500 text-sm">{"..."}</div>;
  }

  const locked = status === "Ready For Review" || status === "Converted";

  return (
    <div className="min-h-screen bg-gray-100 dark:bg-gray-950">
      <div className="bg-gray-900 text-white p-4 flex items-center gap-3">
        <div className="w-10 h-10 rounded overflow-hidden bg-white flex-shrink-0">
          <Image src="/logo.png" alt="" width={80} height={80} className="w-full h-auto" />
        </div>
        <div>
          <div className="font-bold text-lg">{t("title")}</div>
          <div className="text-xs text-gray-300">{t("subtitle")}</div>
        </div>
      </div>

      <div className="max-w-2xl mx-auto p-4 space-y-4">
        {locked ? (
          <div className="bg-white dark:bg-gray-900 rounded-xl shadow-sm p-6 text-center">
            <p className="font-medium text-green-600 dark:text-green-400 mb-1">{t("alreadyProcessed")}</p>
            <p className="text-sm text-gray-500">{t("contactUs")}</p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            {saved && <p className="bg-green-50 text-green-700 rounded-lg px-4 py-3 text-sm">{t("saveSuccess")}</p>}
            {saveError && <p className="bg-red-50 text-red-600 rounded-lg px-4 py-3 text-sm">{saveError}</p>}

            <section className="bg-white dark:bg-gray-900 dark:border dark:border-gray-800 rounded-xl shadow-sm p-4">
              <h2 className="font-semibold mb-3">{t("customerInfoSection")}</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Field label={t("firstName")} value={form.newCustomer.firstName} onChange={(v) => set(["newCustomer", "firstName"], v)} required />
                <Field label={t("lastName")} value={form.newCustomer.lastName} onChange={(v) => set(["newCustomer", "lastName"], v)} required />
                <div>
                  <label className="block text-sm mb-1 text-gray-600 dark:text-gray-300">{t("primaryPhone")}<span className="text-red-500"> *</span></label>
                  <PhoneInput value={form.newCustomer.phone} onChange={(v) => set(["newCustomer", "phone"], v)} required />
                </div>
                <div>
                  <label className="block text-sm mb-1 text-gray-600 dark:text-gray-300">{t("secondaryPhone")}</label>
                  <PhoneInput value={form.newCustomer.phoneAlt} onChange={(v) => set(["newCustomer", "phoneAlt"], v)} />
                </div>
                <Field label={t("email")} type="email" value={form.newCustomer.email} onChange={(v) => set(["newCustomer", "email"], v)} />
              </div>
            </section>

            <section className="bg-white dark:bg-gray-900 dark:border dark:border-gray-800 rounded-xl shadow-sm p-4">
              <h2 className="font-semibold mb-3">{t("addressInfoSection")}</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Field label={t("address")} value={form.newCustomer.address} onChange={(v) => set(["newCustomer", "address"], v)} required />
                <div>
                  <label className="block text-sm mb-1 text-gray-600 dark:text-gray-300">{t("addressType")}</label>
                  <select
                    value={form.newCustomer.addressType}
                    onChange={(e) => handleAddressTypeChange(e.target.value)}
                    className="w-full border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-shadow"
                  >
                    <option value="">{t("selectAddressType")}</option>
                    {ADDRESS_TYPES.map((a) => <option key={a} value={a}>{t(`addressTypeOptions.${a}`)}</option>)}
                  </select>
                </div>
                {SHOW_UNIT_FOR.includes(form.newCustomer.addressType) && (
                  <Field label={t("unitNumber")} value={form.newCustomer.unitNumber} onChange={(v) => set(["newCustomer", "unitNumber"], v)} />
                )}
                <Field label={t("city")} value={form.newCustomer.city} onChange={(v) => set(["newCustomer", "city"], v)} />
                <Field label={t("state")} value={form.newCustomer.state} onChange={(v) => set(["newCustomer", "state"], v)} />
                <Field label={t("zipCode")} value={form.zipCode} onChange={(v) => set(["zipCode"], v)} />
              </div>
            </section>

            <section className="bg-white dark:bg-gray-900 dark:border dark:border-gray-800 rounded-xl shadow-sm p-4">
              <h2 className="font-semibold mb-1">{t("vehicleInfoSection")}</h2>
              <p className="text-xs text-gray-500 mb-3">{t("vinHint")}</p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="md:col-span-2">
                  <label className="block text-sm mb-1 text-gray-600 dark:text-gray-300">{t("vin")}</label>
                  <input
                    value={form.vehicle.vin}
                    maxLength={17}
                    onChange={(e) => handleVinChange(e.target.value.toUpperCase())}
                    placeholder={t("vinPlaceholder")}
                    className="w-full border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-shadow uppercase"
                  />
                  {vinDecoding && <p className="text-xs text-blue-600 mt-1">{t("vinDecoding")}</p>}
                </div>
                <Field label={t("year")} value={form.vehicle.year} onChange={(v) => set(["vehicle", "year"], v)} />
                <Field label={t("make")} value={form.vehicle.make} onChange={(v) => set(["vehicle", "make"], v)} />
                <Field label={t("model")} value={form.vehicle.model} onChange={(v) => set(["vehicle", "model"], v)} />
                <Field label={t("bodyType")} value={form.vehicle.bodyType} onChange={(v) => set(["vehicle", "bodyType"], v)} />
                <Field label={t("plate")} value={form.vehicle.plate} onChange={(v) => set(["vehicle", "plate"], v)} />
              </div>
            </section>

            <section className="bg-white dark:bg-gray-900 dark:border dark:border-gray-800 rounded-xl shadow-sm p-4">
              <h2 className="font-semibold mb-3">{t("insuranceInfoSection")}</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm mb-1 text-gray-600 dark:text-gray-300">{t("insuranceCompany")}</label>
                  <select
                    value={form.insuranceCompanyId || ""}
                    onChange={(e) => set(["insuranceCompanyId"], e.target.value ? Number(e.target.value) : "")}
                    className="w-full border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-shadow"
                  >
                    <option value="">{t("selectInsuranceCompany")}</option>
                    {insuranceCompanies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
                <Field label={t("policyNumber")} value={form.policyNumber} onChange={(v) => set(["policyNumber"], v)} />
                <Field label={t("claimNumber")} value={form.claimNumber} onChange={(v) => set(["claimNumber"], v)} />
              </div>
            </section>

            <section className="bg-white dark:bg-gray-900 dark:border dark:border-gray-800 rounded-xl shadow-sm p-4">
              <h2 className="font-semibold mb-3">{t("damageInfoSection")}</h2>
              <div className="grid grid-cols-1 gap-4">
                <Field label={t("glassType")} value={form.glassType} onChange={(v) => set(["glassType"], v)} />
                <div>
                  <label className="block text-sm mb-1 text-gray-600 dark:text-gray-300">{t("damageNotes")}</label>
                  <textarea
                    value={form.damageNotes}
                    onChange={(e) => set(["damageNotes"], e.target.value)}
                    rows={3}
                    className="w-full border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-shadow"
                  />
                </div>
              </div>
            </section>

            <section className="bg-white dark:bg-gray-900 dark:border dark:border-gray-800 rounded-xl shadow-sm p-4">
              <h2 className="font-semibold mb-1">{t("photosSection")}</h2>
              <p className="text-xs text-gray-500 mb-3">{t("photosHint")}</p>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                {PHOTO_CATEGORIES.map((cat) => (
                  <PhotoCategory
                    key={cat}
                    label={t(`photoCategories.${cat}`)}
                    photos={form.intakePhotos[cat] || []}
                    onAdd={(file) => addPhoto(cat, file)}
                    onRemove={(i) => removePhoto(cat, i)}
                  />
                ))}
              </div>
            </section>

            <button type="submit" disabled={saving} className="w-full bg-gray-900 hover:bg-gray-800 dark:bg-blue-600 dark:hover:bg-blue-700 text-white rounded-lg transition-colors py-3 font-semibold text-sm disabled:opacity-40">
              {saving ? t("saving") : t("saveButton")}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
