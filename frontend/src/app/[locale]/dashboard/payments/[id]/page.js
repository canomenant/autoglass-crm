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
  getPayableParties,
  getPayablePending,
  linkPayoutObligations,
  unlinkPayoutObligation,
  setObligationAmount,
  getBonusItems,
  addBonusItem,
  removeBonusItem,
  createStatementLink,
  regenerateStatementLink,
  getCurrentUser,
  getDebitNotes,
  itemizeLegacyAdjustments,
} from "@/lib/api";
import { getPaymentPermissions } from "@/lib/permissions";

const BONUS_TYPES = ["CC_HANDLING", "SPIFF", "REVIEWS", "ITEMIZED_INVOICE", "ADMIN_FEE", "CALLING_SERVICE", "INSURANCE_PROCESSED", "TRIP_CANCELLED", "PRIOR_BALANCE", "SALARY", "WARRANTY", "OTHER"];

const NOTE_STATUS_COLORS = {
  Active: "bg-amber-100 text-amber-700",
  Applied: "bg-green-100 text-green-700",
  Void: "bg-gray-200 text-gray-600",
  Cancelled: "bg-gray-200 text-gray-600",
};

// Chip enlazable, el mismo lenguaje visual que las listas de credit/debit notes.
function RelChip({ href, tone, children }) {
  const tones = {
    blue: "bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-500/10 dark:text-blue-300 dark:border-blue-500/30",
    green: "bg-green-50 text-green-700 border-green-200 dark:bg-green-500/10 dark:text-green-300 dark:border-green-500/30",
    purple: "bg-purple-50 text-purple-700 border-purple-200 dark:bg-purple-500/10 dark:text-purple-300 dark:border-purple-500/30",
    amber: "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-500/10 dark:text-amber-300 dark:border-amber-500/30",
    gray: "bg-gray-100 text-gray-600 border-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:border-gray-700",
    rose: "bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-500/10 dark:text-rose-300 dark:border-rose-500/30",
  };
  const cls = `inline-flex items-center text-xs font-medium border rounded-full px-2 py-0.5 whitespace-nowrap ${tones[tone] || tones.gray}`;
  if (href) return <Link href={href} className={`${cls} hover:underline`}>{children}</Link>;
  return <span className={cls}>{children}</span>;
}

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
  // El panel de vincular: partes con saldo pendiente del mismo tipo, las obligaciones de la parte
  // elegida, y cuales estan palomeadas. Existe por los lotes adhoc del import PayPal, que se
  // pagaron antes de capturar sus work orders.
  const [vincular, setVincular] = useState(false);
  const [partes, setPartes] = useState([]);
  const [parte, setParte] = useState("");
  const [pendientes, setPendientes] = useState([]);
  const [marcadas, setMarcadas] = useState(new Set());
  // Comisiones tecleadas para obligaciones en $0.00 (por capturar), por id de obligacion.
  const [montos, setMontos] = useState({});
  const [vinculando, setVinculando] = useState(false);
  // Desglosar los ajustes heredados de AppSheet: elegir el juego de notas de debito que suma
  // EXACTO el monto heredado. Solo guarda cuando cuadra al centavo — a medias es como Dist-0073
  // quedo diciendo "not yet itemized $432.96" sin que nadie supiera de que partes era.
  const [desglosar, setDesglosar] = useState(false);
  const [candidatas, setCandidatas] = useState([]);
  const [selNotas, setSelNotas] = useState(new Set());
  const [buscaNota, setBuscaNota] = useState("");
  const [desglosando, setDesglosando] = useState(false);
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

  const kindDe = (type) => (type === "TECHNICIAN" ? "TECH" : type);

  // Lo que falta por desglosar del debito heredado (solo distribuidor).
  const legacyDebit = payment
    ? Math.round((Number(payment.debitNotesTotal || 0) - Number(payment.noteDebitTotal || 0)) * 100) / 100
    : 0;

  async function abrirDesglose() {
    setDesglosar(true);
    setSelNotas(new Set());
    setBuscaNota("");
    try {
      const todas = await getDebitNotes({ entityType: "DISTRIBUTOR" });
      // Solo sueltas (sin lote) y vivas; ordenadas por fecha para leerlas como el estado de cuenta.
      setCandidatas(
        (todas || [])
          .filter((n) => !n.relatedPaymentId && (n.status === "Active" || n.status === "Applied"))
          .sort((a, b) => String(a.issueDate || "").localeCompare(String(b.issueDate || "")))
      );
    } catch (e) {
      setError(e.message);
    }
  }

  const sumaSel = [...selNotas].reduce((s, nid) => {
    const n = candidatas.find((x) => x.id === nid);
    return s + (n ? Number(n.amount || 0) : 0);
  }, 0);
  const cuadra = Math.abs(sumaSel - legacyDebit) < 0.005;

  async function guardarDesglose() {
    if (!cuadra || desglosando) return;
    setDesglosando(true);
    setError("");
    try {
      await itemizeLegacyAdjustments(id, [...selNotas]);
      setMessage(t("itemizeDone"));
      setDesglosar(false);
      load();
    } catch (e) {
      setError(e.message);
    } finally {
      setDesglosando(false);
    }
  }

  async function abrirVincular() {
    setVincular(true);
    try {
      const r = await getPayableParties(kindDe(payment.type));
      const lista = r.parties || [];
      setPartes(lista);
      // La parte del lote, si tiene saldo pendiente; si no, la primera de la lista.
      const propia = lista.find((p) =>
        [payment.company, payment.primaryAgent].filter(Boolean).some((n) => n.toLowerCase() === p.party.toLowerCase())
      );
      const elegida = propia?.party || lista[0]?.party || "";
      setParte(elegida);
      if (elegida) await cargarPendientes(elegida);
    } catch (e) {
      setError(e.message);
    }
  }

  async function cargarPendientes(p) {
    setMarcadas(new Set());
    setMontos({});
    try {
      const r = await getPayablePending(kindDe(payment.type), p);
      setPendientes(r.obligations || []);
    } catch (e) {
      setError(e.message);
    }
  }

  // El monto que cuenta para la suma: el capturado si la obligacion estaba en $0.00, si no el suyo.
  const montoDe = (o) => (Number(o.amount) === 0 && Number(montos[o.id]) > 0 ? Number(montos[o.id]) : Number(o.amount || 0));

  // El flujo real de corregir un labor: se abre la orden en otra pestaña desde el número, se
  // edita, y se regresa aquí. Al recuperar el foco se refrescan los montos SIN tocar lo marcado
  // (las casillas van por id de obligación, que no cambia con la edición).
  useEffect(() => {
    if (!vincular || !parte || !payment) return;
    const alVolver = () => {
      getPayablePending(kindDe(payment.type), parte)
        .then((r) => setPendientes(r.obligations || []))
        .catch(() => {});
    };
    window.addEventListener("focus", alVolver);
    return () => window.removeEventListener("focus", alVolver);
  }, [vincular, parte, payment]);

  function marcar(oid) {
    setMarcadas((prev) => {
      const s = new Set(prev);
      if (s.has(oid)) s.delete(oid); else s.add(oid);
      return s;
    });
  }

  async function vincularMarcadas() {
    setVinculando(true);
    try {
      // Primero se capturan las comisiones tecleadas (obligacion + cabecera de la orden), y ya
      // con el monto puesto se vinculan. Si una captura falla, no se vincula nada a medias.
      for (const o of pendientes) {
        if (marcadas.has(o.id) && Number(o.amount) === 0 && Number(montos[o.id]) > 0) {
          await setObligationAmount(o.id, Number(montos[o.id]));
        }
      }
      const updated = await linkPayoutObligations(id, [...marcadas]);
      setPayment(updated);
      setMessage(t("obligationsLinked", { count: marcadas.size }));
      setVincular(false);
      setMarcadas(new Set());
      load();
    } catch (e) {
      setError(e.message);
    } finally {
      setVinculando(false);
    }
  }

  async function desvincular(payableId, workOrderNo) {
    if (!confirm(t("confirmUnlink", { wo: workOrderNo || "" }))) return;
    try {
      const updated = await unlinkPayoutObligation(id, payableId);
      setPayment(updated);
      load();
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
  // Lo que las notas de débito le CARGARON a este pago de técnico (charge_payout_id). Es la otra
  // cara de partsDeduction: el descuento dice cuánto se le restó, las notas dicen por qué. Cuando
  // no coinciden — Tech-0275: $750.02 en notas y $0 descontado — el desglose debe decirlo, no
  // esconder la línea porque el descuento esté en cero.
  const cargadasAlTecnico = payment.type === "TECHNICIAN"
    ? notes.filter((n) => n.chargedHere && n.noteType === "DEBIT").reduce((a, n) => a + Number(n.amount || 0), 0)
    : 0;
  const descuadrePartes = Math.abs(cargadasAlTecnico - Number(payment.partsDeduction || 0)) > 0.004;

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
              .filter((x) => x.k === baseKey || Math.abs(Number(x.v || 0)) > 0.004 ||
                (x.k === "partsCharged" && cargadasAlTecnico > 0.004))
              .map((x) => (
                <div key={x.k} className="flex justify-between py-1.5 border-b dark:border-gray-800">
                  <span className="text-gray-500 dark:text-gray-400">
                    {x.signo && <span className="inline-block w-3 font-mono">{x.signo === "±" ? (Number(x.v) >= 0 ? "+" : "-") : x.signo}</span>} {t(`term.${x.k}`)}
                    {/* El motivo del bono vive junto al monto: leerlo aparte no dice nada. */}
                    {x.k === "bonus" && payment.bonusReason && (
                      <span className="block text-xs text-gray-400 dark:text-gray-500 ml-3">{payment.bonusReason}</span>
                    )}
                    {/* Junto al descuento de partes, lo que las notas dicen que se le cargó. En
                        ámbar cuando no coinciden: eso es dinero que se le pagó de más. */}
                    {x.k === "partsCharged" && cargadasAlTecnico > 0.004 && (
                      <span className={`block text-xs ml-3 ${descuadrePartes ? "text-amber-600 dark:text-amber-400 font-medium" : "text-gray-400 dark:text-gray-500"}`}>
                        {descuadrePartes
                          ? t("partsNotesGap", { charged: money(cargadasAlTecnico) })
                          : t("partsNotesMatch", { charged: money(cargadasAlTecnico) })}
                      </span>
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

          {/* El desglose del debito heredado: elegir las notas que lo componen. Guarda solo
              cuando la seleccion suma EXACTO — cinco combinaciones distintas daban $432.96 en
              Dist-0073, asi que aqui decide Antonio con el estado de cuenta en la mano. */}
          {payment.type === "DISTRIBUTOR" && legacyDebit > 0.004 && (
            <div className="mt-4 border-t dark:border-gray-800 pt-3">
              {!desglosar ? (
                <button type="button" onClick={abrirDesglose} className="text-sm text-blue-600 dark:text-blue-400 hover:underline">
                  {t("itemizeLegacyBtn", { amount: money(legacyDebit) })}
                </button>
              ) : (
                <div>
                  <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                    <div className="text-sm font-semibold dark:text-gray-100">{t("itemizeLegacyTitle")}</div>
                    <button type="button" onClick={() => setDesglosar(false)} className="text-xs text-gray-500">✕</button>
                  </div>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">{t("itemizeHint")}</p>
                  <input
                    value={buscaNota}
                    onChange={(e) => setBuscaNota(e.target.value)}
                    placeholder={t("itemizeSearch")}
                    className="w-full border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-3 py-2 text-sm mb-2"
                  />
                  <div className="max-h-64 overflow-y-auto border dark:border-gray-800 rounded-lg divide-y dark:divide-gray-800">
                    {candidatas
                      .filter((n) => {
                        if (!buscaNota) return true;
                        const q = buscaNota.toLowerCase();
                        return [n.noteNumber, n.invoiceNumber, n.partNumber, n.entityName]
                          .some((v) => String(v || "").toLowerCase().includes(q));
                      })
                      .map((n) => (
                        <label key={n.id} className="flex items-center gap-2 px-2 py-1.5 text-xs cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800">
                          <input
                            type="checkbox"
                            checked={selNotas.has(n.id)}
                            onChange={() =>
                              setSelNotas((prev) => {
                                const next = new Set(prev);
                                next.has(n.id) ? next.delete(n.id) : next.add(n.id);
                                return next;
                              })
                            }
                          />
                          <span className="font-medium w-20">{n.noteNumber}</span>
                          {/* Fecha en ámbar cuando la nota queda a más de 90 días del pago: así
                              cayó ND-0278 (feb-2026) dentro de Dist-0025 (ene-2025) — el uretano
                              de $46.69 existe en las dos épocas y el monto solo no distingue. */}
                          <span
                            className={`w-20 ${
                              n.issueDate && payment.paymentDate &&
                              Math.abs(new Date(n.issueDate) - new Date(payment.paymentDate)) > 90 * 86400000
                                ? "text-amber-600 dark:text-amber-400 font-medium"
                                : "text-gray-400"
                            }`}
                          >
                            {n.issueDate || "—"}
                          </span>
                          <span className="text-gray-500 flex-1 truncate">{n.entityName} · {n.partNumber || "—"} · {n.invoiceNumber || "—"}</span>
                          <span className="tabular-nums font-medium">{money(n.amount)}</span>
                        </label>
                      ))}
                    {candidatas.length === 0 && <p className="p-3 text-xs text-gray-400">{t("noRecords")}</p>}
                  </div>
                  <div className="flex items-center justify-between mt-2">
                    <span className={`text-sm tabular-nums ${cuadra ? "text-green-700 dark:text-green-400 font-medium" : "text-gray-500 dark:text-gray-400"}`}>
                      {t("itemizeSelected", { sum: money(sumaSel), target: money(legacyDebit) })}
                      {cuadra && " ✓"}
                    </span>
                    <button
                      type="button"
                      onClick={guardarDesglose}
                      disabled={!cuadra || desglosando}
                      className="bg-gray-900 dark:bg-blue-600 text-white rounded-lg px-4 py-1.5 text-sm disabled:opacity-40"
                    >
                      {t("itemizeSave")}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
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
          <div className="flex items-baseline gap-3">
            {perms.edit && (
              <button onClick={() => (vincular ? setVincular(false) : abrirVincular())} className="text-xs text-blue-600">
                {vincular ? tc("cancel") : `+ ${t("linkWorkOrdersAction")}`}
              </button>
            )}
            <span className="text-sm text-gray-500 dark:text-gray-400">
              {t("listedTotal")} {money(sumaObligaciones)}
            </span>
          </div>
        </div>
        {Math.abs(descuadre) > 0.005 && (
          <p className="text-xs text-amber-700 dark:text-amber-500 mb-3">
            {t("obligationsGap", { base: money(baseAmount), listed: money(sumaObligaciones), gap: money(Math.abs(descuadre)) })}
          </p>
        )}

        {/* Elegir de las obligaciones pendientes de la parte cuales pago ESTE lote. La suma
            seleccionada se compara contra el faltante para saber cuando el lote ya quedo. */}
        {vincular && (
          <div className="border border-blue-200 dark:border-blue-900 bg-blue-50/50 dark:bg-blue-950/30 rounded-lg p-3 mb-4">
            <div className="flex flex-wrap items-end gap-3 mb-2">
              <div>
                <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">{t("party")}</label>
                <select value={parte} onChange={(e) => { setParte(e.target.value); cargarPendientes(e.target.value); }}
                  className="border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-3 py-2 text-sm">
                  {partes.map((p) => (
                    <option key={p.party} value={p.party}>{p.party} — {money(p.pendingAmount)}</option>
                  ))}
                </select>
              </div>
              <div className="text-xs text-gray-600 dark:text-gray-300 pb-2">
                {t("selectedSum", {
                  sum: money(pendientes.filter((o) => marcadas.has(o.id)).reduce((a, o) => a + montoDe(o), 0)),
                  gap: money(Math.abs(descuadre)),
                })}
              </div>
              <button onClick={vincularMarcadas} disabled={!marcadas.size || vinculando}
                className="bg-blue-600 hover:bg-blue-700 text-white rounded-lg px-4 py-2 text-sm disabled:opacity-40 ml-auto">
                {t("linkSelected", { count: marcadas.size })}
              </button>
            </div>
            <div className="max-h-72 overflow-y-auto">
              <table className="w-full text-sm">
                <tbody>
                  {pendientes.map((o) => (
                    <tr key={o.id} onClick={() => marcar(o.id)}
                      className="border-b last:border-0 dark:border-gray-800 cursor-pointer hover:bg-blue-50 dark:hover:bg-gray-800/60">
                      <td className="p-1.5 w-8"><input type="checkbox" readOnly checked={marcadas.has(o.id)} /></td>
                      {/* El número abre la orden en otra pestaña — para corregir el labor ahí
                          mismo sin perder lo ya marcado. stopPropagation: el clic en la fila
                          tilda la casilla, y abrir no es tildar. */}
                      <td className="p-1.5 font-medium">
                        {o.workOrderId ? (
                          <Link href={`/dashboard/workorders/${o.workOrderId}`} target="_blank"
                            onClick={(e) => e.stopPropagation()}
                            className="text-blue-600 dark:text-blue-400 hover:underline">
                            {o.workOrderNo}
                          </Link>
                        ) : (
                          o.workOrderNo || "—"
                        )}
                      </td>
                      <td className="p-1.5">{o.party || "—"}</td>
                      <td className="p-1.5 text-gray-500 dark:text-gray-400">{o.customerName || "—"}</td>
                      {/* La deuda de distribuidor es por parte: sin esto, dos piezas de la misma
                          orden se ven como fila repetida. */}
                      {pendientes.some((x) => x.partNumber) && (
                        <td className="p-1.5">
                          <span className="font-mono text-xs">{o.partNumber || "—"}</span>
                          {o.partDescription && <span className="block text-xs text-gray-400 dark:text-gray-500 max-w-[180px] truncate">{o.partDescription}</span>}
                        </td>
                      )}
                      <td className="p-1.5">{o.workDate || "—"}</td>
                      <td className="p-1.5 text-right tabular-nums">
                        {/* $0.00 es comision POR CAPTURAR: se teclea aqui y al vincular se
                            escribe en la obligacion y en la cabecera de la orden. */}
                        {Number(o.amount) === 0 ? (
                          <input type="number" step="0.01" min="0" placeholder="0.00"
                            value={montos[o.id] ?? ""} title={t("commissionToSet")}
                            onClick={(e) => e.stopPropagation()}
                            onChange={(e) => setMontos((m) => ({ ...m, [o.id]: e.target.value }))}
                            className="w-20 border border-amber-300 dark:border-amber-700 dark:bg-gray-800 dark:text-gray-100 rounded px-2 py-1 text-right text-sm" />
                        ) : (
                          money(o.amount)
                        )}
                      </td>
                    </tr>
                  ))}
                  {pendientes.length === 0 && (
                    <tr><td className="p-2 text-gray-500" colSpan={6}>{t("noPendingObligations")}</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
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
              {perms.edit && <th className="p-2"></th>}
            </tr>
          </thead>
          <tbody>
            {obligations.map((o) => (
              <tr key={o.id} className="border-b last:border-0 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800/60 transition-colors">
                <td className="p-2 font-medium">
                  {o.work_order_id ? (
                    <Link href={`/dashboard/workorders/${o.work_order_id}`} target="_blank"
                      className="text-blue-600 dark:text-blue-400 hover:underline">
                      {o.work_order_no}
                    </Link>
                  ) : (
                    o.work_order_no || "—"
                  )}
                </td>
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
                {perms.edit && (
                  <td className="p-2 text-right">
                    <button onClick={() => desvincular(o.id, o.work_order_no)} title={t("unlinkWorkOrder")}
                      className="text-red-500 text-xs">✕</button>
                  </td>
                )}
              </tr>
            ))}
            {obligations.length === 0 && <tr><td className="p-2 text-gray-500" colSpan={(hayParte ? 6 : 5) + (perms.edit ? 1 : 0)}>{t("noRecords")}</td></tr>}
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
        <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left border-b dark:border-gray-800 text-xs text-gray-400 uppercase">
              <th className="p-2">{tn("noteNo")}</th>
              <th className="p-2">{t("type")}</th>
              <th className="p-2">{tn("part")}</th>
              <th className="p-2">{tn("distributorInvoiceShort")}</th>
              <th className="p-2">{tn("relColumn")}</th>
              <th className="p-2 text-right">{tc("amount")}</th>
              <th className="p-2">{t("status")}</th>
              <th className="p-2"></th>
            </tr>
          </thead>
          <tbody>
            {notes.map((n) => (
              <tr key={n.id} className="border-b last:border-0 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800/60 transition-colors">
                <td className="p-2 font-medium">{n.noteNumber}</td>
                <td className="p-2">
                  <RelChip tone={n.noteType === "CREDIT" ? "green" : "rose"}>
                    {n.noteType === "CREDIT" ? tn("typeCredit") : tn("typeDebit")}
                  </RelChip>
                </td>
                <td className="p-2">
                  <span className="font-mono text-xs">{n.partNumber || "—"}</span>
                  {n.partDescription && <span className="block text-xs text-gray-400 dark:text-gray-500 max-w-[200px] truncate">{n.partDescription}</span>}
                </td>
                <td className="p-2 text-xs text-gray-500 dark:text-gray-400">{n.invoiceNumber || "—"}</td>
                <td className="p-2">
                  {/* El otro extremo de la nota, visto desde ESTE pago: en un credito, la parte
                      devuelta de la que viene; en un cargo al tecnico visto desde su pago, el
                      pago del distribuidor de origen; en un debito visto desde su pago, el
                      destino de la parte — el mismo chip que en el dashboard de notas. */}
                  {n.noteType === "CREDIT" ? (
                    n.fromDebit ? (
                      <RelChip tone="green" href={`/dashboard/payments/debit-notes/${n.fromDebit.id}`}>{tn("relComesFrom")}: {n.fromDebit.noteNumber}</RelChip>
                    ) : (
                      <span className="text-gray-400">—</span>
                    )
                  ) : n.chargedHere ? (
                    n.relatedPaymentNumber ? (
                      <RelChip tone="blue" href={`/dashboard/payments/${n.relatedPaymentId}`}>{tn("relComesFrom")}: {n.relatedPaymentNumber}</RelChip>
                    ) : (
                      <span className="text-gray-400">—</span>
                    )
                  ) : n.resolution === "TECH" ? (
                    n.chargePayoutId ? (
                      <RelChip tone="purple" href={`/dashboard/payments/${n.chargePayoutId}`}>{n.chargePaymentNumber || n.technician}</RelChip>
                    ) : (
                      <RelChip tone="amber">{n.technician} · {tn("relPending")}</RelChip>
                    )
                  ) : n.resolution === "RETURNED" ? (
                    n.resolvedBy ? (
                      <RelChip tone="green" href={`/dashboard/payments/credit-notes/${n.resolvedBy.id}`}>{n.resolvedBy.noteNumber}</RelChip>
                    ) : (
                      <RelChip tone="amber">{tn("relReturnedWaiting")}</RelChip>
                    )
                  ) : n.resolution === "INSTALLED" ? (
                    <RelChip tone="blue">{tn("resolutionInstalled")}{n.resolutionWorkOrderNo ? ` · ${n.resolutionWorkOrderNo}` : ""}</RelChip>
                  ) : n.resolution === "LOSS" ? (
                    <RelChip tone="gray">{tn("resolutionLoss")}</RelChip>
                  ) : (
                    <RelChip tone="amber">{tn("relOpenChip")}</RelChip>
                  )}
                </td>
                {/* Una parte que este lote le cobra al tecnico BAJA lo que se le paga, al reves
                    que un debito del distribuidor, que sube lo que le pagamos a el. Mismo tipo de
                    nota, signo opuesto, segun a quien se le este cobrando. */}
                <td className={`p-2 text-right font-medium tabular-nums ${n.noteType === "CREDIT" || n.chargedHere ? "text-green-700 dark:text-green-400" : "text-red-700 dark:text-red-400"}`}>
                  {n.noteType === "CREDIT" || n.chargedHere ? "− " : "+ "}{money(n.amount)}
                </td>
                <td className="p-2">
                  <span className={`text-xs font-medium rounded-full px-2 py-1 ${NOTE_STATUS_COLORS[n.status] || "bg-gray-100 text-gray-600"}`}>{tn(`statuses.${n.status}`)}</span>
                </td>
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
            {notes.length === 0 && <tr><td className="p-2 text-gray-500" colSpan={8}>{tn("noRecords")}</td></tr>}
          </tbody>
        </table>
        </div>
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
