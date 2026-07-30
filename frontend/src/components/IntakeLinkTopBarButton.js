"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { sendQuoteIntake } from "@/lib/api";

export default function IntakeLinkTopBarButton({ quote, onChange }) {
  const t = useTranslations("intakeLink");
  const [copied, setCopied] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");

  const hasLink = !!quote.intakeToken;

  async function handleSend() {
    setSending(true);
    setError("");
    try {
      const result = await sendQuoteIntake(quote.id, { methods: ["SMS", "Email"], expiresInDays: 7 });
      onChange(result.quote);
    } catch (e) {
      setError(e.message);
    } finally {
      setSending(false);
    }
  }

  function handleCopy() {
    const link = `${window.location.origin}/intake/${quote.intakeToken}`;
    navigator.clipboard.writeText(link).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  if (error) return <p className="text-red-600 dark:text-red-400 text-xs">{error}</p>;

  if (!hasLink) {
    return (
      <button
        type="button"
        onClick={handleSend}
        disabled={sending}
        className="bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors px-4 py-2 text-sm disabled:opacity-40 whitespace-nowrap"
      >
        {t("sendLink")}
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={handleCopy}
      className="border rounded-lg px-4 py-2 text-sm whitespace-nowrap dark:border-gray-700 dark:text-gray-100"
    >
      {copied ? t("linkCopied") : t("copyLink")}
    </button>
  );
}
