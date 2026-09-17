"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { getPayoutInvoiceBreakdown } from "@/lib/api";

const money = (v) => `${Number(v) < 0 ? "-" : ""}$${Math.abs(Number(v || 0)).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// Qué significa cada renglón de la factura PARA ESTE PAGO. El orden es el de la cuenta: primero lo
// que el pago ya explica, al final lo que falta.
const ESTADOS = ["here", "note", "returned", "credit", "otherPayout", "pending", "noObligation", "undecided"];
const COLOR = {
  here: "text-green-700 dark:text-green-400",
  note: "text-purple-700 dark:text-purple-300",
  returned: "text-gray-500 dark:text-gray-400",
  credit: "text-gray-500 dark:text-gray-400",
  otherPayout: "text-amber-600 dark:text-amber-400",
  pending: "text-amber-600 dark:text-amber-400",
  noObligation: "text-red-600 dark:text-red-400",
  undecided: "text-red-600 dark:text-red-400",
};
// Lo que todavía hay que resolver para que la factura quede explicada por este pago.
const POR_RESOLVER = ["otherPayout", "pending", "noObligation", "undecided"];

// El desglose de las facturas del pago, renglón por renglón: el mismo detalle de Distributor
// Statements, leído desde el pago (Antonio, 17-sep-2026). Solo lectura: lo que se corrige en
// Statements o en las órdenes se refleja aquí al recargar.
export default function PayoutInvoiceBreakdown({ payoutId, version }) {
  const t = useTranslations("payments.invoiceBreakdown");
  const [data, setData] = useState(null);
  const [abiertas, setAbiertas] = useState(new Set());

  useEffect(() => {
    getPayoutInvoiceBreakdown(payoutId).then(setData).catch(() => setData({ invoices: [] }));
  }, [payoutId, version]);

  if (!data || !data.invoices.length) return null;
  const alternar = (k) => setAbiertas((prev) => { const s = new Set(prev); if (s.has(k)) s.delete(k); else s.add(k); return s; });
  const porResolver = POR_RESOLVER.reduce((a, k) => a + Math.abs(Number(data.totals.byState[k] || 0)), 0) + Number(data.totals.notOnInvoices || 0);

  return (
    <section className="bg-white dark:bg-gray-900 dark:border dark:border-gray-800 rounded-xl shadow-sm p-4 mb-6">
      <h2 className="font-semibold mb-1">{t("title")}</h2>
      <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">{t("hint")}</p>

      {data.invoices.map((f) => {
        const k = f.invoiceNumber;
        const abierta = abiertas.has(k);
        const pendiente = POR_RESOLVER.reduce((a, e) => a + Math.abs(Number(f.byState[e] || 0)), 0);
        return (
          <div key={k} className="border border-gray-200 dark:border-gray-800 rounded-lg mb-2">
            <button type="button" onClick={() => alternar(k)}
              className="w-full flex flex-wrap items-center gap-x-4 gap-y-1 px-3 py-2 text-left text-sm hover:bg-gray-50 dark:hover:bg-gray-800/60 rounded-lg">
              <span className="font-mono text-xs w-3">{abierta ? "▾" : "▸"}</span>
              <span className="font-mono font-medium">{f.invoiceNumber}</span>
              <span className="text-xs text-gray-500 dark:text-gray-400">{[f.kind === "CREDIT_MEMO" ? t("creditMemo") : t("invoice"), f.distributor, f.issueDate].filter(Boolean).join(" · ")}</span>
              <span className="ml-auto tabular-nums font-medium">{money(f.amount)}</span>
              <span className="w-full sm:w-auto text-xs">
                {f.missing || !f.lines.length
                  ? <span className="text-gray-400">{t("noLines")}</span>
                  : pendiente > 0.004
                    ? <span className="text-amber-600 dark:text-amber-400">{t("toResolve", { amount: money(pendiente) })}</span>
                    : <span className="text-green-700 dark:text-green-400">✓ {t("explained")}</span>}
              </span>
            </button>

            {abierta && f.lines.length > 0 && (
              <div className="px-3 pb-3 overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-left border-b dark:border-gray-800 text-gray-400 uppercase">
                      <th className="p-1.5">{t("reqNo")}</th>
                      <th className="p-1.5">{t("date")}</th>
                      <th className="p-1.5">{t("part")}</th>
                      <th className="p-1.5">{t("customer")}</th>
                      <th className="p-1.5 text-right">{t("amount")}</th>
                      <th className="p-1.5">{t("outcome")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {f.lines.map((l) => (
                      <tr key={l.id} className="border-b last:border-0 dark:border-gray-800">
                        <td className="p-1.5 font-mono">{l.reqNo}</td>
                        <td className="p-1.5 tabular-nums">{l.date || "—"}</td>
                        <td className="p-1.5 font-mono">{l.partNumber}</td>
                        <td className="p-1.5 text-gray-500 dark:text-gray-400">{l.customerName || "—"}</td>
                        <td className="p-1.5 text-right tabular-nums">{money(l.amount)}</td>
                        <td className={`p-1.5 ${COLOR[l.state] || ""}`}>
                          {t(`state.${l.state}`)}
                          {l.workOrderNo && (
                            <> · {l.workOrderId
                              ? <Link href={`/dashboard/workorders/${l.workOrderId}`} target="_blank" className="text-blue-600 dark:text-blue-400 hover:underline">{l.workOrderNo}</Link>
                              : l.workOrderNo}</>
                          )}
                          {l.otherPayout && <> · {l.otherPayout}</>}
                          {l.noteNumber && <> · {l.noteNumber}{l.notePayout ? ` (${l.notePayout})` : ""}</>}
                          {l.state === "returned" && l.creditedIn && <> · {l.creditedIn}</>}
                          {l.matchedByPart && <span className="text-gray-400"> · {t("matchedByPart")}</span>}
                          {/* La obligación vale distinto que el renglón: uno de los dos está mal. */}
                          {l.state === "here" && l.obligationAmount != null && Math.abs(l.obligationAmount - l.amount) > 0.004 && (
                            <span className="block text-amber-600 dark:text-amber-400">{t("amountDiffers", { obligation: money(l.obligationAmount) })}</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs">
                  {ESTADOS.filter((e) => Math.abs(Number(f.byState[e] || 0)) > 0.004).map((e) => (
                    <span key={e} className={COLOR[e]}>{t(`state.${e}`)}: <span className="tabular-nums">{money(f.byState[e])}</span></span>
                  ))}
                  {!f.linesMatch && <span className="text-red-600">{t("linesMismatch", { lines: money(f.linesTotal), invoice: money(f.amount) })}</span>}
                </div>
              </div>
            )}
          </div>
        );
      })}

      {/* El cuadre de todas las facturas juntas: un crédito suele venir en un memo aparte de la
          factura donde se compró la pieza, así que por factura sola no cierra. */}
      <div className="mt-3 text-sm max-w-md">
        {ESTADOS.filter((e) => Math.abs(Number(data.totals.byState[e] || 0)) > 0.004).map((e) => (
          <div key={e} className="flex justify-between py-1 border-b dark:border-gray-800">
            <span className={COLOR[e]}>{t(`state.${e}`)}</span>
            <span className="tabular-nums">{money(data.totals.byState[e])}</span>
          </div>
        ))}
        <div className="flex justify-between pt-2 font-semibold border-t-2 border-gray-900 dark:border-gray-200 mt-1">
          <span>{t("invoicedTotal")}</span>
          <span className="tabular-nums">{money(data.totals.invoiced)}</span>
        </div>
      </div>

      {data.notOnInvoices?.length > 0 && (
        <div className="mt-3 text-xs text-amber-700 dark:text-amber-400">
          <div className="font-medium mb-1">{t("notOnInvoices", { count: data.notOnInvoices.length, amount: money(data.totals.notOnInvoices) })}</div>
          {data.notOnInvoices.map((y) => (
            <div key={y.id}>
              {y.workOrderId
                ? <Link href={`/dashboard/workorders/${y.workOrderId}`} target="_blank" className="text-blue-600 dark:text-blue-400 hover:underline">{y.workOrderNo}</Link>
                : y.workOrderNo} · {y.customerName || "—"} · <span className="font-mono">{y.partNumber || "—"}</span> · {money(y.amount)}
            </div>
          ))}
        </div>
      )}

      <p className={`mt-3 text-sm font-medium ${porResolver > 0.004 ? "text-amber-600 dark:text-amber-400" : "text-green-700 dark:text-green-400"}`}>
        {porResolver > 0.004 ? t("totalToResolve", { amount: money(porResolver) }) : `✓ ${t("allExplained")}`}
      </p>
    </section>
  );
}
