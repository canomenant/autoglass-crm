"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { getMfaStatus, setupMfa, enableMfa, disableMfa } from "@/lib/api";

// Alta y baja del segundo factor.
//
// El secreto se muestra UNA vez, durante el alta, y sólo como texto para teclear a mano: no se
// genera un QR porque eso exigiría una dependencia más en el frontend y las aplicaciones de
// autenticación aceptan la clave escrita. La URI otpauth:// se ofrece como enlace para quien
// abra la app desde el mismo teléfono.
//
// Los códigos de recuperación también se ven una sola vez: se guardan con bcrypt, así que ni el
// servidor puede volver a mostrarlos. Por eso la pantalla insiste en copiarlos antes de cerrar.
export default function MfaSection() {
  const t = useTranslations("mfa");
  const [status, setStatus] = useState(null);
  const [setup, setSetup] = useState(null);
  const [codes, setCodes] = useState(null);
  const [token, setToken] = useState("");
  const [password, setPassword] = useState("");
  const [disabling, setDisabling] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    getMfaStatus().then(setStatus).catch(() => setStatus({ available: false, enabled: false }));
  }, []);

  async function empezar() {
    setError("");
    setBusy(true);
    try {
      setSetup(await setupMfa());
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function activar(e) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      const res = await enableMfa(token.trim());
      setCodes(res.backupCodes);
      setSetup(null);
      setToken("");
      setStatus(await getMfaStatus());
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function desactivar(e) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      await disableMfa(password, token.trim());
      setPassword("");
      setToken("");
      setDisabling(false);
      setStatus(await getMfaStatus());
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  if (!status || !status.available) return null;

  const caja = "bg-white dark:bg-gray-900 dark:border dark:border-gray-800 rounded-xl shadow-sm p-6 space-y-4";
  const input =
    "w-full border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-shadow";

  // Los códigos de recuperación, la única vez que se pueden ver.
  if (codes) {
    return (
      <div className={caja}>
        <h2 className="text-lg font-semibold dark:text-gray-100">{t("backupTitle")}</h2>
        <p className="text-sm bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400 rounded-lg px-4 py-3">
          {t("backupWarning")}
        </p>
        <ul className="grid grid-cols-2 gap-2 font-mono text-sm">
          {codes.map((c) => (
            <li key={c} className="bg-gray-50 dark:bg-gray-800 dark:text-gray-100 rounded px-3 py-2 text-center tracking-wider">
              {c}
            </li>
          ))}
        </ul>
        <button
          type="button"
          onClick={() => setCodes(null)}
          className="w-full bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors py-2 text-sm"
        >
          {t("backupSaved")}
        </button>
      </div>
    );
  }

  return (
    <div className={caja}>
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold dark:text-gray-100">{t("title")}</h2>
          <p className="text-sm text-gray-500 mt-1">{t("description")}</p>
        </div>
        <span
          className={`shrink-0 text-xs font-medium rounded-full px-3 py-1 ${
            status.enabled
              ? "bg-green-50 dark:bg-green-500/10 text-green-700 dark:text-green-400"
              : "bg-gray-100 dark:bg-gray-800 text-gray-500"
          }`}
        >
          {status.enabled ? t("on") : t("off")}
        </span>
      </div>

      {error && <p className="text-red-600 dark:text-red-400 text-sm">{error}</p>}

      {/* Activado: sólo queda poder desactivarlo, y para eso hacen falta contraseña y código. */}
      {status.enabled && !disabling && (
        <>
          <p className="text-sm text-gray-500">{t("remaining", { n: status.backupCodesRemaining })}</p>
          <button
            type="button"
            onClick={() => setDisabling(true)}
            className="text-sm text-red-600 dark:text-red-400 hover:underline"
          >
            {t("disable")}
          </button>
        </>
      )}

      {status.enabled && disabling && (
        <form onSubmit={desactivar} className="space-y-3">
          <p className="text-sm text-gray-500">{t("disableHint")}</p>
          <input type="password" placeholder={t("passwordPlaceholder")} value={password} onChange={(e) => setPassword(e.target.value)} className={input} required />
          <input type="text" inputMode="numeric" autoComplete="one-time-code" placeholder={t("codePlaceholder")} value={token} onChange={(e) => setToken(e.target.value)} className={input} required />
          <div className="flex gap-2">
            <button type="submit" disabled={busy} className="bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white rounded-lg px-4 py-2 text-sm transition-colors">
              {t("disableConfirm")}
            </button>
            <button type="button" onClick={() => { setDisabling(false); setError(""); }} className="text-sm text-gray-500 px-4 py-2">
              {t("cancel")}
            </button>
          </div>
        </form>
      )}

      {/* Sin activar y sin alta empezada. */}
      {!status.enabled && !setup && (
        <button type="button" onClick={empezar} disabled={busy} className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-lg px-4 py-2 text-sm transition-colors">
          {t("enable")}
        </button>
      )}

      {/* Alta en curso: se muestra la clave y se pide un código para confirmar que la app funciona
          ANTES de activar nada — activar sin comprobarlo dejaría la cuenta bloqueada. */}
      {!status.enabled && setup && (
        <form onSubmit={activar} className="space-y-3">
          <p className="text-sm text-gray-500">{t("setupStep1")}</p>
          <code className="block bg-gray-50 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-3 py-3 font-mono text-sm break-all tracking-wider text-center">
            {setup.secret}
          </code>
          <a href={setup.otpauthUri} className="block text-center text-sm text-blue-600 dark:text-blue-400 hover:underline">
            {t("openInApp")}
          </a>
          <p className="text-sm text-gray-500">{t("setupStep2")}</p>
          <input type="text" inputMode="numeric" autoComplete="one-time-code" placeholder={t("codePlaceholder")} value={token} onChange={(e) => setToken(e.target.value)} className={input} required />
          <div className="flex gap-2">
            <button type="submit" disabled={busy} className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-lg px-4 py-2 text-sm transition-colors">
              {t("confirm")}
            </button>
            <button type="button" onClick={() => { setSetup(null); setToken(""); setError(""); }} className="text-sm text-gray-500 px-4 py-2">
              {t("cancel")}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
