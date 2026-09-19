"use client";

// Settings → Integrations: qué servicios externos están conectados (correo, SMS, tarjetas) según las
// variables de entorno del backend en Railway, y un correo de prueba. Aquí NO se capturan llaves:
// Antonio las pone en Railway y esta pantalla solo dice si ya están. 19-sep-2026.

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { getIntegrationsStatus, sendTestEmail, sendTestSms, getCurrentUser } from "@/lib/api";

const INPUT = "border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none";

function Estado({ ok, t }) {
  return (
    <span className={`text-xs font-semibold rounded-full px-2 py-1 ${ok ? "bg-green-100 text-green-700" : "bg-gray-200 text-gray-600 dark:bg-gray-800 dark:text-gray-300"}`}>
      {ok ? t("connected") : t("notConnected")}
    </span>
  );
}

function Tarjeta({ title, body, setup, info, t, children }) {
  return (
    <section className="bg-white dark:bg-gray-900 dark:border dark:border-gray-800 rounded-xl shadow-sm p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="font-semibold dark:text-gray-100">{title}</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400">{body}</p>
        </div>
        <Estado ok={info?.configured} t={t} />
      </div>
      <dl className="text-sm grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
        <dt className="text-gray-400">{t("provider")}</dt><dd className="dark:text-gray-200">{info?.provider}</dd>
        {info?.from !== undefined && <><dt className="text-gray-400">{t("from")}</dt><dd className="dark:text-gray-200">{info.from || "—"}</dd></>}
        {info?.mode !== undefined && <><dt className="text-gray-400">{t("mode")}</dt><dd className="dark:text-gray-200">{info.mode || "—"}</dd></>}
        {info?.missing?.length > 0 && <><dt className="text-gray-400">{t("missing")}</dt><dd className="font-mono text-xs text-red-600 dark:text-red-400">{info.missing.join(", ")}</dd></>}
      </dl>
      {!info?.configured && <p className="text-xs text-gray-500 dark:text-gray-400 border-l-2 border-gray-200 dark:border-gray-700 pl-3">{setup}</p>}
      {children}
    </section>
  );
}

export default function IntegrationsPage() {
  const t = useTranslations("integrations");
  const [status, setStatus] = useState(null);
  const [error, setError] = useState("");
  const [to, setTo] = useState("");
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState(null);
  const [smsTo, setSmsTo] = useState("");
  const [smsSending, setSmsSending] = useState(false);
  const [smsResult, setSmsResult] = useState(null);

  async function probarSms() {
    setSmsSending(true); setSmsResult(null);
    try {
      const r = await sendTestSms(smsTo);
      setSmsResult({ ok: true, ...r });
    } catch (e) {
      setSmsResult({ ok: false, error: e.message });
    } finally {
      setSmsSending(false);
    }
  }

  function cargar() {
    getIntegrationsStatus().then(setStatus).catch((e) => setError(e.message));
  }

  useEffect(() => {
    cargar();
    setTo(getCurrentUser()?.email || "");
  }, []);

  async function probar() {
    setSending(true); setResult(null);
    try {
      const r = await sendTestEmail(to);
      setResult({ ok: true, ...r });
    } catch (e) {
      setResult({ ok: false, error: e.message });
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link href="/dashboard/settings" className="text-xs text-blue-600 dark:text-blue-400">← {t("back")}</Link>
          <h1 className="text-2xl font-semibold tracking-tight dark:text-gray-100 mt-1">{t("title")}</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 max-w-2xl">{t("subtitle")}</p>
        </div>
        <button onClick={cargar} className="rounded-lg border border-gray-200 dark:border-gray-700 px-3 py-2 text-sm dark:text-gray-200">{t("refresh")}</button>
      </div>
      {error && <p className="text-red-600 text-sm">{error}</p>}
      {!status && !error && <p className="text-gray-500 text-sm">…</p>}

      {status && (
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
          <Tarjeta title={t("email.title")} body={t("email.body")} setup={t("email.setup")} info={status.email} t={t}>
            {status.email.configured && (
              <div className="border-t border-gray-100 dark:border-gray-800 pt-3 space-y-2">
                <label className="block text-xs text-gray-500 dark:text-gray-400">{t("testEmail")}</label>
                <div className="flex gap-2">
                  <input value={to} onChange={(e) => setTo(e.target.value)} className={`${INPUT} flex-1`} placeholder="name@example.com" />
                  <button onClick={probar} disabled={sending || !to} className="rounded-lg bg-blue-600 hover:bg-blue-700 px-3 py-2 text-sm text-white disabled:opacity-40">
                    {sending ? t("sending") : t("send")}
                  </button>
                </div>
                {result && (
                  <p className={`text-xs ${result.ok ? "text-green-600" : "text-red-600"}`}>
                    {result.ok ? t("testOk", { to: result.to, id: result.id }) : t("testFail", { error: result.error })}
                  </p>
                )}
              </div>
            )}
          </Tarjeta>
          <Tarjeta title={t("sms.title")} body={t("sms.body")} setup={t("sms.setup")} info={status.sms} t={t}>
            {status.sms.configured && (
              <div className="border-t border-gray-100 dark:border-gray-800 pt-3 space-y-2">
                <label className="block text-xs text-gray-500 dark:text-gray-400">{t("testSms")}</label>
                <div className="flex gap-2">
                  <input value={smsTo} onChange={(e) => setSmsTo(e.target.value)} className={`${INPUT} flex-1`} placeholder="(909) 555-0123" />
                  <button onClick={probarSms} disabled={smsSending || !smsTo} className="rounded-lg bg-blue-600 hover:bg-blue-700 px-3 py-2 text-sm text-white disabled:opacity-40">
                    {smsSending ? t("sending") : t("send")}
                  </button>
                </div>
                {smsResult && (
                  <p className={`text-xs ${smsResult.ok ? "text-green-600" : "text-red-600"}`}>
                    {smsResult.ok ? t("testSmsOk", { to: smsResult.to, status: smsResult.status }) : t("testFail", { error: smsResult.error })}
                  </p>
                )}
                <p className="text-[11px] text-gray-400">{t("smsTrialHint")}</p>
              </div>
            )}
          </Tarjeta>
          <Tarjeta title={t("cards.title")} body={t("cards.body")} setup={t("cards.setup")} info={status.cards} t={t} />
        </div>
      )}
    </div>
  );
}
