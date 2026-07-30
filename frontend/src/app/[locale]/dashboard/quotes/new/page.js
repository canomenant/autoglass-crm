"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import QuoteForm from "@/components/QuoteForm";
import { createQuote } from "@/lib/api";

export default function NewQuotePage() {
  const router = useRouter();
  const t = useTranslations("quotes");
  const tw = useTranslations("workOrders");
  const tc = useTranslations("common");
  const [error, setError] = useState("");
  const [dirty, setDirty] = useState(false);
  const formRef = useRef(null);

  const handleDirty = useCallback(() => setDirty(true), []);

  useEffect(() => {
    function handleBeforeUnload(e) {
      if (!dirty) return;
      e.preventDefault();
      e.returnValue = "";
    }
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [dirty]);

  async function handleSubmit(data) {
    try {
      const quote = await createQuote(data);
      setDirty(false);
      router.push(`/dashboard/quotes/${quote.id}`);
    } catch (e) {
      setError(e.message);
    }
  }

  function handleDiscard() {
    if (!confirm(tw("unsavedChangesBody"))) return;
    router.push("/dashboard/quotes");
  }

  return (
    <div>
      <h1 className="text-2xl font-semibold dark:text-gray-100 tracking-tight mb-6">{t("newQuote")}</h1>

      {dirty && (
        <div className="sticky top-16 z-20 bg-amber-50 border-2 border-amber-300 text-amber-800 rounded-lg px-4 py-3 flex flex-wrap items-center justify-between gap-3 mb-4">
          <div>
            <div className="font-semibold">{tw("unsavedChangesTitle")}</div>
            <div className="text-sm">{tw("unsavedChangesBody")}</div>
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={() => formRef.current?.requestSubmit()} className="bg-amber-600 hover:bg-amber-700 text-white rounded-lg transition-colors px-4 py-2 text-sm">
              {tw("saveChangesAction")}
            </button>
            <button type="button" onClick={handleDiscard} className="border border-amber-400 rounded-lg px-4 py-2 text-sm">
              {tw("discardChanges")}
            </button>
          </div>
        </div>
      )}

      {error && <p className="text-red-600 dark:text-red-400 text-sm mb-4">{error}</p>}
      <QuoteForm onSubmit={handleSubmit} onCancel={() => router.push("/dashboard/quotes")} onDirtyChange={handleDirty} formRef={formRef} />
    </div>
  );
}
