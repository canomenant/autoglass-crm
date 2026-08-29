"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { getTechnicians, getAgentsBasic, getDistributorsBasic, getPayments, getPartNumbers, getDebitNotes, getCreditNotes } from "@/lib/api";
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
  "Part Returned",
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
  const [form, setForm] = useState({
    ...empty,
    ...initialData,
    // El cargo al tecnico viene con otros nombres en la nota guardada (technician /
    // chargePayoutId, puestos por la bandeja o por un lote); aqui se editan como campos propios.
    chargeTechnician: initialData?.chargedToType === "TECHNICIAN" ? initialData.technician || "" : "",
    chargePayoutId: initialData?.chargePayoutId || "",
    debitNoteId: initialData?.debitNoteId || "",
    resolution: initialData?.resolution && initialData.resolution !== "TECH" ? initialData.resolution : "",
    resolutionWorkOrderNo: initialData?.resolutionWorkOrderNo || "",
  });
  const [technicians, setTechnicians] = useState([]);
  const [agents, setAgents] = useState([]);
  const [distributors, setDistributors] = useState([]);
  const [payments, setPayments] = useState([]);
  const [partNumbers, setPartNumbers] = useState([]);
  const [techPayments, setTechPayments] = useState([]);
  const [saving, setSaving] = useState(false);
  const [debitNotes, setDebitNotes] = useState([]);
  const [creditNotes, setCreditNotes] = useState([]);

  useEffect(() => {
    getTechnicians().then(setTechnicians).catch(() => {});
    getAgentsBasic().then(setAgents).catch(() => {});
    getDistributorsBasic().then(setDistributors).catch(() => {});
    getPartNumbers().then(setPartNumbers).catch(() => {});
    // Solo el debito cobra partes a tecnicos.
    if (noteType === "DEBIT") getPayments({ type: "TECHNICIAN" }).then(setTechPayments).catch(() => {});
    // Solo el credito resuelve debit notes (la parte devuelta cuyo credito llego).
    if (noteType === "CREDIT") {
      getDebitNotes({}).then(setDebitNotes).catch(() => {});
      getCreditNotes({}).then(setCreditNotes).catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  async function handleSubmit(e) {
    e.preventDefault();
    // Un solo envio a la vez: el doble clic en Save creaba dos notas con el mismo numero.
    if (saving) return;
    setSaving(true);
    try {
      // El monto viaja como texto mientras se edita (ver el comentario del campo); numero al enviar.
      await onSubmit({ ...form, amount: Number(form.amount || 0), noteType });
    } finally {
      setSaving(false);
    }
  }

  const reasons = noteType === "CREDIT" ? CREDIT_REASONS : DEBIT_REASONS;

  // El cargo estampado en un pago ya no se edita desde aqui: anular ese pago es el camino.
  const chargeLocked = !!initialData?.chargePayoutId;

  // Solo los pagos DEL tecnico elegido — sin filtro salian los 286 de todos. La coincidencia es
  // flexible en ambos sentidos porque el catalogo y los pagos escriben el nombre distinto
  // ("Joel Alexander" en tecnicos vs "Joel Alexander Lopez Castillo" en las obligaciones del
  // pago); una igualdad estricta dejaria la lista vacia justo para esos.
  const chargeTechPayments = useMemo(() => {
    const sel = String(form.chargeTechnician || "").trim().toLowerCase();
    if (!sel) return [];
    return techPayments.filter((p) =>
      (p.parties || []).some((name) => {
        const n = String(name || "").trim().toLowerCase();
        return n && (n.includes(sel) || sel.includes(n));
      })
    );
  }, [techPayments, form.chargeTechnician]);

  // Debit notes que un credito puede resolver: vivas y sin credito ya enlazado — mas la propia,
  // para que el valor guardado siempre tenga su opcion.
  const debitNoteOptions = useMemo(() => {
    const tomadas = new Set(creditNotes.filter((c) => c.debitNoteId).map((c) => c.debitNoteId));
    if (initialData?.debitNoteId) tomadas.delete(initialData.debitNoteId);
    return debitNotes.filter((d) =>
      !["Void", "Cancelled"].includes(d.status) && !tomadas.has(d.id)
    );
  }, [debitNotes, creditNotes, initialData]);

  // Cambiar de tecnico invalida el pago elegido: era de otro.
  function handleChargeTechChange(name) {
    setForm((prev) => ({ ...prev, chargeTechnician: name, chargePayoutId: "" }));
  }

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
              onChange={(e) => set("amount", e.target.value)}
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

        {noteType === "CREDIT" && (
          <div className="mt-4 border border-green-200 dark:border-green-500/30 bg-green-50/60 dark:bg-green-500/5 rounded-lg p-3">
            {/* El cierre de una devolucion: este credito prueba que el distribuidor devolvio el
                dinero de aquella parte. Enlazarlo marca la debit note como RETURNED. */}
            <h3 className="text-sm font-semibold text-green-800 dark:text-green-300 mb-1">{t("resolvesDebitSection")}</h3>
            <p className="text-xs text-green-700 dark:text-green-400/80 mb-3">{t("resolvesDebitHint")}</p>
            <select
              value={form.debitNoteId || ""}
              onChange={(e) => set("debitNoteId", e.target.value)}
              className="w-full border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-shadow text-sm"
            >
              <option value="">{t("resolvesDebitNone")}</option>
              {debitNoteOptions.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.noteNumber} — {d.partNumber || "?"} — ${Number(d.amount || 0).toFixed(2)}{d.entityName ? ` (${d.entityName})` : ""}
                </option>
              ))}
            </select>
          </div>
        )}

        {noteType === "DEBIT" && !form.chargeTechnician && (
          <div className="mt-4 border border-gray-200 dark:border-gray-700 rounded-lg p-3">
            {/* Los otros dos cierres del ciclo de una parte: la absorbio la COMPANIA (instalada en
                una orden, o perdida) o se DEVOLVIO (y queda esperando el credito del distribuidor,
                que es quien la cierra). El cargo al tecnico va en su seccion y tiene precedencia. */}
            <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-1">{t("resolutionSection")}</h3>
            <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">{t("resolutionHint")}</p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <select
                value={form.resolution || ""}
                onChange={(e) => set("resolution", e.target.value)}
                className="w-full border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-shadow text-sm"
              >
                <option value="">{t("resolutionOpen")}</option>
                <option value="INSTALLED">{t("resolutionInstalled")}</option>
                <option value="RETURNED">{t("resolutionReturned")}</option>
                <option value="LOSS">{t("resolutionLoss")}</option>
              </select>
              {form.resolution === "INSTALLED" && (
                <input
                  value={form.resolutionWorkOrderNo || ""}
                  onChange={(e) => set("resolutionWorkOrderNo", e.target.value)}
                  placeholder={t("resolutionWoPlaceholder")}
                  className="w-full border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-shadow text-sm"
                  required
                />
              )}
              {form.resolution === "RETURNED" && (
                <p className="text-xs text-gray-500 dark:text-gray-400 self-center">{t("resolutionReturnedHint")}</p>
              )}
            </div>
          </div>
        )}

        {noteType === "DEBIT" && (
          <div className="mt-4 border border-amber-200 dark:border-amber-500/30 bg-amber-50/60 dark:bg-amber-500/5 rounded-lg p-3">
            {/* Los dos lados de una parte comprada para el tecnico: arriba, el pago del
                DISTRIBUIDOR donde se pago la factura (suma); aqui, a que tecnico se le descuenta.
                Enlazar un pago de tecnico como "Related Payment" hace lo contrario de lo que
                parece — le SUMA al tecnico — y asi fue como Tech-0001 subio de $770.00 a $831.32. */}
            <h3 className="text-sm font-semibold text-amber-800 dark:text-amber-300 mb-1">{t("chargeTechSection")}</h3>
            <p className="text-xs text-amber-700 dark:text-amber-400/80 mb-3">{t("chargeTechHint")}</p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm mb-1 text-gray-600 dark:text-gray-300">{t("chargeTechName")}</label>
                <select
                  value={form.chargeTechnician || ""}
                  onChange={(e) => handleChargeTechChange(e.target.value)}
                  disabled={chargeLocked}
                  className="w-full border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-shadow text-sm disabled:opacity-60"
                >
                  <option value="">{t("chargeTechNone")}</option>
                  {technicians.map((u) => <option key={u.id} value={u.name}>{u.name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm mb-1 text-gray-600 dark:text-gray-300">{t("chargeTechPayment")}</label>
                <select
                  value={form.chargePayoutId || ""}
                  onChange={(e) => set("chargePayoutId", e.target.value)}
                  disabled={chargeLocked || !form.chargeTechnician}
                  className="w-full border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-shadow text-sm disabled:opacity-60"
                >
                  <option value="">{t("chargeTechPaymentNone")}</option>
                  {/* El pago ya guardado siempre tiene su opcion, alcance o no el filtro por
                      nombre — la misma regla que el metodo de pago y el estado Cancelled. */}
                  {form.chargePayoutId && !chargeTechPayments.some((p) => String(p.id) === String(form.chargePayoutId)) &&
                    techPayments.filter((p) => String(p.id) === String(form.chargePayoutId)).map((p) => (
                      <option key={p.id} value={p.id}>{p.paymentNumber} — ${Number(p.amount || 0).toFixed(2)}</option>
                    ))}
                  {chargeTechPayments.map((p) => (
                    <option key={p.id} value={p.id}>{p.paymentNumber} — ${Number(p.amount || 0).toFixed(2)}</option>
                  ))}
                </select>
                <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">{t("chargeTechPaymentHint")}</p>
              </div>
            </div>
          </div>
        )}

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

      <button type="submit" disabled={saving} className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg transition-colors px-6 py-2">
        {saving ? tc("saving") : submitLabel || tc("save")}
      </button>
    </form>
  );
}
