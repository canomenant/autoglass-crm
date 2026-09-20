"use client";

// Settings → Lead buyers: compradores de leads (técnicos/talleres terceros), escalera de precios,
// vencimiento y textos (adelanto, aviso al cliente, términos). Antonio, 19-sep-2026.

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { getLeadBuyers, createLeadBuyer, updateLeadBuyer, deleteLeadBuyer, getLeadSettings, updateLeadSettings } from "@/lib/api";

const INPUT = "w-full border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none";
const VACIO = { name: "", company: "", phone: "", email: "", zones: "", jobTypes: "", laborMin: "", notes: "", active: true };

function Campo({ label, value, onChange, textarea, rows = 3, hint, type = "text" }) {
  return (
    <label className="block text-sm">
      <span className="block text-xs text-gray-500 dark:text-gray-400 mb-1">{label}</span>
      {textarea ? <textarea value={value ?? ""} onChange={(e) => onChange(e.target.value)} rows={rows} className={INPUT} /> : <input type={type} value={value ?? ""} onChange={(e) => onChange(e.target.value)} className={INPUT} />}
      {hint && <span className="block text-[11px] text-gray-400 mt-1">{hint}</span>}
    </label>
  );
}

export default function LeadBuyersPage() {
  const t = useTranslations("leadBuyers");
  const [buyers, setBuyers] = useState([]);
  const [settings, setSettings] = useState(null);
  const [form, setForm] = useState(null); // null = cerrado; {id?...}
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState("");

  function load() {
    getLeadBuyers().then(setBuyers).catch((e) => setError(e.message));
    getLeadSettings().then(setSettings).catch((e) => setError(e.message));
  }
  useEffect(() => { load(); }, []);

  const set = (k) => (v) => setForm((f) => ({ ...f, [k]: v }));
  const setS = (k) => (v) => setSettings((s) => ({ ...s, [k]: v }));

  async function guardarComprador() {
    setSaving(true); setError("");
    try {
      if (form.id) await updateLeadBuyer(form.id, form); else await createLeadBuyer(form);
      setForm(null); load();
    } catch (e) { setError(e.message); } finally { setSaving(false); }
  }
  async function borrar(b) {
    if (!confirm(t("confirmDelete", { name: b.name }))) return;
    try { await deleteLeadBuyer(b.id); load(); } catch (e) { setError(e.message); }
  }
  async function guardarSettings() {
    setSaving(true); setError(""); setSavedMsg("");
    try { setSettings(await updateLeadSettings(settings)); setSavedMsg(t("saved")); setTimeout(() => setSavedMsg(""), 3000); }
    catch (e) { setError(e.message); } finally { setSaving(false); }
  }
  function setLadder(i, k, v) {
    setSettings((s) => ({ ...s, ladder: s.ladder.map((r, j) => (j === i ? { ...r, [k]: v } : r)) }));
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link href="/dashboard/settings" className="text-xs text-blue-600 dark:text-blue-400">← {t("back")}</Link>
          <h1 className="text-2xl font-semibold tracking-tight dark:text-gray-100 mt-1">{t("title")}</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 max-w-2xl">{t("subtitle")}</p>
        </div>
        <button onClick={() => setForm({ ...VACIO })} className="rounded-lg bg-blue-600 hover:bg-blue-700 px-4 py-2 text-sm text-white">{t("newBuyer")}</button>
      </div>
      {error && <p className="text-red-600 text-sm">{error}</p>}

      {form && (
        <section className="bg-white dark:bg-gray-900 dark:border dark:border-gray-800 rounded-xl shadow-sm p-4 space-y-3">
          <h2 className="font-semibold text-sm dark:text-gray-100">{form.id ? t("editBuyer") : t("newBuyer")}</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Campo label={t("name")} value={form.name} onChange={set("name")} />
            <Campo label={t("company")} value={form.company} onChange={set("company")} />
            <Campo label={t("phone")} value={form.phone} onChange={set("phone")} hint={t("phoneHint")} />
            <Campo label={t("email")} value={form.email} onChange={set("email")} />
            <Campo label={t("zones")} value={form.zones} onChange={set("zones")} hint={t("zonesHint")} />
            <Campo label={t("jobTypes")} value={form.jobTypes} onChange={set("jobTypes")} hint={t("jobTypesHint")} />
            <Campo label={t("laborMin")} value={form.laborMin} onChange={set("laborMin")} type="number" hint={t("laborMinHint")} />
            <Campo label={t("notes")} value={form.notes} onChange={set("notes")} />
          </div>
          <label className="flex items-center gap-2 text-sm dark:text-gray-200"><input type="checkbox" checked={form.active !== false} onChange={(e) => set("active")(e.target.checked)} />{t("active")}</label>
          <div className="flex gap-2">
            <button onClick={guardarComprador} disabled={saving || !form.name} className="rounded-lg bg-blue-600 hover:bg-blue-700 px-4 py-2 text-sm text-white disabled:opacity-40">{t("save")}</button>
            <button onClick={() => setForm(null)} className="rounded-lg border border-gray-200 dark:border-gray-700 px-4 py-2 text-sm dark:text-gray-200">{t("cancel")}</button>
          </div>
        </section>
      )}

      <section className="bg-white dark:bg-gray-900 dark:border dark:border-gray-800 rounded-xl shadow-sm overflow-x-auto">
        <table className="w-full text-sm">
          <thead><tr className="text-left border-b dark:border-gray-800 text-xs text-gray-500">
            <th className="p-3">{t("name")}</th><th className="p-3">{t("phone")}</th><th className="p-3">{t("email")}</th><th className="p-3">{t("zones")}</th><th className="p-3">{t("laborMin")}</th><th className="p-3">{t("terms")}</th><th className="p-3"></th>
          </tr></thead>
          <tbody>
            {buyers.map((b) => (
              <tr key={b.id} className={`border-b last:border-0 dark:border-gray-800 ${b.active ? "" : "opacity-50"}`}>
                <td className="p-3"><div className="font-medium">{b.name}</div>{b.company && <div className="text-xs text-gray-400">{b.company}</div>}</td>
                <td className="p-3">{b.phone}</td>
                <td className="p-3">{b.email}</td>
                <td className="p-3 text-xs">{b.zones}</td>
                <td className="p-3">{b.laborMin ? `$${Number(b.laborMin).toFixed(0)}` : "—"}</td>
                <td className="p-3 text-xs">{b.termsAcceptedAt ? `✓ ${new Date(b.termsAcceptedAt).toLocaleDateString()}` : t("termsPending")}</td>
                <td className="p-3 text-right whitespace-nowrap">
                  <button onClick={() => setForm({ ...VACIO, ...b })} className="text-blue-600 dark:text-blue-400 text-xs mr-3">{t("edit")}</button>
                  <button onClick={() => borrar(b)} className="text-red-600 text-xs">{t("delete")}</button>
                </td>
              </tr>
            ))}
            {buyers.length === 0 && <tr><td className="p-3 text-gray-500" colSpan={7}>{t("noBuyers")}</td></tr>}
          </tbody>
        </table>
      </section>

      {settings && (
        <section className="bg-white dark:bg-gray-900 dark:border dark:border-gray-800 rounded-xl shadow-sm p-4 space-y-4">
          <div className="flex items-center justify-between gap-2">
            <h2 className="font-semibold text-sm dark:text-gray-100">{t("pricing")}</h2>
            <div className="flex items-center gap-2">
              {savedMsg && <span className="text-xs text-green-600">{savedMsg}</span>}
              <button onClick={guardarSettings} disabled={saving} className="rounded-lg bg-blue-600 hover:bg-blue-700 px-4 py-2 text-sm text-white disabled:opacity-40">{t("save")}</button>
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">{t("ladder")}</div>
              <table className="text-sm">
                <thead><tr className="text-xs text-gray-400"><th className="pr-3 text-left">{t("ladderUpTo")}</th><th className="text-left">{t("ladderPrice")}</th></tr></thead>
                <tbody>
                  {settings.ladder.map((r, i) => (
                    <tr key={i}>
                      <td className="pr-3 py-1">{r.upTo === null ? <span className="text-gray-500">{t("ladderAbove")}</span> : <input value={r.upTo} onChange={(e) => setLadder(i, "upTo", e.target.value)} className={`${INPUT} w-24`} />}</td>
                      <td className="py-1"><input value={r.price} onChange={(e) => setLadder(i, "price", e.target.value)} className={`${INPUT} w-24`} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="text-[11px] text-gray-400 mt-1">{t("ladderHint")}</p>
              <div className="grid grid-cols-2 gap-3 mt-3">
                <Campo label={t("chipRepairPrice")} value={settings.chipRepairPrice} onChange={setS("chipRepairPrice")} type="number" />
                <Campo label={t("expiresHours")} value={settings.expiresHours} onChange={setS("expiresHours")} type="number" />
              </div>
            </div>
            <div className="space-y-3">
              <Campo label={t("teaserSms")} value={settings.teaserSms} onChange={setS("teaserSms")} textarea rows={4} hint={t("teaserSmsHint")} />
              <Campo label={t("customerNoticeSms")} value={settings.customerNoticeSms} onChange={setS("customerNoticeSms")} textarea rows={3} />
              <Campo label={t("buyerTerms")} value={settings.buyerTerms} onChange={setS("buyerTerms")} textarea rows={8} />
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
