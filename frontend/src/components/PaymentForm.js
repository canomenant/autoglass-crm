"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { getPaymentMethods } from "@/lib/api";

const BONUS_TYPES = ["CC_HANDLING", "SPIFF", "REVIEWS", "ITEMIZED_INVOICE", "ADMIN_FEE", "CALLING_SERVICE", "INSURANCE_PROCESSED", "TRIP_CANCELLED", "PRIOR_BALANCE", "SALARY", "WARRANTY", "OTHER"];

function Field({ label, value, onChange, type = "text", placeholder }) {
  return (
    <div>
      <label className="block text-sm mb-1 text-gray-600 dark:text-gray-300">{label}</label>
      <input
        type={type}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="w-full border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-shadow text-sm"
      />
    </div>
  );
}

// Tipo Y motivo, no uno de los dos. El tipo agrupa — es lo que permite preguntar que clase de
// bonos se estan dando — y el texto explica el caso concreto, que ningun catalogo va a cubrir:
// "garantia de 2024 que cubrio de otro tecnico". Va pegado al bono y no en las notas del fondo,
// porque una justificacion separada del numero que justifica no se lee.
//
// Solo aparece cuando hay bono: en los pagos sin bono no estorba.
function BonusDetail({ form, set, t }) {
  if (Number(form.bonus || 0) === 0) return null;
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-4">
      <div>
        <label className="block text-sm mb-1 text-gray-600 dark:text-gray-300">{t("bonusType")}</label>
        <select
          value={form.bonusType || ""}
          onChange={(e) => set("bonusType", e.target.value)}
          className="w-full border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-shadow text-sm"
        >
          <option value="">{t("bonusTypeNone")}</option>
          {BONUS_TYPES.map((x) => <option key={x} value={x}>{t(`bonusTypes.${x}`)}</option>)}
        </select>
      </div>
      <div className="md:col-span-2">
        <Field label={t("bonusReason")} value={form.bonusReason || ""} onChange={(v) => set("bonusReason", v)} />
      </div>
    </div>
  );
}

// Edit-only form for an EXISTING payment batch: payment method/date/notes and the type-specific
// adjustment fields (bonus/deductions for Technician, invoice/PO/tax for Distributor). The Work
// Order composition and entity (Technician/Agent/Distributor) are fixed at creation time via
// PaymentBatchWizard and cannot be changed here — cancel and re-create if the selection was wrong.
export default function PaymentForm({ type, initialData, onSubmit, submitLabel }) {
  const t = useTranslations("payments");
  const tc = useTranslations("common");
  const [form, setForm] = useState({
    paymentMethod: "", paymentDate: "", notes: "",
    bonus: 0, bonusReason: "", bonusType: "", deductions: 0, cashAdvance: 0, partsDeduction: 0, partsReturn: 0,
    invoiceNumber: "", poNumber: "", taxAmount: 0,
    attachment: null,
    ...initialData,
  });
  const [paymentMethods, setPaymentMethods] = useState([]);

  useEffect(() => {
    getPaymentMethods().then(setPaymentMethods).catch(() => {});
  }, []);

  function set(field, value) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  function handleAttachment(file) {
    const reader = new FileReader();
    reader.onload = () => set("attachment", { name: file.name, url: reader.result });
    reader.readAsDataURL(file);
  }

  function addInvoice() {
    set("invoices", [...(form.invoices || []), { date: "", number: "", amount: "", attachment: null }]);
  }

  function setInvoice(i, field, value) {
    const next = [...(form.invoices || [])];
    next[i] = { ...next[i], [field]: value };
    set("invoices", next);
  }

  function removeInvoice(i) {
    set("invoices", (form.invoices || []).filter((_, x) => x !== i));
  }

  function handleInvoiceFile(i, file) {
    const reader = new FileReader();
    reader.onload = () => setInvoice(i, "attachment", { name: file.name, url: reader.result });
    reader.readAsDataURL(file);
  }

  const invoicesSum = (form.invoices || []).reduce((a, f) => a + Number(f.amount || 0), 0);

  function handleSubmit(e) {
    e.preventDefault();
    // Los montos viajan como texto mientras se editan (Field ya no convierte por tecla, que era lo
    // que impedia borrar el 0). Aqui se convierten una sola vez. invoiceTotal aparte: vacio
    // significa "sin capturar" (NULL), no cero.
    const num = (v) => (v === "" || v === null || v === undefined ? 0 : Number(v));
    onSubmit({
      ...form,
      bonus: num(form.bonus),
      deductions: num(form.deductions),
      taxAmount: num(form.taxAmount),
      cashAdvance: num(form.cashAdvance),
      partsDeduction: num(form.partsDeduction),
      partsReturn: num(form.partsReturn),
      // La lista de facturas viaja con montos numericos; el total facturado lo deriva el store de
      // su suma. Este formulario vive en el DETALLE del pago (get, con PDFs completos), asi que
      // los adjuntos existentes van y vuelven enteros.
      invoices: (form.invoices || []).map((f) => ({ ...f, amount: Number(f.amount || 0) })),
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {type === "TECHNICIAN" && (
        <section className="bg-white dark:bg-gray-900 dark:border dark:border-gray-800 rounded-xl shadow-sm p-4">
          <h2 className="font-semibold mb-4">{t("adjustmentsAndDetails")}</h2>
          {/* Los cinco terminos de la formula, no dos. El efectivo que el tecnico cobro de sus
              trabajos y las partes que se llevo del distribuidor ya entraban en el total desde
              fb6c84e, pero solo se podian fijar al crear el lote: si el monto estaba mal, no habia
              donde corregirlo. */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Field label={`+ ${t("bonus")}`} type="number" value={form.bonus} onChange={(v) => set("bonus", v)} />
            <Field label={`− ${t("deductions")}`} type="number" value={form.deductions} onChange={(v) => set("deductions", v)} />
            <Field label={`− ${t("term.cashCollected")}`} type="number" value={form.cashAdvance} onChange={(v) => set("cashAdvance", v)} />
            <Field label={`− ${t("term.partsCharged")}`} type="number" value={form.partsDeduction} onChange={(v) => set("partsDeduction", v)} />
            <Field label={`+ ${t("term.partsReturned")}`} type="number" value={form.partsReturn} onChange={(v) => set("partsReturn", v)} />
          </div>
          <BonusDetail form={form} set={set} t={t} />
          <p className="text-xs text-gray-400 dark:text-gray-500 mt-3">{t("partsChargedHint")}</p>
        </section>
      )}

      {/* No habia seccion de agente, asi que en un pago de agente no existia el campo del bono ni
          donde escribir su motivo — y 221 de los 227 bonos sin clasificar son de agente. */}
      {type === "AGENT" && (
        <section className="bg-white dark:bg-gray-900 dark:border dark:border-gray-800 rounded-xl shadow-sm p-4">
          <h2 className="font-semibold mb-4">{t("adjustmentsAndDetails")}</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Field label={`+ ${t("bonus")}`} type="number" value={form.bonus} onChange={(v) => set("bonus", v)} />
            <Field label={`− ${t("deductions")}`} type="number" value={form.deductions} onChange={(v) => set("deductions", v)} />
          </div>
          <BonusDetail form={form} set={set} t={t} />
        </section>
      )}

      {type === "DISTRIBUTOR" && (
        <section className="bg-white dark:bg-gray-900 dark:border dark:border-gray-800 rounded-xl shadow-sm p-4">
          <h2 className="font-semibold mb-4">{t("adjustmentsAndDetails")}</h2>
          {/* Las facturas del distribuidor que cubre este pago. Un pago suele saldar varias y
              algun credito (monto NEGATIVO): Dist-0015 = 104.43 + 58.80 − 148.69 = 14.54. La suma
              es el total facturado, contra el que cuadra el lote; cada factura puede llevar su
              propio PDF. */}
          <div className="mb-4">
            <div className="flex items-center justify-between mb-2">
              <label className="block text-sm text-gray-600 dark:text-gray-300">{t("invoicesSection")}</label>
              <button type="button" onClick={addInvoice} className="text-xs text-blue-600 dark:text-blue-400 hover:underline">+ {t("addInvoice")}</button>
            </div>
            {(form.invoices || []).length === 0 && (
              <p className="text-xs text-gray-400 dark:text-gray-500 mb-2">{t("noInvoicesYet")}</p>
            )}
            {(form.invoices || []).map((f, i) => (
              <div key={i} className="grid grid-cols-1 md:grid-cols-[140px_1fr_130px_150px_28px] gap-2 mb-2 items-center">
                <input type="date" value={f.date || ""} onChange={(e) => setInvoice(i, "date", e.target.value)} className="border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-2 py-1.5 text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
                <input value={f.number || ""} onChange={(e) => setInvoice(i, "number", e.target.value)} placeholder={t("invoiceNumberPlaceholder")} className="border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-2 py-1.5 text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
                <input type="number" step="0.01" value={f.amount ?? ""} onChange={(e) => setInvoice(i, "amount", e.target.value)} placeholder="0.00" className="border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-2 py-1.5 text-sm text-right focus:ring-2 focus:ring-blue-500 outline-none" />
                {f.attachment ? (
                  <span className="flex items-center gap-1 text-xs min-w-0">
                    <a href={f.attachment.url} target="_blank" rel="noreferrer" className="text-blue-600 dark:text-blue-400 hover:underline truncate">{f.attachment.name}</a>
                    <button type="button" onClick={() => setInvoice(i, "attachment", null)} className="text-red-500 flex-shrink-0">✕</button>
                  </span>
                ) : f.hasAttachment ? (
                  <span className="text-xs text-gray-400">{t("pdfOnFile")}</span>
                ) : (
                  <label className="text-xs text-blue-600 dark:text-blue-400 cursor-pointer hover:underline whitespace-nowrap">
                    {t("attachInvoicePdf")}
                    <input type="file" accept="application/pdf,image/*" className="hidden" onChange={(e) => { const file = e.target.files[0]; if (file) handleInvoiceFile(i, file); e.target.value = ""; }} />
                  </label>
                )}
                <button type="button" onClick={() => removeInvoice(i)} aria-label={t("removeInvoice")} className="text-red-500 hover:text-red-700 text-sm">✕</button>
              </div>
            ))}
            {(form.invoices || []).length > 0 && (
              <div className="flex justify-end gap-4 text-sm font-medium border-t dark:border-gray-800 pt-2 pr-8">
                <span className="text-gray-500 dark:text-gray-400">{t("invoicesTotal")}</span>
                <span className="tabular-nums dark:text-gray-100">${invoicesSum.toFixed(2)}</span>
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Field label={t("poNumber")} value={form.poNumber} onChange={(v) => set("poNumber", v)} />
            <Field label={t("taxAmount")} type="number" value={form.taxAmount} onChange={(v) => set("taxAmount", v)} />
          </div>
          <div className="mt-4">
            <label className="block text-sm mb-1 text-gray-600 dark:text-gray-300">{t("attachment")}</label>
            {form.attachment ? (
              <div className="flex items-center gap-3 text-sm">
                <a href={form.attachment.url} target="_blank" rel="noreferrer" className="text-blue-600 dark:text-blue-400 hover:underline">{form.attachment.name}</a>
                <button type="button" onClick={() => set("attachment", null)} className="text-red-500 text-xs">✕</button>
              </div>
            ) : (
              <label className="inline-block border-2 border-dashed rounded-lg px-4 py-3 text-sm text-blue-600 cursor-pointer">
                {t("uploadInvoice")}
                <input
                  type="file"
                  accept="application/pdf,image/*"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files[0];
                    if (file) handleAttachment(file);
                    e.target.value = "";
                  }}
                />
              </label>
            )}
          </div>
        </section>
      )}

      <section className="bg-white dark:bg-gray-900 dark:border dark:border-gray-800 rounded-xl shadow-sm p-4 grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="block text-sm mb-1 text-gray-600 dark:text-gray-300">{t("paymentMethod")}</label>
          <select
            value={form.paymentMethod}
            onChange={(e) => set("paymentMethod", e.target.value)}
            className="w-full border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-shadow text-sm"
          >
            <option value="">{t("selectPaymentMethod")}</option>
            {/* El valor guardado siempre tiene su opción, esté o no en el catálogo: sin esto, un
                método histórico por tarjeta concreta se mostraba como "Select payment method..."
                aunque estuviera perfectamente guardado. */}
            {form.paymentMethod && !paymentMethods.some((m) => m.name === form.paymentMethod) && (
              <option value={form.paymentMethod}>{form.paymentMethod}</option>
            )}
            {paymentMethods.map((m) => (
              <option key={m.id} value={m.name}>{m.name}</option>
            ))}
          </select>
        </div>
        <Field label={t("paymentDate")} type="date" value={form.paymentDate} onChange={(v) => set("paymentDate", v)} />
      </section>

      <section className="bg-white dark:bg-gray-900 dark:border dark:border-gray-800 rounded-xl shadow-sm p-4">
        <label className="block text-sm mb-1 text-gray-600 dark:text-gray-300">{tc("notes")}</label>
        <textarea
          value={form.notes}
          onChange={(e) => set("notes", e.target.value)}
          className="w-full border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-shadow text-sm"
          rows={3}
        />
      </section>

      <button type="submit" className="bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors px-6 py-2">
        {submitLabel || tc("save")}
      </button>
    </form>
  );
}
