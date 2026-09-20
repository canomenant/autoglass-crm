"use client";

// Panel "Sell lead" en la orden (Antonio, 19-sep-2026): vender el dato a técnicos terceros cuando
// el trabajo no le conviene a Reyes. Precio sugerido por escalera, elegir compradores, vista
// previa del adelanto, y estado de la venta (ofrecido / pagado por X / entregado).

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { getLeadSuggestion, sellLead, resendLeadOffers, markLeadPaid, cancelLeadSale } from "@/lib/api";

function money(n) {
  return `$${Number(n || 0).toFixed(2)}`;
}

const TONO = { offered: "bg-amber-100 text-amber-700", paid: "bg-blue-100 text-blue-700", delivered: "bg-green-100 text-green-700", expired: "bg-gray-200 text-gray-600", cancelled: "bg-gray-200 text-gray-600" };

export default function LeadSalePanel({ workOrder, onChange }) {
  const t = useTranslations("leads");
  const [info, setInfo] = useState(null);
  const [error, setError] = useState("");
  const [open, setOpen] = useState(false);
  const [price, setPrice] = useState("");
  const [picked, setPicked] = useState([]);
  const [busy, setBusy] = useState(false);

  function load() {
    getLeadSuggestion(workOrder.id).then((r) => { setInfo(r); setPrice(String(r.price)); }).catch((e) => setError(e.message));
  }
  useEffect(() => { if (workOrder?.id) load(); }, [workOrder?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const activa = (info?.sales || []).find((s) => ["offered", "paid", "delivered"].includes(s.status));
  const historial = (info?.sales || []).filter((s) => s !== activa);

  async function vender() {
    if (!picked.length) return;
    if (!confirm(t("confirmSell", { n: picked.length, price: money(price) }))) return;
    setBusy(true); setError("");
    try {
      await sellLead({ workOrderId: workOrder.id, buyerIds: picked, price: Number(price) });
      setOpen(false); setPicked([]);
      load(); onChange?.();
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }
  async function reenviar() {
    setBusy(true); setError("");
    try { await resendLeadOffers(activa.id); load(); } catch (e) { setError(e.message); } finally { setBusy(false); }
  }
  async function pagadoManual(buyerId) {
    const via = prompt(t("markPaidPrompt"), "Zelle");
    if (via === null) return;
    setBusy(true); setError("");
    try { await markLeadPaid(activa.id, { buyerId, via }); load(); } catch (e) { setError(e.message); } finally { setBusy(false); }
  }
  async function cancelar() {
    const reopen = confirm(t("confirmCancel"));
    setBusy(true); setError("");
    try { await cancelLeadSale(activa.id, { reopenWorkOrder: reopen }); load(); onChange?.(); } catch (e) { setError(e.message); } finally { setBusy(false); }
  }

  const teaserPreview = info ? `${t("teaserPreviewPrefix")} ${info.teaser.area}: ${info.teaser.vehicle}, ${info.teaser.job}. ${info.teaser.when}${info.teaser.customerBudget ? ` Customer budget ≈ ${money(info.teaser.customerBudget)}.` : ""} $${Number(price || 0).toFixed(0)} — pay to get the customer's name and phone: [link]` : "";

  return (
    <section className="bg-white dark:bg-gray-900 dark:border dark:border-gray-800 rounded-xl shadow-sm p-4">
      <div className="flex items-center justify-between gap-2 mb-2">
        <h2 className="font-semibold">{t("panelTitle")}</h2>
        {!activa && info && !open && (
          <button type="button" onClick={() => setOpen(true)} className="border border-amber-300 text-amber-700 dark:text-amber-300 rounded-lg px-3 py-2 text-sm hover:bg-amber-50 dark:hover:bg-amber-500/10">
            {t("sellButton")}
          </button>
        )}
      </div>
      {error && <p className="text-red-600 text-sm mb-2">{error}</p>}
      {!info && !error && <p className="text-xs text-gray-400">…</p>}

      {activa && (
        <div className="text-sm space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`text-xs font-semibold rounded-full px-2 py-1 ${TONO[activa.status]}`}>{t(`status.${activa.status}`)}</span>
            <span className="font-medium">{money(activa.price)}</span>
            {activa.buyerName && <span>· {t("boughtBy", { name: activa.buyerName })}</span>}
            <span className="text-xs text-gray-400">· {new Date(activa.createdAt).toLocaleString()}</span>
          </div>
          <ul className="text-xs space-y-1">
            {activa.offers.map((o) => (
              <li key={o.token} className="flex flex-wrap items-center gap-2">
                <span className={`rounded-full px-2 py-0.5 ${o.status === "paid" ? "bg-green-100 text-green-700" : o.status === "lost" ? "bg-gray-100 text-gray-500 line-through" : "bg-amber-50 text-amber-700"}`}>{o.buyerName}</span>
                <span className="text-gray-400">
                  {o.sendResult?.sms ? (o.sendResult.sms.ok ? "📲 SMS ✓" : `📲 ✗ ${o.sendResult.sms.error}`) : ""} {o.sendResult?.email ? (o.sendResult.email.ok ? "✉️ ✓" : `✉️ ✗ ${o.sendResult.email.error}`) : ""}
                  {!o.sendResult?.sms && !o.sendResult?.email && t("notSentNoProvider")}
                </span>
                {activa.status === "offered" && o.status === "offered" && (
                  <button type="button" onClick={() => pagadoManual(o.buyerId)} disabled={busy} className="text-blue-600 dark:text-blue-400 underline">{t("markPaid")}</button>
                )}
                <a href={`/lead/${o.token}`} target="_blank" rel="noreferrer" className="text-gray-400 underline">{t("openLink")}</a>
              </li>
            ))}
          </ul>
          {activa.status === "delivered" && (
            <p className="text-xs text-gray-500">
              {t("delivered")}: {activa.delivery?.sms?.ok ? "📲 ✓ " : ""}{activa.delivery?.email?.ok ? "✉️ ✓ " : ""}{activa.customerNotifiedAt ? t("customerNotified") : t("customerNotNotified")}
            </p>
          )}
          {activa.status === "offered" && (
            <div className="flex gap-2">
              <button type="button" onClick={reenviar} disabled={busy} className="border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-1.5 text-xs dark:text-gray-200">{t("resend")}</button>
              <button type="button" onClick={cancelar} disabled={busy} className="border border-red-200 text-red-600 rounded-lg px-3 py-1.5 text-xs">{t("cancelSale")}</button>
            </div>
          )}
        </div>
      )}

      {!activa && info && !open && (
        <p className="text-xs text-gray-500 dark:text-gray-400">
          {t("suggested", { price: money(info.price), customer: money(info.customerPrice) })}
          {info.buyers.length === 0 && <> · <Link href="/dashboard/settings/lead-buyers" className="text-blue-600 dark:text-blue-400 underline">{t("noBuyers")}</Link></>}
        </p>
      )}

      {open && info && (
        <div className="space-y-3 text-sm">
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2">
              <span className="text-gray-500">{t("price")}</span>
              <span className="text-gray-400">$</span>
              <input value={price} onChange={(e) => setPrice(e.target.value)} inputMode="decimal" className="w-20 border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-2 py-1.5" />
            </label>
            <span className="text-xs text-gray-400">{t("suggested", { price: money(info.price), customer: money(info.customerPrice) })}</span>
          </div>
          <div>
            <div className="text-xs text-gray-500 mb-1">{t("pickBuyers")}</div>
            {/* Desglose por comprador (Antonio, 19-sep-2026): cliente paga − parte − lead − labor mínima del
                tech = lo que le sobra. Con eso se ve a quién le sale el trabajo antes de ofrecerlo. */}
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead><tr className="text-left text-gray-400 border-b dark:border-gray-800">
                  <th className="py-1 pr-2"></th><th className="py-1 pr-2">{t("calc.buyer")}</th><th className="py-1 pr-2 text-right">{t("calc.customerPays")}</th><th className="py-1 pr-2 text-right">{t("calc.part")}</th><th className="py-1 pr-2 text-right">{t("calc.lead")}</th><th className="py-1 pr-2 text-right">{t("calc.laborMin")}</th><th className="py-1 pr-2 text-right">{t("calc.left")}</th><th className="py-1"></th>
                </tr></thead>
                <tbody>
                  {info.buyers.map((b) => {
                    const lead = Number(price) || 0;
                    const laborLeft = info.customerPrice - (info.partCost || 0) - lead; // lo que queda para la labor del tech
                    const surplus = laborLeft - Number(b.laborMin || 0);
                    const ok = !info.customerPrice ? null : surplus >= 0;
                    return (
                      <tr key={b.id} className={`border-b last:border-0 dark:border-gray-800 ${picked.includes(b.id) ? "bg-blue-50 dark:bg-blue-950" : ""}`}>
                        <td className="py-1.5 pr-2"><input type="checkbox" checked={picked.includes(b.id)} onChange={(e) => setPicked((p) => (e.target.checked ? [...p, b.id] : p.filter((x) => x !== b.id)))} /></td>
                        <td className="py-1.5 pr-2"><span className="font-medium">{b.name}</span>{b.company ? <span className="text-gray-500"> · {b.company}</span> : null}<span className="block text-[11px] text-gray-400">{[b.zones, b.phone ? "📲" : "", b.email ? "✉️" : ""].filter(Boolean).join(" · ")}</span></td>
                        <td className="py-1.5 pr-2 text-right">{info.customerPrice ? money(info.customerPrice) : "—"}</td>
                        <td className="py-1.5 pr-2 text-right">{info.partCost ? money(info.partCost) : "—"}</td>
                        <td className="py-1.5 pr-2 text-right">{money(lead)}</td>
                        <td className="py-1.5 pr-2 text-right">{b.laborMin ? money(b.laborMin) : "—"}</td>
                        <td className={`py-1.5 pr-2 text-right font-semibold ${ok === false ? "text-red-600" : ok ? "text-green-700 dark:text-green-400" : ""}`}>{info.customerPrice ? money(laborLeft) : "—"}</td>
                        <td className="py-1.5">{ok === null ? "" : ok ? `✅ +${money(surplus)}` : `❌ ${money(surplus)}`}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {info.buyers.length === 0 && <Link href="/dashboard/settings/lead-buyers" className="text-blue-600 underline text-sm">{t("noBuyers")}</Link>}
              <p className="text-[11px] text-gray-400 mt-1">{t("calc.hint")}</p>
            </div>
          </div>
          <div>
            <div className="text-xs text-gray-500 mb-1">{t("teaserPreview")}</div>
            <p className="text-xs bg-gray-50 dark:bg-gray-800 rounded-lg p-3 whitespace-pre-wrap">{teaserPreview}</p>
          </div>
          <p className="text-xs text-amber-700 dark:text-amber-300">{t("sellWarning")}</p>
          <div className="flex gap-2">
            <button type="button" onClick={vender} disabled={busy || !picked.length || !(Number(price) > 0)} className="bg-amber-600 hover:bg-amber-700 text-white rounded-lg px-4 py-2 disabled:opacity-40">
              {busy ? "…" : t("sendOffers", { n: picked.length })}
            </button>
            <button type="button" onClick={() => setOpen(false)} className="border border-gray-200 dark:border-gray-700 rounded-lg px-4 py-2 dark:text-gray-200">{t("cancel")}</button>
          </div>
        </div>
      )}

      {historial.length > 0 && (
        <details className="mt-3 text-xs text-gray-500">
          <summary className="cursor-pointer">{t("history", { n: historial.length })}</summary>
          <ul className="mt-1 space-y-1">
            {historial.map((s) => <li key={s.id}>{new Date(s.createdAt).toLocaleString()} · {money(s.price)} · {t(`status.${s.status}`)}{s.buyerName ? ` · ${s.buyerName}` : ""}{s.cancelReason ? ` · ${s.cancelReason}` : ""}</li>)}
          </ul>
        </details>
      )}
    </section>
  );
}
