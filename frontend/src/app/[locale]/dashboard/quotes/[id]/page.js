"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Link, useRouter } from "@/i18n/navigation";
import QuoteForm from "@/components/QuoteForm";
import IntakeLinkPanel from "@/components/IntakeLinkPanel";
import IntakeLinkTopBarButton from "@/components/IntakeLinkTopBarButton";
import { getQuote, updateQuote, convertQuote } from "@/lib/api";
import { getQuoteStatusColorClass } from "@/lib/quoteStatusColors";
import { useTopBarSlot } from "@/lib/TopBarSlotContext";

export default function EditQuotePage() {
  const { id } = useParams();
  const router = useRouter();
  const t = useTranslations("quotes");
  const tw = useTranslations("workOrders");
  const tc = useTranslations("common");
  const [quote, setQuote] = useState(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [workOrderId, setWorkOrderId] = useState(null);
  const [dirty, setDirty] = useState(false);
  const formRef = useRef(null);

  useEffect(() => {
    getQuote(id)
      .then(setQuote)
      .catch((e) => setError(e.message));
  }, [id]);

  // Memoized so this only changes when `quote` itself changes (load/save), not on every render —
  // otherwise a fresh element reference each render feeds back through the slot context and
  // re-renders this whole page in a loop (see TopBarSlotContext.js).
  const topBarContent = useMemo(
    () => (quote ? <IntakeLinkTopBarButton quote={quote} onChange={setQuote} /> : null),
    [quote]
  );
  useTopBarSlot(topBarContent);

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
      const updated = await updateQuote(id, data);
      setQuote(updated);
      setMessage(t("savedSuccess"));
      setDirty(false);
      setTimeout(() => router.push("/dashboard/quotes"), 1200);
    } catch (e) {
      setError(e.message);
    }
  }

  async function handleConvert() {
    try {
      const workOrder = await convertQuote(id);
      setWorkOrderId(workOrder.id);
      setMessage(t("converted", { no: workOrder.workOrderNo }));
      setQuote((prev) => ({ ...prev, status: "Converted" }));
    } catch (e) {
      setError(e.message);
    }
  }

  function handleDiscard() {
    if (!confirm(tw("unsavedChangesBody"))) return;
    window.location.reload();
  }

  if (error) return <p className="text-red-600 dark:text-red-400 text-sm">{error}</p>;
  if (!quote) return <p className="text-gray-500 text-sm">{tc("loading")}</p>;

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-semibold dark:text-gray-100 tracking-tight flex items-center gap-2">
          {quote.quoteNo}
          <span className={`text-xs font-medium rounded-full px-2 py-1 ${getQuoteStatusColorClass(quote.status)}`}>
            {t(`statuses.${quote.status}`)}
          </span>
        </h1>
        {quote.status === "Approved" && (
          <button onClick={handleConvert} className="bg-green-600 text-white rounded px-4 py-2 text-sm">
            {t("convertToWorkOrder")}
          </button>
        )}
      </div>

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

      {message && (
        <p className="text-green-600 dark:text-green-400 text-sm mb-4">
          {message}{" "}
          {workOrderId && (
            <Link href={`/dashboard/workorders/${workOrderId}`} className="underline">
              {t("viewWorkOrder")}
            </Link>
          )}
        </p>
      )}

      <div className="mb-6">
        <IntakeLinkPanel quote={quote} onChange={setQuote} />
      </div>

      <QuoteForm initialData={quote} onSubmit={handleSubmit} onCancel={() => router.push("/dashboard/quotes")} onDirtyChange={handleDirty} formRef={formRef} />
    </div>
  );
}
