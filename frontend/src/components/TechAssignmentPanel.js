"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import SearchableSelect from "./SearchableSelect";
import { getTechnicians, assignTech, sendWorkOrderNotification, getWorkOrderNotifications, updateWorkOrder, regenerateMobileLink, getWorkOrder } from "@/lib/api";

// Agrupados por lo que el tecnico va a hacer con el dato — a quien visita, que carro, que trabajo,
// cuanto cobra — en vez de una rejilla de 19 casillas sin orden. El grupo tambien permite marcar o
// desmarcar de a bloques, que es como se usa: "mandale todo menos el dinero".
const INFO_GROUPS = [
  { key: "customer", fields: ["customerName", "primaryPhone", "customerEmail", "address", "appointmentDate", "appointmentTime"] },
  { key: "vehicle", fields: ["vehicleInfo", "bodyType", "vin", "licensePlate"] },
  { key: "job", fields: ["partNumber", "jobType", "distributor", "specialInstructions", "customerNotes", "insuranceInfo"] },
  // Lo que el tecnico necesita saber de dinero: si le cobra al cliente y cuanto gana el. Su propio
  // pago no es lo mismo que exponerlo en la oficina — es su dinero.
  { key: "money", fields: ["balanceToCollect", "technicianPay"] },
  { key: "access", fields: ["mobileLink"] },
];

const INFO_FIELDS = INFO_GROUPS.flatMap((g) => g.fields);

const ATTACHMENT_FIELDS = ["damagePhotos", "customerPhotos", "insuranceCard", "workOrderPdf", "quotePdf"];

function allChecked(fields) {
  return Object.fromEntries(fields.map((f) => [f, true]));
}

function buildMessage(wo, quote, mobileUrl, fields, techInstructions, attachments, t) {
  const vehicle = [wo.vehicle?.year, wo.vehicle?.make, wo.vehicle?.model].filter(Boolean).join(" ");
  const lines = [t("smsHeader"), "", `WO: ${wo.workOrderNo}`, ""];

  if (fields.customerName) lines.push(`${t("smsCustomer")}: ${wo.customerName || "-"}`);
  if (fields.primaryPhone) lines.push(`${t("fieldPrimaryPhone")}: ${wo.phone || "-"}`);
  if (fields.customerEmail && wo.email) lines.push(`${t("infoFields.customerEmail")}: ${wo.email}`);
  if (fields.address) lines.push(`${t("smsAddress")}: ${wo.address || "-"}`);
  if (fields.appointmentDate || fields.appointmentTime) {
    const parts = [fields.appointmentDate && wo.appointmentDate, fields.appointmentTime && wo.appointmentTime].filter(Boolean);
    lines.push(`${t("smsAppointment")}: ${parts.join(" ") || "-"}`);
  }
  if (fields.vehicleInfo) lines.push(`${t("smsVehicle")}: ${vehicle || "-"}`);
  if (fields.bodyType && wo.vehicle?.bodyType) lines.push(`${t("infoFields.bodyType")}: ${wo.vehicle.bodyType}`);
  if (fields.vin && wo.vehicle?.vin) lines.push(`${t("fieldVin")}: ${wo.vehicle.vin}`);
  if (fields.licensePlate && wo.vehicle?.plate) lines.push(`${t("fieldLicensePlate")}: ${wo.vehicle.plate}`);
  if (fields.partNumber) lines.push(`${t("smsPart")}: ${wo.partNumber || "-"}`);
  if (fields.jobType && wo.jobType) lines.push(`${t("fieldJobType")}: ${wo.jobType}`);
  // De donde recoge el vidrio. Es de lo mas util que se le puede mandar y no estaba.
  if (fields.distributor && wo.distributor) lines.push(`${t("infoFields.distributor")}: ${wo.distributor}`);
  if (fields.specialInstructions && wo.specialInstructions) lines.push(`${t("fieldSpecialInstructions")}: ${wo.specialInstructions}`);
  if (fields.customerNotes && quote?.damageNotes) lines.push(`${t("fieldCustomerNotes")}: ${quote.damageNotes}`);
  if (fields.insuranceInfo && (wo.insuranceCompanyName || wo.policyNumber || wo.claimNumber)) {
    const insuranceParts = [
      wo.insuranceCompanyName,
      wo.policyNumber && `${t("fieldPolicyShort")} ${wo.policyNumber}`,
      wo.claimNumber && `${t("fieldClaimShort")} ${wo.claimNumber}`,
    ].filter(Boolean);
    lines.push(`${t("fieldInsuranceInfo")}: ${insuranceParts.join(" · ")}`);
  }

  // El dinero va al final y separado: es lo que el tecnico busca de un vistazo cuando llega.
  const dinero = [];
  if (fields.balanceToCollect) {
    const saldo = Math.max(0, Number(wo.totalSale || 0) - Number(wo.payment?.amount || 0));
    dinero.push(`${t("infoFields.balanceToCollect")}: $${saldo.toFixed(2)}`);
  }
  if (fields.technicianPay && Number(wo.laborCost || 0) > 0) {
    dinero.push(`${t("infoFields.technicianPay")}: $${Number(wo.laborCost).toFixed(2)}`);
  }
  if (dinero.length) lines.push("", ...dinero);

  if (techInstructions) {
    lines.push("", `${t("fieldTechInstructions")}:`, techInstructions);
  }

  const attachmentLabels = ATTACHMENT_FIELDS.filter((f) => attachments[f]).map((f) => t(`attachments.${f}`));
  if (attachmentLabels.length > 0) {
    lines.push("", `${t("attachmentsIncluded")}: ${attachmentLabels.join(", ")}`);
  }

  if (fields.mobileLink && mobileUrl) {
    lines.push("", `${t("smsViewDetails")}:`, mobileUrl);
  }

  return lines.join("\n");
}

export default function TechAssignmentPanel({ workOrder, quote, onChange }) {
  const t = useTranslations("techAssignment");
  const [technicians, setTechnicians] = useState([]);
  const [selectedTechId, setSelectedTechId] = useState(workOrder.technicianId || "");
  const [methods, setMethods] = useState({ SMS: true, Link: true, Email: false });
  const [notifications, setNotifications] = useState([]);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");
  const [mobileUrl, setMobileUrl] = useState("");
  const [notesSaved, setNotesSaved] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [regenerated, setRegenerated] = useState(false);

  const [infoFields, setInfoFields] = useState(() => allChecked(INFO_FIELDS));
  const [infoOpen, setInfoOpen] = useState(false);
  const [attachments, setAttachments] = useState(() => allChecked(ATTACHMENT_FIELDS));
  // Los tecnicos DE MAS. El principal sigue siendo selectedTechId; estos se guardan aparte con su
  // propio labor, porque cuando dos hacen el mismo trabajo no cobran lo mismo.
  const [extraTechs, setExtraTechs] = useState(() => workOrder.extraTechs || []);
  const [extraTechsSaved, setExtraTechsSaved] = useState(false);
  const [techInstructions, setTechInstructions] = useState(workOrder.techInstructions || "");
  const [internalNotes, setInternalNotes] = useState(workOrder.internalNotes || "");
  const [previewText, setPreviewText] = useState("");
  const [previewEdited, setPreviewEdited] = useState(false);

  useEffect(() => {
    getTechnicians().then(setTechnicians).catch(() => {});
  }, []);

  useEffect(() => {
    setSelectedTechId(workOrder.technicianId || "");
  }, [workOrder.technicianId]);

  useEffect(() => {
    if (workOrder.id) getWorkOrderNotifications(workOrder.id).then(setNotifications).catch(() => {});
  }, [workOrder.id, workOrder.publicToken]);

  useEffect(() => {
    setMobileUrl(workOrder.publicToken ? `${window.location.origin}/work-orders/mobile/${workOrder.publicToken}` : "");
  }, [workOrder.publicToken]);

  // The link has no expiry on purpose — a technician may need it days after the job is sent — so
  // this is the control that makes that safe. Issuing a new token stops the old one resolving
  // immediately, for reading as well as writing, which is what you want the moment a link has been
  // forwarded somewhere it should not have gone.
  async function handleRegenerateLink() {
    if (!confirm(t("regenerateLinkConfirm"))) return;
    setRegenerating(true);
    try {
      await regenerateMobileLink(workOrder.id);
      // Refetched rather than patched locally: the new token has to reach the message preview and
      // the copy/open buttons, all of which read it off workOrder.
      onChange?.(await getWorkOrder(workOrder.id));
      setRegenerated(true);
      setTimeout(() => setRegenerated(false), 4000);
    } catch (e) {
      alert(e.message);
    } finally {
      setRegenerating(false);
    }
  }

  // Sin Number(): technicians.id es un uuid, no un entero. Number("97e18e8a-...") da NaN, asi que
  // esto no encontraba nunca al tecnico y handleAssign mandaba NaN al backend, que respondia
  // "Technician not found" con el tecnico correcto seleccionado en la lista.
  const selectedTech = technicians.find((u) => String(u.id) === String(selectedTechId));

  const technicianOptions = useMemo(
    () =>
      technicians.map((u) => ({
        value: String(u.id),
        label: u.name,
        searchText: [u.name, u.companyName, u.phone, u.mobile].filter(Boolean).join(" "),
      })),
    [technicians]
  );

  const marcados = INFO_FIELDS.filter((f) => infoFields[f]).length;
  const adjuntosMarcados = ATTACHMENT_FIELDS.filter((f) => attachments[f]).length;

  const autoMessage = useMemo(
    () => (workOrder.publicToken ? buildMessage(workOrder, quote, mobileUrl, infoFields, techInstructions, attachments, t) : ""),
    [workOrder, quote, mobileUrl, infoFields, techInstructions, attachments, t]
  );

  useEffect(() => {
    if (!previewEdited) setPreviewText(autoMessage);
  }, [autoMessage, previewEdited]);

  function toggleField(setter, key) {
    setter((prev) => ({ ...prev, [key]: !prev[key] }));
    setPreviewEdited(false);
  }

  function handleResetPreview() {
    setPreviewEdited(false);
    setPreviewText(autoMessage);
  }

  async function handleAssign() {
    if (!selectedTechId) return;
    try {
      const updated = await assignTech(workOrder.id, selectedTechId);
      onChange(updated);
    } catch (e) {
      setError(e.message);
    }
  }

  async function handleSend() {
    const selectedMethods = Object.entries(methods).filter(([, v]) => v).map(([k]) => k);
    if (selectedMethods.length === 0) return;
    try {
      await updateWorkOrder(workOrder.id, { techInstructions, internalNotes });
      await sendWorkOrderNotification(workOrder.id, selectedMethods, previewText);
      const log = await getWorkOrderNotifications(workOrder.id);
      setNotifications(log);
      onChange({ ...workOrder, techInstructions, internalNotes });
    } catch (e) {
      setError(e.message);
    }
  }

  // Lo que le queda al principal. No se guarda en ningun lado: labor_cost es el total de la orden
  // y esto es la resta, que es exactamente como el backend calcula su obligacion de pago.
  const laborTotal = Number(workOrder.laborCost || 0);
  const sumaExtras = extraTechs.reduce((acc, x) => acc + Number(x.laborCost || 0), 0);
  const restaPrincipal = Math.round((laborTotal - sumaExtras) * 100) / 100;

  function setExtraTech(i, cambios) {
    setExtraTechs((prev) => prev.map((x, j) => (j === i ? { ...x, ...cambios } : x)));
  }

  async function handleSaveExtraTechs() {
    setError("");
    try {
      const updated = await updateWorkOrder(workOrder.id, { extraTechs });
      onChange(updated);
      setExtraTechs(updated.extraTechs || []);
      setExtraTechsSaved(true);
      setTimeout(() => setExtraTechsSaved(false), 2000);
    } catch (e) {
      // El backend rechaza que los adicionales sumen mas que el labor total; el mensaje explica
      // por que, asi que se muestra tal cual en vez de uno generico.
      setError(e.message);
    }
  }

  async function handleSaveNotes() {
    try {
      const updated = await updateWorkOrder(workOrder.id, { techInstructions, internalNotes });
      onChange(updated);
      setNotesSaved(true);
      setTimeout(() => setNotesSaved(false), 2000);
    } catch (e) {
      setError(e.message);
    }
  }

  function handleCopyLink() {
    navigator.clipboard.writeText(mobileUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <section className="bg-white dark:bg-gray-900 dark:border dark:border-gray-800 rounded-xl shadow-sm p-4">
      <h2 className="font-semibold mb-1">{t("title")}</h2>
      <p className="text-sm text-gray-500 mb-4">{t("subtitle")}</p>

      {error && <p className="text-red-600 dark:text-red-400 text-sm mb-3">{error}</p>}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
        <div>
          <label className="block text-sm mb-1 text-gray-600 dark:text-gray-300">{t("assignedTechnician")} <span className="text-red-500">*</span></label>
          {/* Un <select> normal no se puede teclear: había que buscar al técnico desplazando la
              lista. SearchableSelect es el mismo control que el formulario de cotización usa para
              agentes y clientes, y su campo siempre se puede escribir, sea la lista grande o no.
              searchText añade compañía y teléfono: a un técnico se le busca por la empresa para la
              que trabaja tanto como por su nombre. */}
          <SearchableSelect
            value={selectedTechId ? String(selectedTechId) : ""}
            onChange={setSelectedTechId}
            options={technicianOptions}
            placeholder={t("selectTechnician")}
            fallbackLabel={workOrder.tech}
          />
          {selectedTech && (
            <div className="text-xs text-gray-500 mt-1">
              {selectedTech.phone} {selectedTech.phone && selectedTech.email && "·"} {selectedTech.email}
            </div>
          )}
        </div>

        <div>
          <label className="block text-sm mb-1 text-gray-600 dark:text-gray-300">{t("deliveryMethod")}</label>
          <div className="flex flex-wrap gap-4 mt-2">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={methods.SMS} onChange={(e) => setMethods((m) => ({ ...m, SMS: e.target.checked }))} />
              {t("smsMethod")}
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={methods.Link} onChange={(e) => setMethods((m) => ({ ...m, Link: e.target.checked }))} />
              {t("linkMethod")}
            </label>
            <label className="flex items-center gap-2 text-sm text-gray-400">
              <input type="checkbox" checked={false} disabled />
              {t("emailMethod")}
            </label>
          </div>
        </div>
      </div>

      {/* Tecnicos adicionales. Es el caso raro -1 orden de 4,580- asi que no ocupa espacio hasta
          que alguien agrega el primero: sin filas, esto es un solo boton. */}
      <div className="border-t dark:border-gray-800 pt-4 mb-4">
        <div className="flex items-center justify-between mb-1">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">{t("extraTechsTitle")}</div>
          <button
            type="button"
            onClick={() => setExtraTechs((prev) => [...prev, { technicianId: "", name: "", laborCost: "" }])}
            className="text-xs text-blue-600 dark:text-blue-400 hover:underline"
          >
            {t("addExtraTech")}
          </button>
        </div>

        {extraTechs.length > 0 && (
          <>
            <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">{t("extraTechsHint")}</p>
            <div className="space-y-2">
              {extraTechs.map((x, i) => (
                <div key={i} className="grid grid-cols-1 sm:grid-cols-[1fr_140px_auto] gap-2 items-start">
                  <SearchableSelect
                    value={x.technicianId ? String(x.technicianId) : ""}
                    onChange={(id) => {
                      const tec = technicians.find((u) => String(u.id) === String(id));
                      setExtraTech(i, { technicianId: id, name: tec?.name || "" });
                    }}
                    options={technicianOptions.filter(
                      (o) =>
                        o.value !== String(selectedTechId) &&
                        !extraTechs.some((otro, j) => j !== i && String(otro.technicianId) === o.value)
                    )}
                    placeholder={t("selectTechnician")}
                    fallbackLabel={x.name}
                  />
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={x.laborCost ?? ""}
                    onChange={(e) => setExtraTech(i, { laborCost: e.target.value })}
                    placeholder={t("extraTechLabor")}
                    className="w-full border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  <button
                    type="button"
                    onClick={() => setExtraTechs((prev) => prev.filter((_, j) => j !== i))}
                    className="text-xs text-red-600 dark:text-red-400 hover:underline px-2 py-2"
                  >
                    {t("removeExtraTech")}
                  </button>
                </div>
              ))}
            </div>

            <div className="flex items-center gap-3 mt-3">
              <button type="button" onClick={handleSaveExtraTechs} className="border rounded px-4 py-2 text-sm">
                {extraTechsSaved ? t("extraTechsSaved") : t("saveExtraTechs")}
              </button>
              {/* En rojo cuando queda negativo: los adicionales suman mas que el labor total y el
                  backend va a rechazar el guardado. Se ve antes de intentarlo. */}
              <span className={`text-xs ${restaPrincipal < 0 ? "text-red-600 dark:text-red-400" : "text-gray-500 dark:text-gray-400"}`}>
                {t("primaryShare")}: ${restaPrincipal.toFixed(2)}
              </span>
            </div>
          </>
        )}
      </div>

      {/* Plegado por defecto. Casi siempre se manda todo, asi que 19 casillas ocupando media
          pantalla es ruido en el caso normal; el encabezado dice cuantas van marcadas para que no
          haga falta abrirlo solo para comprobar. */}
      <div className="border-t dark:border-gray-800 pt-4 mb-4">
        <button
          type="button"
          onClick={() => setInfoOpen((v) => !v)}
          className="w-full flex items-center justify-between text-left"
        >
          <h3 className="text-sm font-semibold">
            {infoOpen ? "▾ " : "▸ "}{t("infoToSendTitle")}
          </h3>
          <span className="text-xs text-gray-500 dark:text-gray-400">
            {t("fieldsSelected", { count: marcados, total: INFO_FIELDS.length })}
            {adjuntosMarcados > 0 && ` · ${t("attachmentsSelected", { count: adjuntosMarcados })}`}
          </span>
        </button>

        {infoOpen && (
          <div className="mt-3 space-y-3">
            {INFO_GROUPS.map((g) => {
              const todos = g.fields.every((f) => infoFields[f]);
              return (
                <div key={g.key}>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">{t(`infoGroups.${g.key}`)}</span>
                    {/* Marcar el bloque entero: "mandale todo menos el dinero" es lo que se hace
                        de verdad, y con casillas sueltas son seis clics. */}
                    <button
                      type="button"
                      onClick={() => setInfoFields((prev) => ({ ...prev, ...Object.fromEntries(g.fields.map((f) => [f, !todos])) }))}
                      className="text-[11px] text-blue-600 dark:text-blue-400"
                    >
                      {todos ? t("uncheckAll") : t("checkAll")}
                    </button>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-x-4 gap-y-1.5">
                    {g.fields.map((f) => (
                      <label key={f} className="flex items-center gap-2 text-xs">
                        <input type="checkbox" checked={!!infoFields[f]} onChange={() => toggleField(setInfoFields, f)} />
                        {t(`infoFields.${f}`)}
                      </label>
                    ))}
                  </div>
                </div>
              );
            })}

            <div>
              <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-400 mb-1">{t("attachmentsTitle")}</div>
              <div className="flex flex-wrap gap-x-5 gap-y-1.5">
                {ATTACHMENT_FIELDS.map((f) => (
                  <label key={f} className="flex items-center gap-2 text-xs">
                    <input type="checkbox" checked={attachments[f]} onChange={() => toggleField(setAttachments, f)} />
                    {t(`attachments.${f}`)}
                  </label>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="border-t dark:border-gray-800 pt-4 mb-4 grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="block text-sm mb-1 text-gray-600 dark:text-gray-300">{t("techInstructionsLabel")}</label>
          <p className="text-xs text-gray-400 mb-1">{t("techInstructionsHint")}</p>
          <textarea
            value={techInstructions}
            onChange={(e) => { setTechInstructions(e.target.value); setPreviewEdited(false); }}
            rows={3}
            className="w-full border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-shadow text-sm"
          />
        </div>
        <div>
          <label className="block text-sm mb-1 text-gray-600 dark:text-gray-300">{t("internalNotesLabel")}</label>
          <p className="text-xs text-amber-600 dark:text-amber-400 mb-1">{t("internalNotesHint")}</p>
          <textarea
            value={internalNotes}
            onChange={(e) => setInternalNotes(e.target.value)}
            rows={3}
            className="w-full border-2 border-amber-200 dark:border-amber-900 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-3 py-2 focus:ring-2 focus:ring-amber-500 focus:border-amber-500 outline-none transition-shadow text-sm"
          />
        </div>
      </div>


      {workOrder.publicToken && (
        <div className="border-t dark:border-gray-800 pt-4 mb-4">
          <div className="flex items-center justify-between mb-1">
            <h3 className="text-sm font-semibold">{t("messagePreviewTitle")}</h3>
            {previewEdited && (
              <button type="button" onClick={handleResetPreview} className="text-xs text-blue-600 dark:text-blue-400 font-medium">
                {t("resetPreview")}
              </button>
            )}
          </div>
          <textarea
            value={previewText}
            onChange={(e) => { setPreviewText(e.target.value); setPreviewEdited(true); }}
            rows={10}
            className="w-full bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-3 text-xs whitespace-pre-wrap font-mono text-gray-600 dark:text-gray-300 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-shadow"
          />
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={handleAssign} disabled={!selectedTechId} className="bg-gray-900 hover:bg-gray-800 dark:bg-blue-600 dark:hover:bg-blue-700 text-white rounded-lg transition-colors px-4 py-2 text-sm disabled:opacity-40">
          {t("assignTech")}
        </button>
        <button type="button" onClick={handleSend} disabled={!workOrder.publicToken} className="bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors px-4 py-2 text-sm disabled:opacity-40">
          {notifications.length > 0 ? t("resendInformation") : t("sendSms")}
        </button>
        <button type="button" onClick={handleCopyLink} disabled={!workOrder.publicToken} className="border rounded px-4 py-2 text-sm disabled:opacity-40">
          {copied ? t("linkCopied") : t("copyLink")}
        </button>
        <button
          type="button"
          onClick={() => window.open(mobileUrl, "_blank")}
          disabled={!workOrder.publicToken}
          className="border rounded px-4 py-2 text-sm disabled:opacity-40"
        >
          {t("openMobileView")}
        </button>
        <button type="button" onClick={handleSaveNotes} className="border rounded px-4 py-2 text-sm">
          {notesSaved ? t("notesSaved") : t("saveNotes")}
        </button>
        {/* Deliberately set apart from the rest and coloured as a warning: it invalidates a link
            that may already be in a technician's hands, and that is not an undo. */}
        <button
          type="button"
          onClick={handleRegenerateLink}
          disabled={!workOrder.publicToken || regenerating}
          className="ml-auto border border-amber-300 dark:border-amber-700 text-amber-700 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-500/10 rounded px-4 py-2 text-sm disabled:opacity-40"
        >
          {regenerated ? t("regenerateLinkDone") : regenerating ? t("regenerateLinkWorking") : t("regenerateLink")}
        </button>
      </div>

      {notifications.length > 0 && (
        <div className="mt-4">
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
                  <td className="py-1">{n.recipient}</td>
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
