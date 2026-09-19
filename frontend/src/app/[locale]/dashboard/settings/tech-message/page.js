"use client";

// Settings → "Technician Message": qué se le manda al técnico al asignarle una orden. Una lista de
// campos al estilo de "Configure Table View" (orden por arrastre o flechas, etiqueta editable) con
// dos casillas por campo: SMS (el mensaje corto) y Mobile (el detalle que ve al abrir el link).
// Antonio, 18-sep-2026. Se guarda para toda la compañía; el panel de la orden arranca con esto.

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { getTechMessageConfig, updateTechMessageConfig, resetTechMessageConfig, getWorkOrders, getWorkOrder, getQuote } from "@/lib/api";
import { buildTechMessage, techFieldValue } from "@/lib/techMessage";

const GRUPOS = ["customer", "vehicle", "job", "money", "access"];
const TONO = {
  customer: "bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300",
  vehicle: "bg-violet-50 text-violet-700 dark:bg-violet-950 dark:text-violet-300",
  job: "bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300",
  money: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300",
  access: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300",
};

export default function TechMessageSettingsPage() {
  const t = useTranslations("techMessageSettings");
  const ta = useTranslations("techAssignment");
  const [config, setConfig] = useState(null);
  const [catalog, setCatalog] = useState([]);
  const [attKeys, setAttKeys] = useState([]);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [arrastrando, setArrastrando] = useState(null);
  // Orden de ejemplo para la vista previa.
  const [woNo, setWoNo] = useState("");
  const [muestra, setMuestra] = useState(null);
  const [muestraQuote, setMuestraQuote] = useState(null);
  const [buscando, setBuscando] = useState(false);

  function cargar(c) {
    setConfig({ header: c.header, footer: c.footer, notes: c.notes || "", fields: c.fields, attachments: c.attachments, updatedAt: c.updatedAt, updatedBy: c.updatedBy });
    setCatalog(c.catalog || []);
    setAttKeys(c.attachmentKeys || []);
    setDirty(false);
  }

  useEffect(() => {
    getTechMessageConfig().then(cargar).catch((e) => setError(e.message));
    buscarMuestra("");
  }, []);

  async function buscarMuestra(numero) {
    setBuscando(true);
    try {
      const r = await getWorkOrders({ search: numero || undefined, limit: 1, sortBy: "workOrderNo", sortDir: "desc" });
      const fila = (r.data || [])[0];
      if (!fila) { setMuestra(null); setMuestraQuote(null); return; }
      const wo = await getWorkOrder(fila.id);
      setMuestra(wo);
      setWoNo(wo.workOrderNo || "");
      setMuestraQuote(wo.quoteId ? await getQuote(wo.quoteId).catch(() => null) : null);
    } catch {
      setMuestra(null);
    } finally {
      setBuscando(false);
    }
  }

  const cat = (key) => catalog.find((c) => c.key === key) || {};

  function cambiar(key, campo, valor) {
    setConfig((c) => ({ ...c, fields: c.fields.map((f) => (f.key === key ? { ...f, [campo]: valor } : f)) }));
    setDirty(true);
    setSaved(false);
  }
  function mover(i, delta) {
    setConfig((c) => {
      const j = i + delta;
      if (j < 0 || j >= c.fields.length) return c;
      const fields = [...c.fields];
      [fields[i], fields[j]] = [fields[j], fields[i]];
      return { ...c, fields };
    });
    setDirty(true);
    setSaved(false);
  }
  function soltarEn(i) {
    if (arrastrando == null || arrastrando === i) return;
    setConfig((c) => {
      const fields = [...c.fields];
      const [x] = fields.splice(arrastrando, 1);
      fields.splice(i, 0, x);
      return { ...c, fields };
    });
    setArrastrando(null);
    setDirty(true);
    setSaved(false);
  }
  function campoGeneral(campo, valor) {
    setConfig((c) => ({ ...c, [campo]: valor }));
    setDirty(true);
    setSaved(false);
  }

  async function guardar() {
    setSaving(true);
    setError("");
    try {
      cargar(await updateTechMessageConfig(config));
      setSaved(true);
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }
  async function restablecer() {
    if (!confirm(t("resetConfirm"))) return;
    try {
      cargar(await resetTechMessageConfig());
      setSaved(true);
    } catch (e) {
      setError(e.message);
    }
  }

  const sms = useMemo(() => {
    if (!config || !muestra) return "";
    const mobileUrl = muestra.publicToken ? `${window.location.origin}/work-orders/mobile/${muestra.publicToken}` : `${window.location.origin}/work-orders/mobile/…`;
    return buildTechMessage({
      config, wo: muestra, quote: muestraQuote, mobileUrl,
      enabled: Object.fromEntries(config.fields.map((f) => [f.key, f.sms])),
      attachmentLabels: attKeys.filter((a) => config.attachments?.[a]).map((a) => ta(`attachments.${a}`)),
    });
  }, [config, muestra, muestraQuote, attKeys, ta]);

  const movil = useMemo(() => {
    if (!config || !muestra) return [];
    return config.fields
      .filter((f) => f.mobile)
      // En el link público la aseguradora va sin póliza ni claim (así lo manda el servidor).
      .map((f) => ({ ...f, value: f.key === "insuranceInfo" ? muestra.insuranceCompanyName || "" : techFieldValue(f.key, muestra, muestraQuote, {}, config) }))
      .filter((f) => f.value || !f.skipEmpty);
  }, [config, muestra, muestraQuote]);

  if (error && !config) return <p className="text-red-600 text-sm">{error}</p>;
  if (!config) return <p className="text-gray-500 text-sm">{t("loading")}</p>;

  const nSms = config.fields.filter((f) => f.sms).length;
  const nMovil = config.fields.filter((f) => f.mobile).length;

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
          <button onClick={restablecer} className="rounded-lg border border-gray-200 dark:border-gray-700 px-3 py-2 text-sm dark:text-gray-200">{t("reset")}</button>
          <button onClick={guardar} disabled={!dirty || saving} className="rounded-lg bg-blue-600 hover:bg-blue-700 px-4 py-2 text-sm text-white disabled:opacity-40">
            {saving ? t("saving") : t("save")}
          </button>
        </div>
      </div>
      {error && <p className="text-red-600 text-sm">{error}</p>}

      <div className="grid grid-cols-1 xl:grid-cols-5 gap-6">
        {/* Campos */}
        <div className="xl:col-span-3 space-y-4">
          <div className="bg-white dark:bg-gray-900 dark:border dark:border-gray-800 rounded-xl shadow-sm p-4 grid grid-cols-1 md:grid-cols-2 gap-3">
            <label className="text-sm">
              <span className="block text-xs text-gray-500 dark:text-gray-400 mb-1">{t("header")}</span>
              <input value={config.header} onChange={(e) => campoGeneral("header", e.target.value)}
                className="w-full rounded-lg border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 px-3 py-2 text-sm" />
            </label>
            <label className="text-sm">
              <span className="block text-xs text-gray-500 dark:text-gray-400 mb-1">{t("footer")}</span>
              <input value={config.footer} onChange={(e) => campoGeneral("footer", e.target.value)} placeholder={t("footerPlaceholder")}
                className="w-full rounded-lg border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 px-3 py-2 text-sm" />
            </label>
          </div>

          <div className="bg-white dark:bg-gray-900 dark:border dark:border-gray-800 rounded-xl shadow-sm p-4">
            <label className="text-sm block">
              <span className="block text-xs text-gray-500 dark:text-gray-400 mb-1">{t("notes")}</span>
              <textarea rows={3} value={config.notes} onChange={(e) => campoGeneral("notes", e.target.value)} placeholder={t("notesPlaceholder")}
                className="w-full rounded-lg border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 px-3 py-2 text-sm" />
              <span className="block text-[11px] text-gray-400 mt-1">{t("notesHint")}</span>
            </label>
          </div>

          <div className="bg-white dark:bg-gray-900 dark:border dark:border-gray-800 rounded-xl shadow-sm">
            <div className="flex items-center justify-between px-4 py-3 border-b dark:border-gray-800">
              <h2 className="text-sm font-semibold dark:text-gray-100">{t("fields")}</h2>
              <span className="text-xs text-gray-500 dark:text-gray-400">{t("counts", { sms: nSms, mobile: nMovil, total: config.fields.length })}</span>
            </div>
            <div className="grid grid-cols-[1.5rem_1fr_4.5rem_4.5rem_5.5rem_3.5rem] items-center gap-2 px-4 py-2 text-[11px] uppercase tracking-wide text-gray-400">
              <span />
              <span>{t("colLabel")}</span>
              <span className="text-center">SMS</span>
              <span className="text-center">Mobile</span>
              <span className="text-center">{t("colSkipEmpty")}</span>
              <span />
            </div>
            <div>
              {config.fields.map((f, i) => {
                const c = cat(f.key);
                return (
                  <div key={f.key} draggable onDragStart={() => setArrastrando(i)} onDragOver={(e) => e.preventDefault()} onDrop={() => soltarEn(i)}
                    className={`grid grid-cols-[1.5rem_1fr_4.5rem_4.5rem_5.5rem_3.5rem] items-center gap-2 px-4 py-1.5 border-t dark:border-gray-800 ${arrastrando === i ? "opacity-40" : ""} hover:bg-gray-50 dark:hover:bg-gray-800/50`}>
                    <span className="cursor-grab text-gray-300 select-none" title={t("drag")}>⠿</span>
                    <div className="flex items-center gap-2 min-w-0">
                      <input value={f.label} onChange={(e) => cambiar(f.key, "label", e.target.value)}
                        className="min-w-0 flex-1 rounded border border-transparent hover:border-gray-200 focus:border-blue-400 dark:bg-transparent dark:text-gray-100 px-2 py-1 text-sm" />
                      <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] ${TONO[c.group] || TONO.access}`}>{t(`groups.${c.group || "access"}`)}</span>
                      {c.sensitive && <span className="shrink-0 text-[10px] text-red-500" title={t("sensitiveHint")}>● {t("sensitive")}</span>}
                    </div>
                    <div className="text-center"><input type="checkbox" className="h-4 w-4" checked={!!f.sms} onChange={(e) => cambiar(f.key, "sms", e.target.checked)} /></div>
                    <div className="text-center">
                      <input type="checkbox" className="h-4 w-4" checked={!!f.mobile} disabled={c.mobileAlways || c.smsOnly}
                        title={c.mobileAlways ? t("mobileAlways") : c.smsOnly ? t("smsOnly") : ""}
                        onChange={(e) => cambiar(f.key, "mobile", e.target.checked)} />
                    </div>
                    <div className="text-center"><input type="checkbox" className="h-4 w-4" checked={f.skipEmpty !== false} onChange={(e) => cambiar(f.key, "skipEmpty", e.target.checked)} /></div>
                    <div className="flex justify-end gap-1 text-gray-400">
                      <button type="button" onClick={() => mover(i, -1)} disabled={i === 0} className="disabled:opacity-20 hover:text-gray-700">▲</button>
                      <button type="button" onClick={() => mover(i, 1)} disabled={i === config.fields.length - 1} className="disabled:opacity-20 hover:text-gray-700">▼</button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="bg-white dark:bg-gray-900 dark:border dark:border-gray-800 rounded-xl shadow-sm p-4">
            <h2 className="text-sm font-semibold dark:text-gray-100 mb-1">{t("attachments")}</h2>
            <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">{t("attachmentsHint")}</p>
            <div className="flex flex-wrap gap-x-5 gap-y-1.5">
              {attKeys.map((a) => (
                <label key={a} className="flex items-center gap-2 text-sm dark:text-gray-200">
                  <input type="checkbox" checked={!!config.attachments?.[a]} onChange={(e) => campoGeneral("attachments", { ...config.attachments, [a]: e.target.checked })} />
                  {ta(`attachments.${a}`)}
                </label>
              ))}
            </div>
          </div>
          {config.updatedAt && (
            <p className="text-xs text-gray-400">{t("lastSaved", { when: new Date(config.updatedAt).toLocaleString(), who: config.updatedBy || "—" })}</p>
          )}
        </div>

        {/* Vista previa */}
        <div className="xl:col-span-2 space-y-4">
          <div className="bg-white dark:bg-gray-900 dark:border dark:border-gray-800 rounded-xl shadow-sm p-4">
            <div className="flex items-end gap-2 mb-3">
              <label className="flex-1 text-sm">
                <span className="block text-xs text-gray-500 dark:text-gray-400 mb-1">{t("previewWith")}</span>
                <input value={woNo} onChange={(e) => setWoNo(e.target.value)} onKeyDown={(e) => e.key === "Enter" && buscarMuestra(woNo)} placeholder="Wo-4768"
                  className="w-full rounded-lg border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 px-3 py-2 text-sm" />
              </label>
              <button onClick={() => buscarMuestra(woNo)} className="rounded-lg border border-gray-200 dark:border-gray-700 px-3 py-2 text-sm dark:text-gray-200">{buscando ? "…" : t("load")}</button>
            </div>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-1">{t("smsPreview")}</h3>
            <pre className="whitespace-pre-wrap rounded-lg bg-gray-50 dark:bg-gray-800 dark:text-gray-100 p-3 text-xs font-mono max-h-[26rem] overflow-y-auto">{muestra ? sms : t("noSample")}</pre>
            <p className="text-[11px] text-gray-400 mt-1">{t("smsLength", { n: sms.length })}</p>
          </div>

          <div className="bg-white dark:bg-gray-900 dark:border dark:border-gray-800 rounded-xl shadow-sm p-4">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-2">{t("mobilePreview")}</h3>
            <div className="mx-auto max-w-xs rounded-2xl border-4 border-gray-800 overflow-hidden">
              <div className="bg-gray-900 text-white px-3 py-2">
                <div className="font-bold text-sm">{muestra?.workOrderNo || "Wo-…"}</div>
                <div className="text-[10px] text-gray-300">{muestra?.status || ""}</div>
              </div>
              <div className="bg-gray-100 p-2">
                <div className="bg-white rounded-lg p-2">
                  {movil.map((f) => (
                    <div key={f.key} className="py-1 border-b last:border-0">
                      <div className="text-[9px] text-gray-400 uppercase">{f.label}</div>
                      <div className="text-xs font-medium whitespace-pre-wrap text-gray-900">{f.value || "-"}</div>
                    </div>
                  ))}
                  {!movil.length && <p className="text-xs text-gray-400">{t("noSample")}</p>}
                </div>
                <div className="grid grid-cols-2 gap-1 mt-2 text-[10px] text-white font-semibold">
                  <div className="bg-green-600 rounded py-1.5 text-center">{t("callButton")}</div>
                  <div className="bg-blue-600 rounded py-1.5 text-center">{t("mapButton")}</div>
                </div>
              </div>
            </div>
            <p className="text-[11px] text-gray-400 mt-2">{t("mobileHint")}</p>
          </div>
        </div>
      </div>
    </div>
  );
}
