"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { getTechnicians, getAgents, getDistributors, getPayments, getPartNumbers } from "@/lib/api";
import SearchableSelect from "./SearchableSelect";

const ENTITY_TYPES = ["DISTRIBUTOR", "TECHNICIAN", "AGENT"];

const CREDIT_REASONS = [
  "Returned Material",
  "Damaged Glass Return",
  "Warranty Credit",
  "Inventory Adjustment",
  "Overpayment",
  "Refund",
  "Accounting Correction",
  "Insurance Reimbursement",
];

// Cargos al tecnico ademas de los de distribuidor/inventario: lo que la empresa compra y luego
// descuenta del pago. Los valores se guardan tal cual como texto (igual que los existentes), asi
// que añadir aqui basta — no hay catalogo en la base.
const DEBIT_REASONS = [
  "Additional Freight",
  "Rush Order",
  "Inventory Loss",
  "Damaged Material",
  "Technician Chargeback",
  "Parts Purchased for Tech",
  "Tools & Equipment",
  "Supplies / Consumables",
  "Uniform / Safety Gear",
  "Cash Advance Recovery",
  "Administrative Fee",
  "Accounting Adjustment",
  "Rework Cost",
];

const empty = {
  entityType: "DISTRIBUTOR",
  entityId: "",
  entityName: "",
  relatedPaymentId: "",
  amount: 0,
  partNumber: "",
  partDescription: "",
  invoiceNumber: "",
  reason: "",
  description: "",
  issueDate: new Date().toISOString().slice(0, 10),
  attachment: null,
};

export default function NoteForm({ noteType, initialData, onSubmit, submitLabel }) {
  const t = useTranslations("notes");
  const tc = useTranslations("common");
  const [form, setForm] = useState({ ...empty, ...initialData });
  const [technicians, setTechnicians] = useState([]);
  const [agents, setAgents] = useState([]);
  const [distributors, setDistributors] = useState([]);
  const [payments, setPayments] = useState([]);
  const [partNumbers, setPartNumbers] = useState([]);

  useEffect(() => {
    getTechnicians().then(setTechnicians).catch(() => {});
    getAgents().then(setAgents).catch(() => {});
    getDistributors().then(setDistributors).catch(() => {});
    getPartNumbers().then(setPartNumbers).catch(() => {});
  }, []);

  // El mismo catalogo y el mismo buscador que usan las cotizaciones: se busca por numero O por
  // descripcion NAGS, y elegir la parte trae su descripcion sola. El value es el numero de parte
  // (no el id del catalogo) porque es lo que la nota guarda y lo que el historico ya tiene.
  const partOptions = useMemo(
    () =>
      partNumbers
        .filter((p) => String(p.partNumber || "").trim())
        .map((p) => ({
          value: p.partNumber,
          label: p.partNumber,
          searchText: `${p.partNumber} ${p.nagsDescription}`,
        })),
    [partNumbers]
  );

  function handlePartChange(partNumber) {
    const match = partNumbers.find((p) => p.partNumber === partNumber);
    setForm((prev) => ({
      ...prev,
      partNumber: partNumber || "",
      partDescription: match?.nagsDescription || "",
    }));
  }

  useEffect(() => {
    getPayments({ type: form.entityType }).then(setPayments).catch(() => {});
  }, [form.entityType]);

  function set(field, value) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  function handleEntityTypeChange(entityType) {
    setForm((prev) => ({
      ...prev,
      entityType,
      entityId: "",
      entityName: "",
      relatedPaymentId: "",
      reason: "",
    }));
  }

  function handleEntityChange(entityId) {
    // Sin Number(): los ids de tecnicos y distribuidores son UUID, y Number("uuid") es NaN — el
    // select no reconocia el valor y volvia solo a "Select entity...", que se veia como "no me
    // deja seleccionar". El backend ya guarda el id como texto (String(data.entityId)); solo los
    // agentes tienen id numerico, y comparar como texto tambien les sirve. Mismo fallo que ya se
    // corrigio con customers.id en el QuoteForm.
    let name = "";
    if (form.entityType === "DISTRIBUTOR") name = distributors.find((d) => String(d.id) === String(entityId))?.name || "";
    if (form.entityType === "TECHNICIAN") name = technicians.find((u) => String(u.id) === String(entityId))?.name || "";
    if (form.entityType === "AGENT") name = agents.find((u) => String(u.id) === String(entityId))?.name || "";
    set("entityId", entityId || "");
    set("entityName", name);
  }

  function handleRelatedPaymentChange(paymentId) {
    const payment = payments.find((p) => p.id === Number(paymentId));
    setForm((prev) => ({
      ...prev,
      relatedPaymentId: paymentId ? Number(paymentId) : "",
      entityId: payment ? (payment.distributorId ?? payment.technicianId ?? payment.agentId ?? prev.entityId) : prev.entityId,
    }));
  }

  function handleAttachment(file) {
    const reader = new FileReader();
    reader.onload = () => set("attachment", { name: file.name, url: reader.result });
    reader.readAsDataURL(file);
  }

  function handleSubmit(e) {
    e.preventDefault();
    onSubmit({ ...form, noteType });
  }

  const reasons = noteType === "CREDIT" ? CREDIT_REASONS : DEBIT_REASONS;

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <section className="bg-white dark:bg-gray-900 dark:border dark:border-gray-800 rounded-xl shadow-sm p-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm mb-1 text-gray-600 dark:text-gray-300">{t("entityType")}</label>
            <select
              value={form.entityType}
              onChange={(e) => handleEntityTypeChange(e.target.value)}
              className="w-full border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-shadow text-sm"
            >
              {ENTITY_TYPES.map((et) => (
                <option key={et} value={et}>{t(`entityTypes.${et}`)}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm mb-1 text-gray-600 dark:text-gray-300">{t("entity")} <span className="text-red-500">*</span></label>
            <select
              value={form.entityId || ""}
              onChange={(e) => handleEntityChange(e.target.value)}
              className="w-full border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-shadow text-sm"
              required
            >
              <option value="">{t("selectEntity")}</option>
              {form.entityType === "DISTRIBUTOR" && distributors.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              {form.entityType === "TECHNICIAN" && technicians.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
              {form.entityType === "AGENT" && agents.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          </div>
        </div>

        <div className="mt-4">
          <label className="block text-sm mb-1 text-gray-600 dark:text-gray-300">{t("relatedPayment")}</label>
          <select
            value={form.relatedPaymentId || ""}
            onChange={(e) => handleRelatedPaymentChange(e.target.value)}
            className="w-full border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-shadow text-sm"
          >
            <option value="">{t("selectRelatedPayment")}</option>
            {payments.map((p) => (
              <option key={p.id} value={p.id}>{p.paymentNumber} — ${Number(p.amount).toFixed(2)}</option>
            ))}
          </select>
        </div>

        {/* Qué vidrio es y de qué papel del distribuidor sale: sin estos dos campos la nota no se
            puede rastrear — ni contra la factura ni contra la parte devuelta. */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
          <div>
            <label className="block text-sm mb-1 text-gray-600 dark:text-gray-300">{t("partNumberLabel")}</label>
            <SearchableSelect
              value={form.partNumber || ""}
              onChange={handlePartChange}
              options={partOptions}
              placeholder={t("partNumberPlaceholder")}
            />
            {form.partDescription && (
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">{form.partDescription}</p>
            )}
          </div>
          <div>
            <label className="block text-sm mb-1 text-gray-600 dark:text-gray-300">{t("distributorInvoiceLabel")}</label>
            <input value={form.invoiceNumber || ""} onChange={(e) => set("invoiceNumber", e.target.value)} placeholder={t("distributorInvoicePlaceholder")} className="w-full border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-shadow text-sm" />
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
          <div>
            <label className="block text-sm mb-1 text-gray-600 dark:text-gray-300">{tc("amount")} <span className="text-red-500">*</span></label>
            <input
              type="number"
              step="0.01"
              value={form.amount}
              onChange={(e) => set("amount", Number(e.target.value))}
              className="w-full border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-shadow text-sm"
              required
              min="0.01"
            />
          </div>
          <div>
            <label className="block text-sm mb-1 text-gray-600 dark:text-gray-300">{t("issueDate")}</label>
            <input
              type="date"
              value={form.issueDate}
              onChange={(e) => set("issueDate", e.target.value)}
              className="w-full border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-shadow text-sm"
            />
          </div>
        </div>

        <div className="mt-4">
          <label className="block text-sm mb-1 text-gray-600 dark:text-gray-300">{t("reason")} <span className="text-red-500">*</span></label>
          <select
            value={form.reason}
            onChange={(e) => set("reason", e.target.value)}
            className="w-full border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-shadow text-sm"
            required
          >
            <option value="">{t("selectReason")}</option>
            {reasons.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
        </div>

        <div className="mt-4">
          <label className="block text-sm mb-1 text-gray-600 dark:text-gray-300">{tc("notes") || t("description")}</label>
          <textarea
            value={form.description}
            onChange={(e) => set("description", e.target.value)}
            className="w-full border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-shadow text-sm"
            rows={3}
          />
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
              {t("uploadAttachment")}
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

      <button type="submit" className="bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors px-6 py-2">
        {submitLabel || tc("save")}
      </button>
    </form>
  );
}
