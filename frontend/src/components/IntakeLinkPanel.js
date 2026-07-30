"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { sendQuoteIntake, getQuoteIntakeNotifications } from "@/lib/api";

export default function IntakeLinkPanel({ quote, onChange }) {
  const t = useTranslations("intakeLink");
  const [methods, setMethods] = useState({ SMS: true, Email: true });
  const [expiresInDays, setExpiresInDays] = useState(7);
  const [notifications, setNotifications] = useState([]);
  const [link, setLink] = useState("");
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (quote.id) getQuoteIntakeNotifications(quote.id).then(setNotifications).catch(() => {});
  }, [quote.id, quote.intakeToken]);

  useEffect(() => {
    setLink(quote.intakeToken && typeof window !== "undefined" ? `${window.location.origin}/intake/${quote.intakeToken}` : "");
  }, [quote.intakeToken]);

  async function handleSend() {
    const selectedMethods = Object.entries(methods).filter(([, v]) => v).map(([k]) => k);
    if (selectedMethods.length === 0) return;
    setSending(true);
    setError("");
    try {
      const result = await sendQuoteIntake(quote.id, { methods: selectedMethods, expiresInDays });
      setLink(result.link);
      onChange(result.quote);
      const log = await getQuoteIntakeNotifications(quote.id);
      setNotifications(log);
    } catch (e) {
      setError(e.message);
    } finally {
      setSending(false);
    }
  }

  function handleCopyLink() {
    navigator.clipboard.writeText(link).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  function fmt(d) {
    return d ? new Date(d).toLocaleString() : t("notYet");
  }

  const progress = quote.intakeProgress ?? 0;

  return (
    <section className="bg-white dark:bg-gray-900 dark:border dark:border-gray-800 rounded-xl shadow-sm p-4">
      <h2 className="font-semibold mb-1">{t("title")}</h2>
      <p className="text-sm text-gray-500 mb-4">{t("subtitle")}</p>

      {error && <p className="text-red-600 dark:text-red-400 text-sm mb-3">{error}</p>}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
        <div>
          <label className="block text-sm mb-1 text-gray-600 dark:text-gray-300">{t("deliveryMethod")}</label>
          <div className="flex flex-wrap gap-4 mt-2">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={methods.SMS} onChange={(e) => setMethods((m) => ({ ...m, SMS: e.target.checked }))} />
              {t("smsMethod")}
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={methods.Email} onChange={(e) => setMethods((m) => ({ ...m, Email: e.target.checked }))} />
              {t("emailMethod")}
            </label>
          </div>
        </div>
        <div>
          <label className="block text-sm mb-1 text-gray-600 dark:text-gray-300">{t("expiresInDays")}</label>
          <input
            type="number"
            min={1}
            max={90}
            value={expiresInDays}
            onChange={(e) => setExpiresInDays(Number(e.target.value) || 7)}
            className="w-full border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-shadow text-sm"
          />
        </div>
      </div>

      <div className="flex flex-wrap gap-2 mb-4">
        <button type="button" onClick={handleSend} disabled={sending} className="bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors px-4 py-2 text-sm disabled:opacity-40">
          {quote.intakeToken ? t("resendLink") : t("sendLink")}
        </button>
        <button type="button" onClick={handleCopyLink} disabled={!link} className="border rounded px-4 py-2 text-sm disabled:opacity-40">
          {copied ? t("linkCopied") : t("copyLink")}
        </button>
        <button type="button" onClick={() => window.open(link, "_blank")} disabled={!link} className="border rounded px-4 py-2 text-sm disabled:opacity-40">
          {t("openLink")}
        </button>
      </div>

      {link && (
        <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-3 mb-4 text-xs font-mono text-gray-600 dark:text-gray-300 break-all">{link}</div>
      )}

      {quote.intakeToken && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
          <div>
            <div className="text-xs text-gray-400 uppercase">{t("sentDate")}</div>
            <div className="text-sm">{fmt(quote.intakeSentAt)}</div>
          </div>
          <div>
            <div className="text-xs text-gray-400 uppercase">{t("openedDate")}</div>
            <div className="text-sm">{fmt(quote.intakeOpenedAt)}</div>
          </div>
          <div>
            <div className="text-xs text-gray-400 uppercase">{t("completedDate")}</div>
            <div className="text-sm">{fmt(quote.intakeCompletedAt)}</div>
          </div>
          <div>
            <div className="text-xs text-gray-400 uppercase">{t("progress")}</div>
            <div className="flex items-center gap-2 mt-1">
              <div className="flex-1 h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                <div className="h-full bg-blue-600 rounded-full" style={{ width: `${progress}%` }} />
              </div>
              <span className="text-xs font-medium">{progress}%</span>
            </div>
          </div>
        </div>
      )}

      {notifications.length > 0 && (
        <div>
          <div className="text-xs text-gray-400 uppercase mb-2">{t("notificationLog")}</div>
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left border-b dark:border-gray-800 text-gray-400">
                <th className="py-1">{t("method")}</th>
                <th className="py-1">{t("recipient")}</th>
                <th className="py-1">{t("status")}</th>
                <th className="py-1">{t("sentAt")}</th>
              </tr>
            </thead>
            <tbody>
              {notifications.map((n) => (
                <tr key={n.id} className="border-b last:border-0 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800/60 transition-colors">
                  <td className="py-1">{n.method}</td>
                  <td className="py-1">{n.recipient || "-"}</td>
                  <td className="py-1">{n.status}</td>
                  <td className="py-1">{new Date(n.sentAt).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
