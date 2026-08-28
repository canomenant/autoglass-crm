"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import PaymentForm from "@/components/PaymentForm";
import {
  getPayment,
  updatePayment,
  markPaymentReady,
  approvePayment,
  payPayment,
  cancelPayment,
  getPaymentNotes,
  getPayoutObligations,
  getBonusItems,
  addBonusItem,
  removeBonusItem,
  createStatementLink,
  regenerateStatementLink,
  getCurrentUser,
} from "@/lib/api";
import { getPaymentPermissions } from "@/lib/permissions";

const BONUS_TYPES = ["CC_HANDLING", "SPIFF", "REVIEWS", "ITEMIZED_INVOICE", "ADMIN_FEE", "CALLING_SERVICE", "INSURANCE_PROCESSED", "TRIP_CANCELLED", "PRIOR_BALANCE", "SALARY", "WARRANTY", "OTHER"];

function money(n) {
  return `$${Number(n || 0).toFixed(2)}`;
}

export default function PaymentDetailPage() {
  const { id } = useParams();
  const t = useTranslations("payments");
  const tn = useTranslations("notes");
  const tc = useTranslations("common");
  const [payment, setPayment] = useState(null);
  const [notes, setNotes] = useState([]);
  const [obligations, setObligations] = useState([]);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [statementUrl, setStatementUrl] = useState("");
  const [statementViews, setStatementViews] = useState(0);
  const [bonusItems, setBonusItems] = useState([]);
  const [nuevoBono, setNuevoBono] = useState({ bonusType: "", amount: "", note: "" });
  const user = getCurrentUser();
  const perms = getPaymentPermissions(user?.role);

  // Se lee de las obligaciones, no de payment.workOrderIds. Dos razones. La primera es que estaba
  // roto: workOrderIds guarda NUMEROS de orden ("Wo-2796") y esto los comparaba contra w.id, que es
  // un UUID, asi que la lista salia siempre vacia. La segunda es que aunque se arreglara la
  // comparacion seguiria siendo la respuesta equivocada — workOrderIds es derivado y esta deduplicado
  // por orden, mientras que la deuda es por orden Y por parte: Dist-0244 paga 27 obligaciones sobre
  // 26 ordenes, porque Wo-2825 le debe dos partes distintas.
  function load() {
    getPayment(id).then(setPayment).catch((e) => setError(e.message));
    getPayoutObligations(id)
      .then((r) => setObligations(r.obligations || []))
      .catch(() => setObligations([]));
    getPaymentNotes(id).then(setNotes).catch(() => {});
    getBonusItems(id).then((r) => setBonusItems(r.items || [])).catch(() => setBonusItems([]));
  }

  useEffect(load, [id]);

  async function handleSubmit(data) {
    try {
      const updated = await updatePayment(id, data);
      setPayment(updated);
      setMessage(t("updated"));
    } catch (e) {
      setError(e.message);
    }
  }

  async function handleAction(action) {
    try {
      let updated;
      if (action === "mark-ready") updated = await markPaymentReady(id);
      if (action === "approve") updated = await approvePayment(id);
      if (action === "pay") updated = await payPayment(id, {});
      if (action === "cancel") {
        if (!confirm(t("confirmCancel"))) return;
        const reason = prompt(t("cancelReasonPrompt")) || "";
        updated = await cancelPayment(id, reason);
      }
      setPayment(updated);
    } catch (e) {
      setError(e.message);
    }
  }

  // Agregar o quitar un renglon recalcula el bono del lote y su total: el bono ES la suma de sus
  // renglones, asi que el servidor devuelve el pago ya recalculado y se toma de ahi.
  async function agregarBono() {
    try {
      const r = await addBonusItem(id, { ...nuevoBono, amount: Number(nuevoBono.amount) });
      setPayment(r.payment);
      setBonusItems(r.items || []);
      setNuevoBono({ bonusType: "", amount: "", note: "" });
    } catch (e) {
      setError(e.message);
    }
  }

  async function quitarBono(itemId) {
    try {
      const r = await removeBonusItem(id, itemId);
      setPayment(r.payment);
      setBonusItems(r.items || []);
    } catch (e) {
      setError(e.message);
    }
  }

  function urlDe(token) {
    return `${window.location.origin}/${window.location.pathname.split("/")[1] || "en"}/statement/${token}`;
  }

  async function compartir() {
    try {
      const r = await createStatementLink(id);
      setStatementUrl(urlDe(r.token));
      setStatementViews((r.accessLog || []).filter((x) => x.via === "statement-viewed").length);
    } catch (e) {
      setError(e.message);
    }
  }

  async function revocar() {
    if (!confirm(t("confirmRevoke"))) return;
    try {
      const r = await regenerateStatementLink(id);
      setStatementUrl(urlDe(r.token));
      setStatementViews(0);
      setMessage(t("linkRevoked"));
    } catch (e) {
      setError(e.message);
    }
  }

  if (error) return <p className="text-red-600 dark:text-red-400 text-sm">{error}</p>;
  if (!payment) return <p className="text-gray-500 text-sm">{tc("loading")}</p>;

  const hayParte = obligations.some((o) => o.part_number);

  // La base del calculo vive en una columna distinta por tipo: mano de obra para el tecnico,
  // comision bruta para el agente, subtotal facturado para el distribuidor.
  const baseKey = payment.type === "TECHNICIAN" ? "laborSubtotal" : payment.type === "AGENT" ? "grossCommission" : "subtotal";
  const baseAmount = payment.type === "TECHNICIAN" ? payment.baseAmount
    : payment.type === "AGENT" ? payment.grossAmount : payment.subtotal;

  // La suma de las obligaciones listadas deberia dar esa base. En 6 lotes de agente no da — hasta
  // $115 de diferencia — y callarlo deja dos numeros parecidos discrepando sin explicacion en la
  // misma pantalla. Se dice cuanto falta y de donde sale cada cifra.
  const sumaObligaciones = obligations.reduce((a, o) => a + Number(o.amount || 0), 0);
  const descuadre = Number(baseAmount || 0) - sumaObligaciones;

  return (
    <div>
      <Link href="/dashboard/payments" className="text-sm text-gray-500">← {t("backToPayments")}</Link>

      <div className="flex items-center justify-between my-4">
        <h1 className="text-2xl font-semibold dark:text-gray-100 tracking-tight">
          {payment.paymentNumber ? t("paymentDetail", { no: payment.paymentNumber }) : t("paymentDetailDraft")}
        </h1>
        <div className="flex gap-2">
          {perms.approve && payment.status === "Pending" && (
            <button onClick={() => handleAction("mark-ready")} className="border rounded px-4 py-2 text-sm">{t("markReady")}</button>
          )}
          {perms.approve && payment.status === "Ready For Payment" && (
            <button onClick={() => handleAction("approve")} className="bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors px-4 py-2 text-sm">{t("approve")}</button>
          )}
          {perms.pay && payment.status === "Approved" && (
            <button onClick={() => handleAction("pay")} className="bg-green-600 text-white rounded px-4 py-2 text-sm">{t("markPaid")}</button>
          )}
          {perms.edit && payment.status !== "Paid" && payment.status !== "Cancelled" && (
            <button onClick={() => handleAction("cancel")} className="border border-red-300 text-red-600 rounded px-4 py-2 text-sm">{t("cancelPayment")}</button>
          )}
          <button onClick={compartir} className="border border-gray-200 dark:border-gray-700 rounded-lg px-4 py-2 text-sm dark:text-gray-200">
            {t("shareStatement")}
          </button>
        </div>
      </div>

      {/* El link es una credencial: muestra cuanto gana una persona. Por eso se emite a pedido, se
          puede revocar, y se dice cuantas veces se abrio en vez de dejarlo correr a ciegas. */}
      {statementUrl && (
        <div className="bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-900 rounded-xl p-4 mb-6">
          <div className="text-xs text-gray-500 dark:text-gray-400 mb-2">{t("statementLinkHint")}</div>
          <div className="flex flex-wrap items-center gap-2">
            <input readOnly value={statementUrl} onFocus={(e) => e.target.select()}
              className="flex-1 min-w-[260px] border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-3 py-2 text-sm font-mono" />
            <button onClick={() => navigator.clipboard?.writeText(statementUrl).then(() => setMessage(t("linkCopied")))}
              className="bg-gray-900 dark:bg-blue-600 text-white rounded-lg px-4 py-2 text-sm">{t("copyLink")}</button>
            <a href={statementUrl} target="_blank" rel="noreferrer"
              className="border border-gray-200 dark:border-gray-700 rounded-lg px-4 py-2 text-sm dark:text-gray-200">{t("openStatement")}</a>
            <a href={`${statementUrl}?print=1`} target="_blank" rel="noreferrer"
              className="border border-gray-200 dark:border-gray-700 rounded-lg px-4 py-2 text-sm dark:text-gray-200">{t("downloadPdf")}</a>
            <button onClick={revocar} className="text-red-600 text-sm px-2">{t("revokeLink")}</button>
          </div>
          {statementViews > 0 && (
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">{t("statementViews", { count: statementViews })}</p>
          )}
        </div>
      )}

      {message && <p className="text-green-600 dark:text-green-400 text-sm mb-4">{message}</p>}

      <div className="bg-gray-50 rounded-lg p-4 mb-6 flex flex-wrap gap-6">
        <div>
          <div className="text-xs text-gray-500">{t("type")}</div>
          <div className="font-semibold">{t(`types.${payment.type}`)}</div>
        </div>
        <div>
          <div className="text-xs text-gray-500">{t("status")}</div>
          <div className="font-semibold">{t(`statuses.${payment.status}`)}</div>
        </div>
        <div>
          <div className="text-xs text-gray-500">{t("amount")}</div>
          <div className="font-semibold">{money(payment.amount)}</div>
        </div>
        {/* Solo las notas capturadas de verdad — la composicion heredada del import no son notas
            y vive como una linea propia en el desglose. */}
        {(payment.noteCreditTotal > 0 || payment.noteDebitTotal > 0) && (
          <>
            {payment.noteCreditTotal > 0 && (
              <div>
                <div className="text-xs text-gray-500">{tn("creditNotesTitle")}</div>
                <div className="font-semibold text-green-700">- {money(payment.noteCreditTotal)}</div>
              </div>
            )}
            {payment.noteDebitTotal > 0 && (
              <div>
                <div className="text-xs text-gray-500">{tn("debitNotesTitle")}</div>
                <div className="font-semibold text-red-700">+ {money(payment.noteDebitTotal)}</div>
              </div>
            )}
          </>
        )}
      </div>

      {/* El desglose completo del lote de tecnico. Los tres terminos de efectivo y partes entraban
          en el total desde fb6c84e pero nunca se mostraron: Tech-0011 decia $382.92 sin explicar
          que salian de $1,260 de mano de obra menos $712 de efectivo que el tecnico ya cobro de
          sus trabajos, menos $265.08 de partes que se llevo, mas $100 de bono. */}
      {/* Se muestra para los tres tipos. Estaba limitado a tecnico, y por eso Agent-0234 exhibia
          $456.48 sin decir en ninguna parte que $161.00 de eso era bono. */}
      {(
        <section className="bg-white dark:bg-gray-900 dark:border dark:border-gray-800 rounded-xl shadow-sm p-4 mb-6">
          <h2 className="font-semibold mb-3">{t("breakdown")}</h2>
          <div className="text-sm max-w-md">
            {[
              { k: baseKey, v: baseAmount, signo: "" },
              { k: "bonus", v: payment.bonus, signo: "+" },
              { k: "deductions", v: payment.deductions, signo: "-" },
              // Solo el tecnico tiene efectivo y partes; solo el distribuidor tiene impuesto.
              ...(payment.type === "TECHNICIAN" ? [
                { k: "cashCollected", v: payment.cashAdvance, signo: "-" },
                { k: "partsCharged", v: payment.partsDeduction, signo: "-" },
                { k: "partsReturned", v: payment.partsReturn, signo: "+" },
              ] : []),
              ...(payment.type === "DISTRIBUTOR" ? [{ k: "tax", v: payment.taxAmount, signo: "+" }] : []),
              { k: "creditNotes", v: payment.noteCreditTotal, signo: "-" },
              { k: "debitNotes", v: payment.noteDebitTotal, signo: "+" },
              // Lo que las columnas del import traen POR ENCIMA de las notas reales, en una sola
              // linea con nombre propio: era el "+debit/-credit" heredado de AppSheet que parecia
              // notas sin serlo. Se encoge a cero cuando el lote se recaptura (recalculatePayment
              // reescribe las columnas desde las notas) y entonces la linea desaparece sola.
              {
                k: "legacyAdjustments",
                v: (Number(payment.debitNotesTotal || 0) - Number(payment.creditNotesTotal || 0))
                  - (Number(payment.noteDebitTotal || 0) - Number(payment.noteCreditTotal || 0)),
                signo: "±",
              },
            ]
              .filter((x) => x.k === baseKey || Math.abs(Number(x.v || 0)) > 0.004)
              .map((x) => (
                <div key={x.k} className="flex justify-between py-1.5 border-b dark:border-gray-800">
                  <span className="text-gray-500 dark:text-gray-400">
                    {x.signo && <span className="inline-block w-3 font-mono">{x.signo === "±" ? (Number(x.v) >= 0 ? "+" : "-") : x.signo}</span>} {t(`term.${x.k}`)}
                    {/* El motivo del bono vive junto al monto: leerlo aparte no dice nada. */}
                    {x.k === "bonus" && payment.bonusReason && (
                      <span className="block text-xs text-gray-400 dark:text-gray-500 ml-3">{payment.bonusReason}</span>
                    )}
                  </span>
                  <span className="tabular-nums">{money(Math.abs(Number(x.v || 0)))}</span>
                </div>
              ))}
            <div className="flex justify-between pt-2.5 font-semibold border-t-2 border-gray-900 dark:border-gray-200 mt-1">
              <span>{t("netPaid")}</span>
              <span className="tabular-nums">{money(payment.amount)}</span>
            </div>

            {/* El cuadre contra la factura del distribuidor: el flujo real es desglosar la factura
                y aplicar notas hasta que el neto COINCIDA con lo facturado. Este renglon dice
                cuanto falta, y en verde cuando ya da. Solo aparece si se capturo el total. */}
            {payment.type === "DISTRIBUTOR" && payment.invoiceTotal != null && (
              Math.abs(Number(payment.invoiceTotal) - Number(payment.amount)) < 0.005 ? (
                <div className="flex justify-between py-2 text-green-700 dark:text-green-400 font-medium">
                  <span>✓ {t("invoiceMatches", { total: money(payment.invoiceTotal) })}</span>
                </div>
              ) : (
                <div className="py-2 text-amber-700 dark:text-amber-500 text-sm">
                  {t("invoiceGap", {
                    invoice: money(payment.invoiceTotal),
                    net: money(payment.amount),
                    gap: money(Math.abs(Number(payment.invoiceTotal) - Number(payment.amount))),
                  })}
                </div>
              )
            )}
          </div>
        </section>
      )}

      {/* Un bono puede ser varios: los $161.00 de Agent-0234 en AppSheet son cinco de tipos
          distintos. Mientras el lote no tenga renglones el bono es un numero suelto; en cuanto
          tiene uno, el bono ES su suma y se recalcula solo. */}
      {Number(payment.bonus || 0) !== 0 && (
        <section className="bg-white dark:bg-gray-900 dark:border dark:border-gray-800 rounded-xl shadow-sm p-4 mb-6">
          <div className="flex items-baseline justify-between mb-3">
            <h2 className="font-semibold">{t("bonusItems")}</h2>
            <span className="text-sm text-gray-500 dark:text-gray-400">{money(payment.bonus)}</span>
          </div>

          {bonusItems.length > 0 ? (
            <table className="w-full text-sm mb-3">
              <tbody>
                {bonusItems.map((b) => (
                  <tr key={b.id} className="border-b last:border-0 dark:border-gray-800">
                    <td className="p-2">{b.bonusType ? t(`bonusTypes.${b.bonusType}`) : t("bonusTypeNone")}</td>
                    <td className="p-2 text-gray-500 text-xs">{b.note || "—"}</td>
                    <td className="p-2 text-right tabular-nums">{money(b.amount)}</td>
                    <td className="p-2 text-right">
                      <button onClick={() => quitarBono(b.id)} className="text-red-500 text-xs">✕</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="text-xs text-gray-400 dark:text-gray-500 mb-3">{t("bonusItemsHint")}</p>
          )}

          <div className="flex flex-wrap gap-2 items-end">
            <div>
              <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">{t("bonusType")}</label>
              <select value={nuevoBono.bonusType} onChange={(e) => setNuevoBono((b) => ({ ...b, bonusType: e.target.value }))}
                className="border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-3 py-2 text-sm">
                <option value="">{t("bonusTypeNone")}</option>
                {BONUS_TYPES.map((x) => <option key={x} value={x}>{t(`bonusTypes.${x}`)}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">{tc("amount")}</label>
              <input type="number" step="0.01" value={nuevoBono.amount}
                onChange={(e) => setNuevoBono((b) => ({ ...b, amount: e.target.value }))}
                className="w-28 border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-3 py-2 text-sm" />
            </div>
            <div className="flex-1 min-w-[180px]">
              <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">{tc("notes")}</label>
              <input value={nuevoBono.note} onChange={(e) => setNuevoBono((b) => ({ ...b, note: e.target.value }))}
                className="w-full border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-3 py-2 text-sm" />
            </div>
            <button onClick={agregarBono} disabled={!Number(nuevoBono.amount)}
              className="bg-gray-900 dark:bg-blue-600 text-white rounded-lg px-4 py-2 text-sm disabled:opacity-40">
              {t("addBonusItem")}
            </button>
          </div>
        </section>
      )}

      <section className="bg-white dark:bg-gray-900 dark:border dark:border-gray-800 rounded-xl shadow-sm p-4 mb-6">
        <div className="flex items-baseline justify-between mb-3">
          <h2 className="font-semibold">{t("linkedWorkOrders", { count: obligations.length })}</h2>
          <span className="text-sm text-gray-500 dark:text-gray-400">
            {t("listedTotal")} {money(sumaObligaciones)}
          </span>
        </div>
        {Math.abs(descuadre) > 0.005 && (
          <p className="text-xs text-amber-700 dark:text-amber-500 mb-3">
            {t("obligationsGap", { base: money(baseAmount), listed: money(sumaObligaciones), gap: money(Math.abs(descuadre)) })}
          </p>
        )}
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left border-b dark:border-gray-800 text-xs text-gray-400 uppercase">
              <th className="p-2">{t("workOrder")}</th>
              <th className="p-2">{t("party")}</th>
              {/* Cliente y vehiculo identifican el trabajo cuando no hay parte que mostrar, que es
                  el caso de todo lote de tecnico y de agente. */}
              <th className="p-2">{t("customer")}</th>
              {/* La parte solo la traen las obligaciones de distribuidor: la mano de obra del
                  tecnico y la comision del agente no son una pieza. La columna aparece cuando
                  alguna fila la tiene, en vez de quedarse en blanco para los otros dos tipos. */}
              {hayParte && <th className="p-2">{t("partInstalled")}</th>}
              <th className="p-2">{t("workDate")}</th>
              <th className="p-2 text-right">{tc("amount")}</th>
            </tr>
          </thead>
          <tbody>
            {obligations.map((o) => (
              <tr key={o.id} className="border-b last:border-0 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800/60 transition-colors">
                <td className="p-2 font-medium">{o.work_order_no || "—"}</td>
                <td className="p-2">{o.party || "—"}</td>
                <td className="p-2">
                  {o.customer_name || "—"}
                  {o.vehicle && <span className="block text-xs text-gray-400 dark:text-gray-500">{o.vehicle}</span>}
                </td>
                {hayParte && (
                  <td className="p-2">
                    <span className="font-mono text-xs">{o.part_number || "—"}</span>
                    {o.part_description && (
                      <span className="block text-xs text-gray-400 dark:text-gray-500">{o.part_description}</span>
                    )}
                  </td>
                )}
                <td className="p-2">{o.work_date ? String(o.work_date).slice(0, 10) : "—"}</td>
                <td className="p-2 text-right">{money(o.amount)}</td>
              </tr>
            ))}
            {obligations.length === 0 && <tr><td className="p-2 text-gray-500" colSpan={hayParte ? 6 : 5}>{t("noRecords")}</td></tr>}
          </tbody>
        </table>
      </section>

      <section className="bg-white dark:bg-gray-900 dark:border dark:border-gray-800 rounded-xl shadow-sm p-4 mb-6">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold">{tn("linkedNotes")}</h2>
          <div className="flex gap-2">
            {/* Con el pago y su tipo puestos: llegar al formulario en blanco desde AQUI hacia
                creer que la nota quedaria en este pago, y nacia suelta. */}
            <Link href={`/dashboard/payments/credit-notes/create?payment=${payment.id}&entityType=${payment.type}`} className="text-xs text-blue-600">{tn("newCreditNote")}</Link>
            <Link href={`/dashboard/payments/debit-notes/create?payment=${payment.id}&entityType=${payment.type}`} className="text-xs text-blue-600">{tn("newDebitNote")}</Link>
          </div>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left border-b dark:border-gray-800 text-xs text-gray-400 uppercase">
              <th className="p-2">{tn("noteNo")}</th>
              <th className="p-2">{t("type")}</th>
              <th className="p-2">{tn("part")}</th>
              {/* A quien se le carga el vidrio: al tecnico, a la empresa, o se da por perdido. */}
              <th className="p-2">{tn("appliedTo")}</th>
              <th className="p-2 text-right">{tc("amount")}</th>
              <th className="p-2">{t("status")}</th>
              <th className="p-2"></th>
            </tr>
          </thead>
          <tbody>
            {notes.map((n) => (
              <tr key={n.id} className="border-b last:border-0 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800/60 transition-colors">
                <td className="p-2">{n.noteNumber}</td>
                <td className="p-2">{n.noteType === "CREDIT" ? tn("creditNotesTitle") : tn("debitNotesTitle")}</td>
                <td className="p-2 text-gray-500">
                  {n.partNumber || "—"}
                  {n.partDescription && <span className="block text-xs text-gray-400 dark:text-gray-500 max-w-[200px] truncate">{n.partDescription}</span>}
                </td>
                <td className="p-2">
                  {n.appliedTo ? (
                    <>
                      {tn(`appliedToValue.${n.appliedTo}`)}
                      {n.technician && <span className="text-gray-500 text-xs ml-1">{n.technician}</span>}
                    </>
                  ) : (
                    <span className="text-gray-400">{n.entityName || "—"}</span>
                  )}
                </td>
                {/* Una parte que este lote le cobra al tecnico BAJA lo que se le paga, al reves
                    que un debito del distribuidor, que sube lo que le pagamos a el. Mismo tipo de
                    nota, signo opuesto, segun a quien se le este cobrando. */}
                <td className={`p-2 text-right ${n.noteType === "CREDIT" || n.chargedHere ? "text-green-700 dark:text-green-400" : "text-red-700 dark:text-red-400"}`}>
                  {n.noteType === "CREDIT" || n.chargedHere ? "− " : "+ "}{money(n.amount)}
                </td>
                <td className="p-2">{tn(`statuses.${n.status}`)}</td>
                <td className="p-2">
                  <Link
                    href={`/dashboard/payments/${n.noteType === "CREDIT" ? "credit-notes" : "debit-notes"}/${n.id}`}
                    className="text-blue-600 text-xs"
                  >
                    {tc("viewEdit")}
                  </Link>
                </td>
              </tr>
            ))}
            {notes.length === 0 && <tr><td className="p-2 text-gray-500" colSpan={7}>{tn("noRecords")}</td></tr>}
          </tbody>
        </table>
      </section>

      {perms.edit ? (
        <PaymentForm type={payment.type} initialData={payment} onSubmit={handleSubmit} submitLabel={tc("saveChanges")} />
      ) : (
        <p className="text-sm text-gray-500">{tc("viewEdit")}</p>
      )}

      <section className="bg-white dark:bg-gray-900 dark:border dark:border-gray-800 rounded-xl shadow-sm p-4 mt-6">
        <h2 className="font-semibold mb-3">{t("auditTrail")}</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left border-b dark:border-gray-800 text-xs text-gray-400 uppercase">
                <th className="p-2">{t("auditTimestamp")}</th>
                <th className="p-2">{t("auditUser")}</th>
                <th className="p-2">{t("auditAction")}</th>
              </tr>
            </thead>
            <tbody>
              {(payment.auditLog || []).slice().reverse().map((entry, i) => (
                <tr key={i} className="border-b last:border-0 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800/60 transition-colors">
                  <td className="p-2">{new Date(entry.timestamp).toLocaleString()}</td>
                  <td className="p-2">{entry.user}</td>
                  <td className="p-2">{entry.action}</td>
                </tr>
              ))}
              {(!payment.auditLog || payment.auditLog.length === 0) && (
                <tr><td className="p-2 text-gray-500" colSpan={3}>{t("noAuditRecords")}</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
