"use client";

// Settings → "Company Profile": los datos de la empresa que van impresos en todo papel que sale al
// cliente (factura pública, statement, página de garantía). Antonio, 19-sep-2026: la tarjeta
// existía vacía y la factura salía sin dirección, teléfono, licencia ni garantía. Un solo objeto
// para toda la compañía; se captura una vez y todo lo lee de aquí.

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { getCompanyProfile, updateCompanyProfile } from "@/lib/api";
import PhoneInput from "@/components/PhoneInput";

const INPUT = "w-full border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none";

function Campo({ label, value, onChange, hint, textarea, rows = 3, placeholder, className = "", phone }) {
  return (
    <label className={`block text-sm ${className}`}>
      <span className="block text-xs text-gray-500 dark:text-gray-400 mb-1">{label}</span>
      {phone ? (
        <PhoneInput value={value} onChange={onChange} className={INPUT} />
      ) : textarea ? (
        <textarea value={value} onChange={(e) => onChange(e.target.value)} rows={rows} placeholder={placeholder} className={INPUT} />
      ) : (
        <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className={INPUT} />
      )}
      {hint && <span className="block text-[11px] text-gray-400 mt-1">{hint}</span>}
    </label>
  );
}

function Tarjeta({ title, children }) {
  return (
    <section className="bg-white dark:bg-gray-900 dark:border dark:border-gray-800 rounded-xl shadow-sm p-4 space-y-3">
      <h2 className="font-semibold text-sm dark:text-gray-100">{title}</h2>
      {children}
    </section>
  );
}

export default function CompanyProfilePage() {
  const t = useTranslations("companyProfile");
  const [form, setForm] = useState(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    getCompanyProfile().then(setForm).catch((e) => setError(e.message));
  }, []);

  const set = (k) => (v) => { setForm((f) => ({ ...f, [k]: v })); setDirty(true); setSaved(false); };

  async function guardar() {
    setSaving(true); setError("");
    try {
      setForm(await updateCompanyProfile(form));
      setDirty(false); setSaved(true);
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  if (error && !form) return <p className="text-red-600 text-sm">{error}</p>;
  if (!form) return <p className="text-gray-500 text-sm">...</p>;

  const warrantyHref = form.warrantyUrl || (typeof window !== "undefined" ? `${window.location.origin}/warranty` : "/warranty");

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link href="/dashboard/settings" className="text-xs text-blue-600 dark:text-blue-400">← {t("back")}</Link>
          <h1 className="text-2xl font-semibold tracking-tight dark:text-gray-100 mt-1">{t("title")}</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 max-w-2xl">{t("subtitle")}</p>
        </div>
        <div className="flex items-center gap-2">
          {saved && !dirty && <span className="text-xs text-green-600">{t("saved")}</span>}
          <button onClick={guardar} disabled={!dirty || saving} className="rounded-lg bg-blue-600 hover:bg-blue-700 px-4 py-2 text-sm text-white disabled:opacity-40">
            {saving ? t("saving") : t("save")}
          </button>
        </div>
      </div>
      {error && <p className="text-red-600 text-sm">{error}</p>}

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <Tarjeta title={t("identity")}>
          <div className="flex items-start gap-4">
            <img src="/logo.png" alt="" className="w-20 h-20 rounded-lg border border-gray-200 dark:border-gray-700 object-contain bg-white" />
            <div className="flex-1 space-y-3">
              <Campo label={t("name")} value={form.name} onChange={set("name")} />
              <Campo label={t("tagline")} value={form.tagline} onChange={set("tagline")} hint={t("taglineHint")} />
            </div>
          </div>
          <Campo label={t("legalName")} value={form.legalName} onChange={set("legalName")} hint={t("legalNameHint")} />
          <p className="text-[11px] text-gray-400">{t("logoHint")}</p>
        </Tarjeta>

        <Tarjeta title={t("contact")}>
          <Campo label={t("address")} value={form.address} onChange={set("address")} />
          <div className="grid grid-cols-3 gap-3">
            <Campo label={t("city")} value={form.city} onChange={set("city")} />
            <Campo label={t("state")} value={form.state} onChange={set("state")} />
            <Campo label={t("zip")} value={form.zip} onChange={set("zip")} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Campo label={t("phone")} value={form.phone} onChange={set("phone")} phone />
            <Campo label={t("altPhone")} value={form.altPhone} onChange={set("altPhone")} phone />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Campo label={t("email")} value={form.email} onChange={set("email")} />
            <Campo label={t("website")} value={form.website} onChange={set("website")} />
            <Campo label={t("partnerEmail")} value={form.partnerEmail || ""} onChange={set("partnerEmail")} hint={t("partnerEmailHint")} placeholder="name@example.com" />
          </div>
        </Tarjeta>

        <Tarjeta title={t("license")}>
          <div className="grid grid-cols-2 gap-3">
            <Campo label={t("licenseLabel")} value={form.licenseLabel} onChange={set("licenseLabel")} placeholder="BAR ARD #" />
            <Campo label={t("licenseNumber")} value={form.licenseNumber} onChange={set("licenseNumber")} />
          </div>
          <p className="text-[11px] text-gray-400">{t("licenseHint")}</p>
        </Tarjeta>

        <Tarjeta title={t("warranty")}>
          <Campo label={t("warrantyTitle")} value={form.warrantyTitle} onChange={set("warrantyTitle")} />
          <Campo label={t("warrantyUrl")} value={form.warrantyUrl} onChange={set("warrantyUrl")} placeholder="https://..." hint={t("warrantyUrlHint")} />
          <Campo label={t("warrantyText")} value={form.warrantyText} onChange={set("warrantyText")} textarea rows={8} hint={t("warrantyTextHint")} />
          <p className="text-[11px] text-gray-400">
            {t("warrantyLinkNow")}{" "}
            <a href={warrantyHref} target="_blank" rel="noreferrer" className="text-blue-600 dark:text-blue-400 underline break-all">{warrantyHref}</a>
          </p>
        </Tarjeta>

        <Tarjeta title={t("invoiceTexts")}>
          <Campo label={t("invoiceTerms")} value={form.invoiceTerms} onChange={set("invoiceTerms")} textarea rows={4} />
          <Campo label={t("paymentInstructions")} value={form.paymentInstructions} onChange={set("paymentInstructions")} textarea rows={3} hint={t("paymentInstructionsHint")} />
          <Campo label={t("invoiceFooter")} value={form.invoiceFooter} onChange={set("invoiceFooter")} />
        </Tarjeta>

        <Tarjeta title={t("emailTexts")}>
          <Campo label={t("emailNote")} value={form.emailNote || ""} onChange={set("emailNote")} textarea rows={9} hint={t("emailNoteHint")} />
          <Campo label={t("reviewUrl")} value={form.reviewUrl || ""} onChange={set("reviewUrl")} placeholder="https://g.page/r/…/review" hint={t("reviewUrlHint")} />
          <label className="flex items-start gap-2 text-sm dark:text-gray-200">
            <input type="checkbox" checked={form.autoReceiptEmail !== false} onChange={(e) => set("autoReceiptEmail")(e.target.checked)} className="mt-1" />
            <span>{t("autoReceiptEmail")}<span className="block text-[11px] text-gray-400">{t("autoReceiptEmailHint")}</span></span>
          </label>
        </Tarjeta>
      </div>

      {form.updatedAt && (
        <p className="text-xs text-gray-400">{t("lastSaved", { when: new Date(form.updatedAt).toLocaleString(), who: form.updatedBy || "—" })}</p>
      )}
    </div>
  );
}
