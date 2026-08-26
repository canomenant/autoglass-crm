"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { getWorkOrder, updateWorkOrder, getQuote, getCurrentUser, getPayableForWorkOrder } from "@/lib/api";
import { updateQuoteConfirmingPaidWorkOrder } from "@/lib/quoteSave";
import QuoteForm from "@/components/QuoteForm";
import InvoicePanel from "@/components/InvoicePanel";
import TechAssignmentPanel from "@/components/TechAssignmentPanel";
import TechnicianWorkOrderView from "@/components/TechnicianWorkOrderView";
import WorkOrderSummaryPanel from "@/components/WorkOrderSummaryPanel";
import WorkOrderPaymentPanel from "@/components/WorkOrderPaymentPanel";
import WorkOrderOperationsDashboard from "@/components/WorkOrderOperationsDashboard";
import { WORK_ORDER_STATUSES, CANCELLATION_REASONS } from "@/lib/workOrderStatuses";

const STATUSES = WORK_ORDER_STATUSES;

export default function WorkOrderPage() {
  const { id } = useParams();
  const t = useTranslations("workOrders");
  const tq = useTranslations("quotes");
  const tqf = useTranslations("quoteForm");
  const tc = useTranslations("common");
  const [wo, setWo] = useState(null);
  const [quote, setQuote] = useState(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [quoteMessage, setQuoteMessage] = useState("");
  const [quoteError, setQuoteError] = useState("");
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  // Estado de pago (técnico/agente/distribuidor) para el panel de operaciones. Sólo lo puede leer
  // un admin —el endpoint de payable es admin-only— y sólo el panel admin lo usa, así que se pide
  // únicamente en ese caso. Se recarga cuando cambia el nº de orden o el estado de pago del lote.
  const [payableStatus, setPayableStatus] = useState(null);
  const quoteFormRef = useRef(null);

  useEffect(() => {
    getWorkOrder(id).then(setWo).catch((e) => setError(e.message));
  }, [id]);

  useEffect(() => {
    if (wo?.quoteId) {
      setQuoteError("");
      getQuote(wo.quoteId).then(setQuote).catch((e) => setQuoteError(e.message));
    }
  }, [wo?.quoteId]);

  useEffect(() => {
    if (!wo?.workOrderNo || getCurrentUser()?.role !== "ADMIN") return;
    // Los montos (commission/laborCost/glassCost) están en `wo`; al cambiarlos se re-sincroniza la
    // obligación en el backend, así que se vuelve a pedir el estado cuando cualquiera de ellos cambia.
    getPayableForWorkOrder(wo.workOrderNo).then(setPayableStatus).catch(() => setPayableStatus(null));
  }, [wo?.workOrderNo, wo?.commission, wo?.laborCost, wo?.glassCost]);

  useEffect(() => {
    function handleBeforeUnload(e) {
      if (!dirty) return;
      e.preventDefault();
      e.returnValue = "";
    }
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [dirty]);

  const handleQuoteDirty = useCallback(() => setDirty(true), []);

  function set(path, value) {
    setDirty(true);
    setWo((prev) => ({ ...prev, [path[0]]: value }));
  }

  async function handleSave() {
    try {
      await updateWorkOrder(id, wo);
      const freshWo = await getWorkOrder(id);
      setWo(freshWo);
      setMessage(t("updatedSuccess"));
      setDirty(false);
    } catch (e) {
      setError(e.message);
    }
  }

  async function handleQuoteSubmit(data) {
    try {
      const updated = await updateQuoteConfirmingPaidWorkOrder(wo.quoteId, data, { tQuotes: tq, tWorkOrders: t });
      // Declined at the already-paid prompt — the quote was not written, so don't push the
      // customer/vehicle sync to the work order either. Both records stay exactly as they were.
      if (!updated) return;

      const syncedWo = await updateWorkOrder(id, {
        customerName: updated.customerName,
        vehicle: updated.vehicle,
        insuranceCompanyId: updated.insuranceCompanyId,
        claimNumber: updated.claimNumber,
        policyNumber: updated.policyNumber,
        glassType: updated.glassType,
        phone: updated.customerType === "New" ? updated.newCustomer?.phone : wo.phone,
        email: updated.customerType === "New" ? updated.newCustomer?.email : wo.email,
        address: updated.customerType === "New" ? updated.newCustomer?.address : wo.address,
        jobType: updated.lineItems?.[0]?.jobType || wo.jobType,
        nagsDescription: updated.lineItems?.[0]?.nagsDescription || wo.nagsDescription,
        // glassCost/totalSale are deliberately NOT sent here: quotesStore.update() already
        // propagated them to this work order server-side, so that saving from the Quotes list
        // works identically. Sending them again would just race the value we're about to refetch.
        //
        // Technician labor and agent commission are never synced from the quote either — they're
        // what we pay the tech and the agent, which the quote knows nothing about. (laborCost used
        // to be copied from insurance.totalLabor, the amount billed to the *insurer*, which also
        // left every Personal order stuck at 0.) Both are edited on the work order itself.
        partNumber: updated.lineItems?.[0]?.partNumber || wo.partNumber,
      });

      // Reload both records fresh from the database rather than trusting local/intermediate state.
      const [freshQuote, freshWo] = await Promise.all([getQuote(wo.quoteId), getWorkOrder(id)]);
      setQuote(freshQuote);
      setWo(freshWo);
      setQuoteMessage(t("updatedSuccess"));
      setQuoteError("");
      setDirty(false);
    } catch (e) {
      setError(e.message);
    }
  }

  async function handleCustomerUpdated(customer) {
    await updateWorkOrder(id, {
      customerName: customer.name,
      phone: customer.phone,
      email: customer.email,
      address: customer.address,
    });
    const freshWo = await getWorkOrder(id);
    setWo(freshWo);
  }

  async function handleSaveAll() {
    setSaving(true);
    try {
      await handleSave();
      quoteFormRef.current?.requestSubmit();
    } finally {
      setSaving(false);
    }
  }

  function handleDiscardChanges() {
    if (!confirm(t("unsavedChangesBody"))) return;
    window.location.reload();
  }

  if (error) return <p className="text-red-600 dark:text-red-400 text-sm">{error}</p>;
  if (!wo) return <p className="text-gray-500 text-sm">{tc("loading")}</p>;

  const user = getCurrentUser();
  if (user?.role === "TECHNICIAN") {
    return <TechnicianWorkOrderView workOrder={wo} onChange={setWo} />;
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold dark:text-gray-100 tracking-tight">
        {wo.workOrderNo} <span className="text-sm text-gray-500">({wo.quoteNo})</span>
      </h1>

      {dirty && (
        <div className="sticky top-16 z-20 bg-amber-50 border-2 border-amber-300 text-amber-800 rounded-lg px-4 py-3 flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="font-semibold">{t("unsavedChangesTitle")}</div>
            <div className="text-sm">{t("unsavedChangesBody")}</div>
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={handleSaveAll} disabled={saving} className="bg-amber-600 hover:bg-amber-700 text-white rounded-lg transition-colors px-4 py-2 text-sm disabled:opacity-40">
              {t("saveChangesAction")}
            </button>
            <button type="button" onClick={handleDiscardChanges} className="border border-amber-400 rounded-lg px-4 py-2 text-sm">
              {t("discardChanges")}
            </button>
          </div>
        </div>
      )}

      {message && <p className="text-green-600 dark:text-green-400 text-sm">{message}</p>}

      <div className="grid grid-cols-1 xl:grid-cols-[1fr_340px] gap-6 items-start">
        <div className="space-y-6 min-w-0">
          <WorkOrderOperationsDashboard wo={wo} quote={quote} role={user?.role} onChange={set} payableStatus={payableStatus} />

          <TechAssignmentPanel workOrder={wo} quote={quote} onChange={setWo} />

          <InvoicePanel workOrder={wo} />

          <section className="bg-white dark:bg-gray-900 dark:border dark:border-gray-800 rounded-xl shadow-sm p-4">
            <h2 className="font-semibold mb-3">{t("woDetailsSection")}</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm mb-1 text-gray-600 dark:text-gray-300">{tq("status")}</label>
                <select value={wo.status} onChange={(e) => set(["status"], e.target.value)} className="w-full border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-shadow">
                  {STATUSES.map((s) => <option key={s} value={s}>{t(`statuses.${s}`)}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm mb-1 text-gray-600 dark:text-gray-300">{t("specialInstructions")}</label>
                <textarea value={wo.specialInstructions} onChange={(e) => set(["specialInstructions"], e.target.value)} className="w-full border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-shadow" rows={2} />
              </div>
              {wo.status === "Cancelled" && (
                <div>
                  <label className="block text-sm mb-1 text-gray-600 dark:text-gray-300">{t("cancellationReason")} <span className="text-red-500">*</span></label>
                  <select value={wo.cancellationReason || ""} onChange={(e) => set(["cancellationReason"], e.target.value)} className="w-full border-2 border-red-200 dark:border-red-900 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-3 py-2 focus:ring-2 focus:ring-red-500 focus:border-red-500 outline-none transition-shadow">
                    <option value="">{t("selectCancellationReason")}</option>
                    {CANCELLATION_REASONS.map((r) => <option key={r} value={r}>{t(`cancellationReasons.${r}`)}</option>)}
                  </select>
                </div>
              )}
              {/* La comision del agente y la mano de obra del tecnico se editan en el panel de
                  admin, no aqui. Son costos y solo los ve el admin; mezclarlos con el estado y las
                  instrucciones los dejaba a la vista de cualquiera que abriera la orden, y
                  separados de las cifras contra las que se leen. */}
              <div className="flex items-center gap-2">
                <input id="wo-chargeback" type="checkbox" checked={!!wo.isChargeback} onChange={(e) => set(["isChargeback"], e.target.checked)} className="w-4 h-4 rounded border-gray-300 dark:border-gray-600 text-blue-600 focus:ring-blue-500" />
                <label htmlFor="wo-chargeback" className="text-sm text-gray-600 dark:text-gray-300">{t("isChargeback")}</label>
              </div>
            </div>

            <button onClick={handleSave} className="bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors px-6 py-2 mt-4">{tc("saveChanges")}</button>
          </section>

          {!wo.quoteId && (
            <section className="bg-white dark:bg-gray-900 dark:border dark:border-gray-800 rounded-xl shadow-sm p-4">
              <h2 className="font-semibold mb-3">{t("historicalDetailsSection")}</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm mb-1 text-gray-600 dark:text-gray-300">{t("partNumberLabel")}</label>
                  <input value={wo.partNumber || ""} onChange={(e) => set(["partNumber"], e.target.value)} className="w-full border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-shadow" />
                </div>
                <div>
                  <label className="block text-sm mb-1 text-gray-600 dark:text-gray-300">{tqf("jobType")}</label>
                  <input value={wo.jobType || ""} onChange={(e) => set(["jobType"], e.target.value)} className="w-full border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-shadow" />
                </div>
                <div className="md:col-span-2">
                  <label className="block text-sm mb-1 text-gray-600 dark:text-gray-300">{tqf("nagsDescription")}</label>
                  <textarea value={wo.nagsDescription || ""} onChange={(e) => set(["nagsDescription"], e.target.value)} className="w-full border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-shadow" rows={2} />
                </div>
                <div>
                  <label className="block text-sm mb-1 text-gray-600 dark:text-gray-300">{t("distributor")}</label>
                  <input value={wo.distributor || ""} onChange={(e) => set(["distributor"], e.target.value)} className="w-full border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-shadow" />
                </div>
                <div>
                  <label className="block text-sm mb-1 text-gray-600 dark:text-gray-300">{t("agent")}</label>
                  <input value={wo.agent || ""} onChange={(e) => set(["agent"], e.target.value)} className="w-full border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-shadow" />
                </div>
                <div>
                  <label className="block text-sm mb-1 text-gray-600 dark:text-gray-300">{tqf("glassCost")}</label>
                  <input type="number" step="0.01" value={wo.glassCost ?? 0} onChange={(e) => set(["glassCost"], Number(e.target.value))} className="w-full border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-shadow" />
                </div>
                <div>
                  <label className="block text-sm mb-1 text-gray-600 dark:text-gray-300">{t("totalSale")}</label>
                  <input type="number" step="0.01" value={wo.totalSale ?? 0} onChange={(e) => set(["totalSale"], Number(e.target.value))} className="w-full border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-shadow" />
                </div>
              </div>
              <button onClick={handleSave} className="bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors px-6 py-2 mt-4">{tc("saveChanges")}</button>
            </section>
          )}

          <WorkOrderPaymentPanel workOrder={wo} onChange={setWo} />
        </div>

        <aside className="xl:sticky xl:top-6">
          <WorkOrderSummaryPanel wo={wo} quote={quote} />
        </aside>
      </div>

      {wo.quoteId && (
        <div className="pt-4 border-t">
          <h2 className="text-lg font-semibold mb-4">{tq("title")} {wo.quoteNo}</h2>
          {quoteMessage && <p className="text-green-600 dark:text-green-400 text-sm mb-4">{quoteMessage}</p>}
          {quoteError && <p className="text-red-600 dark:text-red-400 text-sm mb-4">{quoteError}</p>}
          {quote ? (
            <QuoteForm initialData={quote} onSubmit={handleQuoteSubmit} onDirtyChange={handleQuoteDirty} formRef={quoteFormRef} onCustomerUpdated={handleCustomerUpdated} extraCosts={{ commission: Number(wo.commission || 0), laborCost: Number(wo.laborCost || 0) }} />
          ) : !quoteError ? (
            <p className="text-gray-500 text-sm">{tc("loading")}</p>
          ) : null}
        </div>
      )}
    </div>
  );
}
