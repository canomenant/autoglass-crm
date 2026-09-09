"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { getPaymentMethods, updateWorkOrder, getWorkOrderPaymentLink, markWorkOrderUncollectible, clearWorkOrderUncollectible } from "@/lib/api";
import { UNCOLLECTIBLE_REASONS } from "@/lib/workOrderStatuses";
import CurrencyInput from "./CurrencyInput";
import SearchableSelect from "./SearchableSelect";

function money(n) {
  return `$${Number(n || 0).toFixed(2)}`;
}

export default function WorkOrderPaymentPanel({ workOrder, quote, onChange }) {
  const t = useTranslations("workOrders");
  const tc = useTranslations("common");
  // "Upsell" ya está traducido en el resumen de la cotización; es el mismo concepto y el mismo
  // importe, así que se reutiliza esa clave en vez de crear una segunda que pudiera divergir.
  const tq = useTranslations("quoteForm");
  const [paymentMethods, setPaymentMethods] = useState([]);
  const [form, setForm] = useState({
    method: workOrder.payment?.method || "",
    amount: workOrder.payment?.amount || 0,
    paid: !!workOrder.payment?.paid,
    cashComeback: workOrder.payment?.cashComeback || 0,
    authorizationId: workOrder.payment?.authorizationId || "",
    splits: Array.isArray(workOrder.payment?.splits) ? workOrder.payment.splits : [],
  });
  // El efectivo que cobra el técnico se le descuenta de su pago porque ya lo tiene. Cuando no se lo
  // quedó (lo entregó, o su labor se saldó de otra forma) esta casilla lo exime, sin tener que
  // falsear el método de cobro — que es lo que se hacía antes.
  const [techKeptCash, setTechKeptCash] = useState(workOrder.techKeptCash !== false);
  const [techCashNote, setTechCashNote] = useState(workOrder.techCashNote || "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [copyingLink, setCopyingLink] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);
  // Un cobro puede venir partido (parte tarjeta, parte efectivo). El pago de la orden es UNO —
  // el agregado — y capturar el segundo tender tecleándolo encima BORRABA el primero (Wo-4232:
  // $120 cash + $300 tarjeta quedó como $300 y saldo fantasma de $120). Esto suma en vez de
  // reemplazar; el historial de abajo guarda la foto de cada guardado.
  const [agregando, setAgregando] = useState(false);
  const [extra, setExtra] = useState({ method: "", amount: 0, authorizationId: "" });
  // REPARTIR es lo contrario de AGREGAR, y confundirlos cuesta dinero. Agregar suma un segundo
  // cobro al total; repartir deja el total clavado y sólo dice cuánto fue de cada método — el caso
  // de un cobro que se capturó entero con un método cuando en realidad venía partido (Wo-3844:
  // $308.51 todo como tarjeta, siendo $220 efectivo). Hacerlo con "agregar" exigía acordarse de
  // bajar primero el monto principal; si no, el total se iba a $528.51 sin avisar (Antonio,
  // 9-sep-2026).
  const [repartiendo, setRepartiendo] = useState(false);
  const [reparto, setReparto] = useState({ method: "", amount: 0 });
  // Dar por perdido el cobro de un trabajo ya entregado. Pide motivo, y si la orden trae un cobro
  // registrado obliga a confirmar que ese registro estaba mal antes de limpiarlo.
  const [writeOff, setWriteOff] = useState(null); // null = cerrado; {reason, note, confirm}
  const uncollectible = !!workOrder.uncollectibleAt;

  useEffect(() => {
    getPaymentMethods().then(setPaymentMethods).catch(() => {});
  }, []);

  useEffect(() => {
    setForm({
      method: workOrder.payment?.method || "",
      amount: workOrder.payment?.amount || 0,
      paid: !!workOrder.payment?.paid,
      cashComeback: workOrder.payment?.cashComeback || 0,
      authorizationId: workOrder.payment?.authorizationId || "",
      // Faltaba: al recargar la orden el desglose se perdía del panel -quedaba en undefined- y el
      // cobro partido volvía a verse como un importe suelto, aunque en la base estuviera bien.
      splits: Array.isArray(workOrder.payment?.splits) ? workOrder.payment.splits : [],
    });
  }, [workOrder.id, workOrder.payment?.amount, workOrder.payment?.paid, workOrder.payment?.method, workOrder.payment?.cashComeback, workOrder.payment?.authorizationId, workOrder.payment?.splits]);

  // Lo cobrado es el importe menos el cambio devuelto: entregar $600 por un trabajo de $500 y
  // recibir $100 de vuelto no es cobrar de más.
  //
  // Y cobrar de más no es un saldo negativo, es un upsell — el precio se redondeó hacia arriba al
  // cobrar. Antes esto restaba a secas y pintaba "Remaining Balance: $-97.73" en verde, que no dice
  // nada: ni que sobraba dinero ni qué se iba a hacer con él. Se calcula sobre form, no sobre lo
  // guardado, así que la cifra se mueve mientras se teclea.
  // Contra el precio final de la COTIZACIÓN, que es la cifra con la que el servidor decide si hay
  // upsell, y no contra work_orders.total_sale. Las dos deberían coincidir -total_sale es una copia
  // que sincroniza quotes.store- pero en 3.555 de las 3.664 órdenes con pago no coinciden: son del
  // import, y esa copia se quedó con el total sin el upsell que la cotización sí tiene anotado.
  // Comparando contra la copia vieja, esta cifra prometería un upsell que el servidor no va a
  // aplicar. Sin cotización (órdenes históricas sueltas) no hay nada mejor que su propio total.
  const price = quote?.totals?.finalSalePrice ?? Number(workOrder.totalSale || 0);
  const collected = Number(form.amount || 0) - Number(form.cashComeback || 0);
  const excess = collected - price;
  // Orden marcada como pagada (Antonio, 7-sep-2026): el precio final es lo cobrado y la diferencia
  // es upsell, positivo o negativo; no hay saldo. Sin marcar, un cobro corto sí es saldo pendiente.
  const cerrada = form.paid && price > 0 && collected > 0;
  const remainingBalance = cerrada ? 0 : Math.max(0, -excess);
  // Sin precio calculado no se anota nada (ver quotesStore.recordOverpaymentAsUpsell), así que
  // tampoco se anuncia: la cifra en verde es una promesa y tiene que cumplirse siempre.
  const upsell = price > 0 ? (cerrada ? excess : Math.max(0, excess)) : 0;
  const paymentMethodOptions = useMemo(() => paymentMethods.map((m) => ({ value: m.name, label: m.name })), [paymentMethods]);

  function set(field, value) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  // Funde el pago adicional en el agregado: monto sumado, métodos combinados ("Credit Card +
  // Cash") y autorizaciones concatenadas. No guarda — el usuario ve el total nuevo en el panel
  // y confirma con Save Changes, el mismo camino de siempre.
  function sumarPago() {
    const monto = Number(extra.amount || 0);
    if (!(monto > 0)) return;
    setForm((prev) => ({
      ...prev,
      // Cada cobro queda por separado (tarjeta $158.42, efectivo $280): el efectivo del técnico
      // se calcula solo de la parte en cash (Antonio, 6-sep-2026, Wo-2152).
      splits: [
        ...(prev.splits?.length ? prev.splits : (Number(prev.amount) > 0 ? [{ method: prev.method, amount: Number(prev.amount), authorizationId: prev.authorizationId || "" }] : [])),
        { method: extra.method, amount: monto, authorizationId: extra.authorizationId || "" },
      ],
      amount: Math.round((Number(prev.amount || 0) + monto) * 100) / 100,
      method: !prev.method ? extra.method
        : extra.method && extra.method !== prev.method ? `${prev.method} + ${extra.method}` : prev.method,
      authorizationId: [prev.authorizationId, extra.authorizationId].filter(Boolean).join(" / "),
    }));
    setExtra({ method: "", amount: 0, authorizationId: "" });
    setAgregando(false);
  }

  // Parte el cobro que ya está capturado sin tocar el total: lo que se indique aquí se separa con
  // su método y el RESTO se queda con el método original. No guarda — se ve el desglose y se
  // confirma con Save Changes, como todo lo demás del panel.
  const restoReparto = Math.round((Number(form.amount || 0) - Number(reparto.amount || 0)) * 100) / 100;
  const repartoValido = Number(reparto.amount) > 0 && restoReparto > 0 && !!reparto.method && reparto.method !== form.method;

  function repartirPago() {
    if (!repartoValido) return;
    setForm((prev) => ({
      ...prev,
      splits: [
        { method: prev.method, amount: restoReparto, authorizationId: prev.authorizationId || "" },
        { method: reparto.method, amount: Number(reparto.amount), authorizationId: "" },
      ],
      // El total NO se toca: es la diferencia con "agregar otro pago".
      method: `${prev.method} + ${reparto.method}`,
    }));
    setReparto({ method: "", amount: 0 });
    setRepartiendo(false);
  }

  async function handleSave() {
    setSaving(true);
    setError("");
    try {
      const updated = await updateWorkOrder(workOrder.id, { payment: form, techKeptCash, techCashNote });
      onChange(updated);
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleCopyPaymentLink() {
    setCopyingLink(true);
    setError("");
    setLinkCopied(false);
    try {
      const { token } = await getWorkOrderPaymentLink(workOrder.id);
      const url = `${window.location.origin}/pay/${token}`;
      await navigator.clipboard.writeText(url);
      setLinkCopied(true);
    } catch (e) {
      setError(e.message);
    } finally {
      setCopyingLink(false);
    }
  }

  async function handleWriteOff() {
    setSaving(true);
    setError("");
    try {
      const updated = await markWorkOrderUncollectible(workOrder.id, {
        reason: writeOff.reason,
        note: writeOff.note,
        clearRecordedPayment: true,
      });
      onChange(updated);
      setWriteOff(null);
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleReopenCollection() {
    setSaving(true);
    setError("");
    try {
      onChange(await clearWorkOrderUncollectible(workOrder.id));
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  const history = [...(workOrder.paymentHistory || [])].reverse();
  const recorded = Number(workOrder.payment?.amount || 0);

  return (
    <section className="bg-white dark:bg-gray-900 dark:border dark:border-gray-800 rounded-xl shadow-sm p-4">
      <h2 className="font-semibold mb-3">{t("paymentInfo")}</h2>

      {error && <p className="text-red-600 dark:text-red-400 text-sm mb-3">{error}</p>}

      {/* El trabajo se entregó y el dinero no llegó: se ve arriba de todo para que nadie siga
          persiguiendo un cobro que ya se dio por perdido, ni lo cuente como pendiente. */}
      {uncollectible && (
        <div className="mb-4 rounded-lg border border-amber-300 dark:border-amber-500/40 bg-amber-50 dark:bg-amber-500/10 p-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-amber-800 dark:text-amber-300">{t("uncollectibleBadge")}</p>
              <p className="text-xs text-amber-700 dark:text-amber-400 mt-0.5">
                {t(`uncollectibleReasons.${workOrder.uncollectibleReason}`)}
                {" · "}{new Date(workOrder.uncollectibleAt).toLocaleDateString()}
                {workOrder.uncollectibleBy ? ` · ${workOrder.uncollectibleBy}` : ""}
              </p>
              {workOrder.uncollectibleNote && <p className="text-xs text-amber-700 dark:text-amber-400 mt-1">{workOrder.uncollectibleNote}</p>}
            </div>
            <button type="button" onClick={handleReopenCollection} disabled={saving}
              className="border border-amber-300 dark:border-amber-500/40 text-amber-800 dark:text-amber-300 rounded-lg px-3 py-1.5 text-xs hover:bg-amber-100 dark:hover:bg-amber-500/20 disabled:opacity-40">
              {t("reopenCollection")}
            </button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="block text-sm mb-1 text-gray-600 dark:text-gray-300">{t("paymentMethod")}</label>
          <SearchableSelect
            value={form.method}
            onChange={(v) => set("method", v)}
            options={paymentMethodOptions}
            placeholder={t("selectPaymentMethod")}
          />
        </div>
        <div>
          <label className="block text-sm mb-1 text-gray-600 dark:text-gray-300">{t("amountPaid")}</label>
          <CurrencyInput value={form.amount} onChange={(v) => set("amount", v)} />
        </div>
        <div>
          <label className="block text-sm mb-1 text-gray-600 dark:text-gray-300">{t("cashComeback")}</label>
          <CurrencyInput value={form.cashComeback} onChange={(v) => set("cashComeback", v)} />
        </div>
        <div>
          <label className="block text-sm mb-1 text-gray-600 dark:text-gray-300">{t("authorizationId")}</label>
          <input
            value={form.authorizationId}
            onChange={(e) => set("authorizationId", e.target.value)}
            className="w-full border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-shadow"
          />
        </div>
      </div>

      {form.splits?.length > 0 && (
        <div className="mt-3 text-sm">
          <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">{t("splitPayments")}</div>
          <ul className="space-y-1">
            {form.splits.map((s, i) => (
              <li key={i} className="flex items-center justify-between rounded-lg border border-gray-100 dark:border-gray-800 px-3 py-1.5">
                <span className={/cash/i.test(s.method || "") && !/cash ?app/i.test(s.method || "") ? "font-semibold text-amber-700 dark:text-amber-300" : ""}>{s.method || "—"}{s.authorizationId ? ` · ${s.authorizationId}` : ""}</span>
                <span className="tabular-nums">{money(Number(s.amount || 0))}</span>
              </li>
            ))}
          </ul>
          <button type="button" onClick={() => set("splits", [])} className="mt-1 text-xs text-gray-500 hover:text-red-600">{t("removeSplits")}</button>
        </div>
      )}

      {/* Repartir un cobro YA capturado: el total no se mueve, sólo se dice cuánto fue de cada
          método. Sólo aparece si hay un cobro sin repartir todavía. */}
      {!agregando && Number(form.amount) > 0 && !form.splits?.length && form.method && (
        <div className="mt-3">
          {!repartiendo ? (
            <button onClick={() => setRepartiendo(true)} className="text-amber-700 dark:text-amber-400 text-sm">
              {t("splitPayment")}
            </button>
          ) : (
            <div className="border border-amber-200 dark:border-amber-900 bg-amber-50/60 dark:bg-amber-950/20 rounded-lg p-3">
              <p className="text-xs text-gray-600 dark:text-gray-300 mb-2">
                {t("splitPaymentHint", { amount: money(Number(form.amount)), method: form.method })}
              </p>
              <div className="flex flex-wrap items-end gap-3">
                <div className="min-w-[180px]">
                  <label className="block text-xs mb-1 text-gray-500 dark:text-gray-400">{t("paymentMethod")}</label>
                  <SearchableSelect
                    value={reparto.method} onChange={(v) => setReparto((x) => ({ ...x, method: v }))}
                    options={paymentMethodOptions} placeholder={t("selectPaymentMethod")}
                  />
                </div>
                <div className="w-36">
                  <label className="block text-xs mb-1 text-gray-500 dark:text-gray-400">{tc("amount")}</label>
                  <CurrencyInput value={reparto.amount} onChange={(v) => setReparto((x) => ({ ...x, amount: v }))} />
                </div>
                <button type="button" onClick={repartirPago} disabled={!repartoValido}
                  className="bg-amber-600 hover:bg-amber-700 text-white rounded-lg px-4 py-2 text-sm disabled:opacity-40">
                  {t("applySplit")}
                </button>
                <button type="button" onClick={() => { setRepartiendo(false); setReparto({ method: "", amount: 0 }); }}
                  className="text-sm text-gray-500 hover:text-gray-700 dark:hover:text-gray-300">
                  {tc("cancel")}
                </button>
              </div>
              {/* Lo que va a quedar, antes de aplicarlo: sin esto hay que confiar en la resta. */}
              {Number(reparto.amount) > 0 && (
                <p className={`mt-2 text-xs ${restoReparto > 0 ? "text-gray-600 dark:text-gray-300" : "text-red-600 dark:text-red-400"}`}>
                  {restoReparto > 0
                    ? t("splitPreview", { rest: money(restoReparto), restMethod: form.method, part: money(Number(reparto.amount)), partMethod: reparto.method || "—" })
                    : t("splitTooBig", { amount: money(Number(form.amount)) })}
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {/* Cobro partido en varios métodos: se SUMA al total en vez de teclear encima (que era
          como se perdía el primer pago — Wo-4232). */}
      <div className="mt-3">
        {!repartiendo && !agregando ? (
          <button onClick={() => setAgregando(true)} className="text-blue-600 dark:text-blue-400 text-sm">
            + {t("addPayment")}
          </button>
        ) : agregando ? (
          <div className="border border-blue-200 dark:border-blue-900 bg-blue-50/50 dark:bg-blue-950/30 rounded-lg p-3">
            <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">{t("addPaymentHint")}</p>
            <div className="flex flex-wrap items-end gap-3">
              <div className="min-w-[180px]">
                <label className="block text-xs mb-1 text-gray-500 dark:text-gray-400">{t("paymentMethod")}</label>
                <SearchableSelect value={extra.method} onChange={(v) => setExtra((x) => ({ ...x, method: v }))}
                  options={paymentMethodOptions} placeholder={t("selectPaymentMethod")} />
              </div>
              <div className="w-32">
                <label className="block text-xs mb-1 text-gray-500 dark:text-gray-400">{tc("amount")}</label>
                <CurrencyInput value={extra.amount} onChange={(v) => setExtra((x) => ({ ...x, amount: v }))} />
              </div>
              <div className="flex-1 min-w-[140px]">
                <label className="block text-xs mb-1 text-gray-500 dark:text-gray-400">{t("authorizationId")}</label>
                <input value={extra.authorizationId} onChange={(e) => setExtra((x) => ({ ...x, authorizationId: e.target.value }))}
                  className="w-full border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-3 py-2 text-sm" />
              </div>
              <button onClick={sumarPago} disabled={!(Number(extra.amount) > 0)}
                className="bg-blue-600 hover:bg-blue-700 text-white rounded-lg px-4 py-2 text-sm disabled:opacity-40">
                {t("addToTotal")}
              </button>
              <button onClick={() => { setAgregando(false); setExtra({ method: "", amount: 0, authorizationId: "" }); }}
                className="text-gray-500 text-sm px-2">{tc("cancel")}</button>
            </div>
          </div>
        ) : null}
      </div>

      {/* Solo aparece cuando el cobro lleva efectivo: es la única situación donde el técnico podría
          quedarse el dinero. "Cash App" no cuenta — ese pago entra a la cuenta de la compañía. */}
      {/cash/i.test(form.method || "") && !/cash ?app/i.test(form.method || "") && (
        <div className="mt-4 pt-4 border-t dark:border-gray-800">
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" className="mt-0.5" checked={!techKeptCash} onChange={(e) => setTechKeptCash(!e.target.checked)} />
            <span>
              {t("techDidNotKeepCash")}
              <span className="block text-xs text-gray-500 dark:text-gray-400 mt-0.5">{t("techDidNotKeepCashHint")}</span>
            </span>
          </label>
          {!techKeptCash && (
            <input
              value={techCashNote}
              onChange={(e) => setTechCashNote(e.target.value)}
              placeholder={t("techCashNotePlaceholder")}
              className="w-full mt-2 border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-3 py-2 text-sm"
            />
          )}
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3 mt-4 pt-4 border-t dark:border-gray-800">
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={form.paid} onChange={(e) => set("paid", e.target.checked)} />
          {t("paid")}
        </label>
        {upsell !== 0 ? (
          <div className="text-right">
            <div className={`text-sm font-semibold ${upsell > 0 ? "text-green-600 dark:text-green-400" : "text-amber-600 dark:text-amber-400"}`}>
              {tq("upsell")}: {upsell < 0 ? "-" : ""}{money(Math.abs(upsell))}
            </div>
            <div className="text-xs text-gray-500 dark:text-gray-400">{upsell > 0 ? t("upsellWillBeRecorded") : t("upsellNegativeHint")}</div>
          </div>
        ) : (
          <div className={`text-sm font-semibold ${remainingBalance > 0 ? "text-red-600 dark:text-red-400" : "text-green-600 dark:text-green-400"}`}>
            {t("remainingBalance")}: {money(remainingBalance)}
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3 mt-4">
        <button onClick={handleSave} disabled={saving} className="bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors px-6 py-2 disabled:opacity-40">
          {tc("saveChanges")}
        </button>
        {remainingBalance > 0 && (
          <button onClick={handleCopyPaymentLink} disabled={copyingLink} className="border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 rounded-lg transition-colors px-4 py-2 text-sm disabled:opacity-40">
            {linkCopied ? t("paymentLinkCopied") : t("copyPaymentLink")}
          </button>
        )}
        {!uncollectible && !writeOff && (
          <button type="button" onClick={() => setWriteOff({ reason: "", note: "" })}
            className="border border-amber-200 dark:border-amber-500/40 text-amber-700 dark:text-amber-300 rounded-lg px-4 py-2 text-sm hover:bg-amber-50 dark:hover:bg-amber-500/10 transition-colors">
            {t("markUncollectible")}
          </button>
        )}
      </div>

      {writeOff && (
        <div className="mt-4 rounded-lg border-2 border-amber-300 dark:border-amber-500/40 bg-amber-50 dark:bg-amber-500/10 p-3">
          <p className="text-sm font-semibold text-amber-800 dark:text-amber-300">{t("markUncollectible")}</p>
          <p className="text-xs text-amber-700 dark:text-amber-400 mt-0.5 mb-3">{t("uncollectibleHint")}</p>

          <label className="block text-xs font-medium text-amber-800 dark:text-amber-300 mb-1">
            {t("uncollectibleReason")} <span className="text-red-500">*</span>
          </label>
          <select value={writeOff.reason} onChange={(e) => setWriteOff((x) => ({ ...x, reason: e.target.value }))}
            className="w-full border border-amber-200 dark:border-amber-500/40 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-3 py-2 text-sm">
            <option value="">{t("selectUncollectibleReason")}</option>
            {UNCOLLECTIBLE_REASONS.map((x) => <option key={x} value={x}>{t(`uncollectibleReasons.${x}`)}</option>)}
          </select>

          <label className="block text-xs font-medium text-amber-800 dark:text-amber-300 mt-3 mb-1">{t("uncollectibleNote")}</label>
          <input value={writeOff.note} onChange={(e) => setWriteOff((x) => ({ ...x, note: e.target.value }))}
            className="w-full border border-amber-200 dark:border-amber-500/40 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-3 py-2 text-sm" />

          {/* Si la orden trae un cobro registrado, marcarla incobrable lo borra. Se dice cuánto. */}
          {recorded > 0 && (
            <p className="text-xs text-amber-800 dark:text-amber-300 mt-3">{t("uncollectibleClearsPayment", { amount: money(recorded) })}</p>
          )}

          <div className="flex gap-2 mt-3">
            <button type="button" onClick={handleWriteOff} disabled={!writeOff.reason || saving}
              className="bg-amber-600 hover:bg-amber-700 text-white font-semibold rounded-lg px-4 py-2 text-sm disabled:opacity-40">
              {saving ? tc("saving") : t("confirmUncollectible")}
            </button>
            <button type="button" onClick={() => setWriteOff(null)} disabled={saving}
              className="border border-gray-300 dark:border-gray-600 dark:text-gray-100 rounded-lg px-4 py-2 text-sm disabled:opacity-40">
              {tc("cancel")}
            </button>
          </div>
        </div>
      )}

      {history.length > 0 && (
        <div className="mt-6 pt-4 border-t dark:border-gray-800">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-2">{t("paymentHistory")}</h3>
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left border-b dark:border-gray-800 text-gray-400">
                <th className="py-1 pr-2">{tc("date")}</th>
                <th className="py-1 pr-2">{t("paymentMethod")}</th>
                <th className="py-1 pr-2">{tc("amount")}</th>
                <th className="py-1 pr-2">{t("paid")}</th>
                <th className="py-1">{t("performedBy")}</th>
              </tr>
            </thead>
            <tbody>
              {history.map((h, i) => (
                <tr key={i} className="border-b last:border-0 dark:border-gray-800">
                  <td className="py-1 pr-2">{new Date(h.timestamp).toLocaleString()}</td>
                  <td className="py-1 pr-2">{h.method || "—"}</td>
                  <td className="py-1 pr-2">{money(h.amount)}</td>
                  <td className="py-1 pr-2">{h.paid ? "✓" : "—"}</td>
                  <td className="py-1">{h.actor}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
