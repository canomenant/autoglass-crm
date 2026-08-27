"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Link, useRouter } from "@/i18n/navigation";
import QuoteForm from "@/components/QuoteForm";
import IntakeLinkPanel from "@/components/IntakeLinkPanel";
import IntakeLinkTopBarButton from "@/components/IntakeLinkTopBarButton";
import ConvertToWorkOrderAction from "@/components/ConvertToWorkOrderAction";
import QuoteStatusBadge from "@/components/QuoteStatusBadge";
import { getQuote } from "@/lib/api";
import { updateQuoteConfirmingPaidWorkOrder } from "@/lib/quoteSave";
import { useTopBarSlot } from "@/lib/TopBarSlotContext";

export default function EditQuotePage() {
  const { id } = useParams();
  const router = useRouter();
  const t = useTranslations("quotes");
  const tw = useTranslations("workOrders");
  const tc = useTranslations("common");
  const [quote, setQuote] = useState(null);
  const [workOrder, setWorkOrder] = useState(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [dirty, setDirty] = useState(false);
  // QuoteForm copia initialData a su propio estado al montarse y no vuelve a mirarlo. Al convertir,
  // la cotización pasa a "Converted" en el servidor pero el formulario seguía enseñando -y
  // guardando- el estado anterior: convertir y darle a Guardar devolvía la cotización a "Draft"
  // con su orden de trabajo ya creada. Remontarlo es lo que hace que el formulario vea el estado
  // nuevo, y sólo ocurre al convertir, que es cuando el estado cambia por debajo del usuario.
  const [formKey, setFormKey] = useState(0);
  const formRef = useRef(null);

  useEffect(() => {
    getQuote(id)
      .then((q) => {
        setQuote(q);
        setWorkOrder(q.workOrder || null);
      })
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
      const updated = await updateQuoteConfirmingPaidWorkOrder(id, data, { tQuotes: t, tWorkOrders: tw });
      // null means the user backed out of the already-paid prompt: nothing was written, so leave
      // the form dirty and say nothing rather than flashing "saved" and navigating away.
      if (!updated) return;
      setQuote(updated);
      setMessage(t("savedSuccess"));
      setDirty(false);
      setTimeout(() => router.push("/dashboard/quotes"), 1200);
    } catch (e) {
      setError(e.message);
    }
  }

  function handleConverted(created) {
    setWorkOrder({ id: created.id, workOrderNo: created.workOrderNo, status: created.status });
    setQuote((prev) => ({ ...prev, status: "Converted" }));
    setMessage(t("converted", { no: created.workOrderNo }));
    setFormKey((k) => k + 1);
    setDirty(false);
  }

  function handleDiscard() {
    if (!confirm(tw("unsavedChangesBody"))) return;
    window.location.reload();
  }

  if (error) return <p className="text-red-600 dark:text-red-400 text-sm">{error}</p>;
  if (!quote) return <p className="text-gray-500 text-sm">{tc("loading")}</p>;

  return (
    <div>
      <div className="flex items-center gap-3 mb-6">
        <h1 className="text-2xl font-semibold dark:text-gray-100 tracking-tight">{quote.quoteNo}</h1>
        {/* El estado guardado, el que hay en el servidor. El de la cabecera del formulario puede
            ir por delante mientras haya cambios sin guardar — para eso está el aviso ámbar. */}
        <QuoteStatusBadge status={quote.status} size="md" variant="strong" withDot />
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
          {workOrder && (
            <Link href={`/dashboard/workorders/${workOrder.id}`} className="underline">
              {t("viewWorkOrder")}
            </Link>
          )}
        </p>
      )}

      <div className="mb-6">
        <IntakeLinkPanel quote={quote} onChange={setQuote} />
      </div>

      <QuoteForm
        key={formKey}
        initialData={quote}
        onSubmit={handleSubmit}
        onCancel={() => router.push("/dashboard/quotes")}
        onDirtyChange={handleDirty}
        formRef={formRef}
        statusActions={<ConvertToWorkOrderAction quote={quote} workOrder={workOrder} dirty={dirty} onConverted={handleConverted} />}
      />
    </div>
  );
}
