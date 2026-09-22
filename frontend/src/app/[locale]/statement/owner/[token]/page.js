"use client";

import { Fragment, useEffect, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { getOwnerStatement } from "@/lib/api";
import { describePayoutMethod, preferredPayoutMethod } from "@/lib/payoutMethods";

// La copia del DUEÑO del comprobante de pago: lo mismo que ve el técnico más lo que sólo le toca
// al socio — costo de parte y su distribuidor, comisión y su agente, labor, ganancia por trabajo y
// el resumen del Admin Profit Panel (Antonio, 21-sep-2026).
//
// Va por su propio token: el link del técnico (/statement/<token>) no lleva a éste y revocar uno
// no toca al otro. El PDF sale de imprimir, igual que el otro comprobante.

// El menos va DELANTE del signo de dólar: "$-32.35" se lee como un error de captura, no como una
// pérdida (Antonio, 22-sep-2026).
function money(n) {
  const v = Number(n || 0);
  return (v < 0 ? "−$" : "$") + Math.abs(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

const TONO_ESTADO = {
  Paid: "bg-green-100 text-green-800",
  Approved: "bg-green-100 text-green-800",
  "Ready For Payment": "bg-amber-100 text-amber-800",
  Pending: "bg-gray-200 text-gray-700",
  Cancelled: "bg-red-100 text-red-800",
};

export default function OwnerStatementPage() {
  const { token } = useParams();
  const searchParams = useSearchParams();
  const t = useTranslations("statement");
  const to = useTranslations("ownerStatement");
  const tp = useTranslations("payments");
  const [data, setData] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    getOwnerStatement(token).then(setData).catch(() => setError(t("notFound")));
  }, [token, t]);

  useEffect(() => {
    if (data && searchParams.get("print") === "1") {
      const id = setTimeout(() => window.print(), 400);
      return () => clearTimeout(id);
    }
  }, [data, searchParams]);

  if (error) return <div className="min-h-screen flex items-center justify-center p-6 bg-gray-100"><p className="text-gray-600 text-sm">{error}</p></div>;
  if (!data) return <div className="min-h-screen flex items-center justify-center p-6 bg-gray-100"><p className="text-gray-400 text-sm">{t("loading")}</p></div>;

  const jobs = data.obligations || [];
  const perfil = data.jobProfit || {};
  const resumen = data.profit || {};
  const notas = data.notes || [];
  const piezas = data.techParts || [];
  const esTecnico = data.type === "TECHNICIAN";

  // La columna que ESTE lote paga: la labor si es del técnico, la comisión si es del agente, la
  // parte si es del distribuidor. Va resaltada porque es el renglón que el socio autoriza; las
  // otras dos sólo explican de dónde sale la ganancia.
  const columnaPagada = esTecnico ? "labour" : data.type === "AGENT" ? "commission" : "part";
  const marca = "bg-amber-100";

  // Repetir en los nueve renglones a quién se le paga no dice nada: ya está arriba, en "Paid to".
  // El nombre del agente o del técnico sólo aparece cuando es OTRO.
  const pagados = (data.parties || []).map((x) => String(x || "").trim().toLowerCase()).filter(Boolean);
  const esElPagado = (nombre) => {
    const n = String(nombre || "").trim().toLowerCase();
    if (!n) return false;
    return pagados.some((p) => p === n || p.startsWith(n) || n.startsWith(p));
  };

  const formasDePago = data.payoutMethods || [];
  const preferida = preferredPayoutMethod(formasDePago);
  const otrasFormas = formasDePago.filter((m) => m !== preferida);
  const fechas = jobs.map((o) => (o.workDate ? String(o.workDate).slice(0, 10) : "")).filter(Boolean).sort();

  // Los mismos renglones del comprobante del técnico: lo que vale cero no se dibuja.
  const terminos = [
    { k: esTecnico ? "laborSubtotal" : "subtotal", v: esTecnico ? data.baseAmount : data.type === "AGENT" ? data.grossAmount : data.subtotal, signo: "", siempre: true },
    { k: "bonus", v: data.bonus, signo: "+", items: data.bonusItems || [] },
    { k: "deductions", v: data.deductions, signo: "−" },
    { k: "cashCollected", v: data.cashAdvance, signo: "−" },
    { k: "partsCharged", v: data.partsDeduction, signo: "−" },
    { k: "partsReturned", v: data.partsReturn, signo: "+" },
    { k: "tax", v: data.taxAmount, signo: "+" },
    { k: "creditNotes", v: data.creditNotesTotal, signo: "−" },
    { k: "debitNotes", v: data.debitNotesTotal, signo: "+" },
  ].filter((x) => x.siempre || Number(x.v || 0) !== 0);

  const th = "py-2 pr-3 text-left text-[10px] uppercase tracking-wide text-gray-600 font-semibold";
  const thr = `${th} text-right`;
  const td = "py-2 pr-3 border-b border-gray-100 align-top";

  return (
    <div className="min-h-screen bg-gray-100 py-8 px-4 print:bg-white print:p-0">
      {/* print-color-adjust: sin esto el navegador imprime los fondos en blanco, y la columna que
          se está pagando dejaría de distinguirse justo en el papel. */}
      <style>{"@page { margin: 12mm; size: landscape } @media print { * { -webkit-print-color-adjust: exact; print-color-adjust: exact } }"}</style>
      <div className="max-w-6xl mx-auto bg-white rounded-xl shadow-sm print:shadow-none print:rounded-none p-8 print:p-0">
        <div className="flex justify-end mb-6 print:hidden">
          <button type="button" onClick={() => window.print()} className="bg-gray-900 hover:bg-gray-800 text-white rounded-lg px-4 py-2 text-sm transition-colors">
            {t("savePdf")}
          </button>
        </div>

        <div className="flex items-start gap-4 mb-6 border-b-2 border-gray-900 pb-4">
          <img src="/logo-print.png" alt="Reyes Auto Glass Group" className="w-24 h-auto" />
          <div className="flex-1">
            <div className="font-bold">Reyes Auto Glass Group</div>
            <div className="text-xs text-gray-500">info@reyesautoglassgroup.com</div>
            <div className="text-xs text-gray-500">crmreyesautoglassgroup.com</div>
          </div>
          <div className="text-right">
            <h1 className="text-xl font-semibold tracking-tight">{t("title")}</h1>
            <div className="text-xs text-gray-500">{data.paymentNumber || t("noNumberYet")}</div>
            <span className={`inline-block mt-1 text-[10px] font-bold uppercase tracking-wider rounded-full px-2 py-1 ${TONO_ESTADO[data.status] || "bg-gray-200 text-gray-700"}`}>
              {tp(`statuses.${data.status}`)}
            </span>
            <div className="text-xs text-gray-500 mt-1">{data.paymentDate || "—"}</div>
            <div className="mt-1.5">
              <span className="inline-block text-[10px] font-bold uppercase tracking-wider rounded-full px-2 py-1 bg-amber-100 text-amber-800">{to("ownerCopy")}</span>
            </div>
          </div>
        </div>

        <div className="flex justify-between items-end mb-6">
          <div>
            <span className="block text-[10px] uppercase tracking-wider text-gray-400">{t("paidTo")}</span>
            <b className="text-base">{(data.parties || []).join(", ") || "—"}</b>
          </div>
          {fechas.length > 0 && (
            <span className="text-xs text-gray-500">{t("periodSummary", { count: jobs.length, from: fechas[0], to: fechas[fechas.length - 1] })}</span>
          )}
        </div>

        <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500 mb-3">{t("workOrders", { count: jobs.length })}</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm mb-6">
            <thead>
              <tr className="border-b">
                <th className={th}>{tp("workOrder")}</th>
                <th className={th}>{tp("customer")}</th>
                <th className={th}>{tp("jobType")}</th>
                <th className={thr}>{to("sale")}</th>
                <th className={`${thr} ${columnaPagada === "part" ? `${marca} text-amber-700` : ""}`}>
                  {to("partCost")}
                  {columnaPagada === "part" && <span className="block normal-case tracking-normal text-amber-700 font-semibold">{to("paidHere")}</span>}
                </th>
                <th className={`${thr} ${columnaPagada === "commission" ? `${marca} text-amber-700` : ""}`}>
                  {to("agentCommission")}
                  {columnaPagada === "commission" && <span className="block normal-case tracking-normal text-amber-700 font-semibold">{to("paidHere")}</span>}
                </th>
                <th className={`${thr} ${columnaPagada === "labour" ? `${marca} text-amber-700` : ""}`}>
                  {to("techLabour")}
                  {columnaPagada === "labour" && <span className="block normal-case tracking-normal text-amber-700 font-semibold">{to("paidHere")}</span>}
                </th>
                <th className={thr}>{to("grossProfit")}</th>
              </tr>
            </thead>
            <tbody>
              {jobs.map((o, i) => {
                const p = perfil[o.workOrderNo] || {};
                return (
                  <tr key={i}>
                    <td className={`${td} font-medium whitespace-nowrap`}>
                      {o.workOrderNo || "—"}
                      <span className="block text-[10px] text-gray-600 font-normal">{o.workDate ? String(o.workDate).slice(0, 10) : "—"}</span>
                    </td>
                    <td className={td}>
                      {o.customerName || "—"}
                      {o.vehicle && <span className="block text-[10px] text-gray-600">{o.vehicle}</span>}
                    </td>
                    <td className={td}>
                      {p.jobType || o.jobType || "—"}
                      {o.partNumber && o.partNumber !== (p.jobType || o.jobType) && (
                        <span className="block text-[10px] text-gray-600 font-mono">{o.partNumber}</span>
                      )}
                      {p.insurance && <span className="block text-[10px] font-semibold text-sky-700">{to("insuranceTag")}</span>}
                    </td>
                    {/* Cómo entró el dinero de esa orden. Sin esto el socio veía la venta pero no
                        si se cobró, con qué, ni cuánto efectivo se quedó el técnico en la mano
                        (Antonio, 22-sep-2026). */}
                    <td className={`${td} text-right tabular-nums`}>
                      {money(p.sale)}
                      {p.customerPaid === false ? (
                        <span className="block text-[10px] font-semibold text-amber-700">{to("notCollected")}</span>
                      ) : (
                        o.customerMethod && <span className="block text-[10px] text-gray-600">{o.customerMethod}</span>
                      )}
                      {Number(o.cashInHand) > 0 && (
                        <span className="block text-[10px] font-semibold text-amber-800">
                          {money(o.cashInHand)} {to("cashKeptByTech")}
                        </span>
                      )}
                    </td>
                    <td className={`${td} text-right tabular-nums text-red-700 ${columnaPagada === "part" ? marca : ""}`}>
                      {money(p.partCost)}
                      {!esElPagado(p.distributor) && (
                        <span className="block text-[10px] text-gray-600">{p.distributor || (p.partCost ? "—" : to("noPart"))}</span>
                      )}
                    </td>
                    <td className={`${td} text-right tabular-nums text-red-700 ${columnaPagada === "commission" ? marca : ""}`}>
                      {money(p.agentCommission)}
                      {p.agentIsCompany ? (
                        <span className="block text-[10px] font-semibold text-amber-700">{to("noAgentPerson")}</span>
                      ) : (
                        !esElPagado(p.agentName) && <span className="block text-[10px] text-gray-600">{p.agentName || "—"}</span>
                      )}
                    </td>
                    <td className={`${td} text-right tabular-nums text-red-700 ${columnaPagada === "labour" ? marca : ""}`}>
                      {money(p.technicianLabour)}
                      {!esElPagado(p.technicianName) && p.technicianName && (
                        <span className="block text-[10px] text-gray-600">{p.technicianName}</span>
                      )}
                    </td>
                    <td className={`${td} text-right tabular-nums font-semibold ${p.insurance ? "text-gray-400" : Number(p.grossProfit) < 0 ? "text-red-700" : "text-green-700"}`}>
                      {money(p.grossProfit)}
                      {p.insurance && <span className="block text-[10px] font-normal text-gray-400">{to("excluded")}</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="font-bold border-t-2 border-gray-900">
                <td className="py-2 pr-3" colSpan={3}>{to("total")}</td>
                <td className="py-2 pr-3 text-right tabular-nums">{money(resumen.revenue)}</td>
                <td className={`py-2 pr-3 text-right tabular-nums text-red-700 ${columnaPagada === "part" ? marca : ""}`}>{money(resumen.partCost)}</td>
                <td className={`py-2 pr-3 text-right tabular-nums text-red-700 ${columnaPagada === "commission" ? marca : ""}`}>{money(resumen.agentCommission)}</td>
                <td className={`py-2 pr-3 text-right tabular-nums text-red-700 ${columnaPagada === "labour" ? marca : ""}`}>{money(resumen.technicianLabour)}</td>
                <td className={`py-2 pr-3 text-right tabular-nums ${Number(resumen.grossProfit) < 0 ? "text-red-700" : "text-green-700"}`}>{money(resumen.grossProfit)}</td>
              </tr>
            </tfoot>
          </table>
        </div>

        {Number(resumen.insuranceCount) > 0 && (
          <p className="text-xs text-sky-800 bg-sky-50 border border-sky-200 rounded-lg px-3 py-2 mb-6">{to("insuranceNote", { count: resumen.insuranceCount })}</p>
        )}

        {piezas.length > 0 && (
          <>
            <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500 mb-3">{to("techPartsTitle")}</h2>
            <table className="w-full text-sm mb-6">
              <thead>
                <tr className="border-b">
                  <th className={th}>{tp("workOrder")}</th>
                  <th className={th}>{tp("customer")}</th>
                  <th className={th}>{tp("partNumber")}</th>
                  <th className={thr}>{t("amount")}</th>
                </tr>
              </thead>
              <tbody>
                {piezas.map((p, i) => (
                  <tr key={i}>
                    <td className={`${td} font-medium whitespace-nowrap`}>{p.workOrderNo || "—"}</td>
                    <td className={td}>{p.customerName || "—"}</td>
                    <td className={`${td} font-mono text-xs`}>{p.partNumber || p.partDescription || "—"}</td>
                    <td className={`${td} text-right tabular-nums`}>{money(p.amount)}</td>
                  </tr>
                ))}
                <tr className="font-semibold">
                  <td className="py-2 pr-3" colSpan={3}>{to("total")}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{money(piezas.reduce((s, p) => s + Number(p.amount || 0), 0))}</td>
                </tr>
              </tbody>
            </table>
          </>
        )}

        {notas.length > 0 && (
          <>
            <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500 mb-3">{t("notesSection")}</h2>
            <table className="w-full text-sm mb-6">
              <thead>
                <tr className="border-b">
                  <th className={th}>{t("note")}</th>
                  <th className={th}>{to("noteKind")}</th>
                  <th className={th}>{tp("partNumber")}</th>
                  <th className={th}>{t("reason")}</th>
                  <th className={thr}>{t("amount")}</th>
                </tr>
              </thead>
              <tbody>
                {notas.map((n, i) => {
                  const resta = n.noteType === "CREDIT" || n.chargedHere;
                  return (
                    <tr key={i}>
                      <td className={`${td} whitespace-nowrap`}>{n.noteNumber}{n.issueDate && <span className="block text-[10px] text-gray-600">{String(n.issueDate).slice(0, 10)}</span>}</td>
                      <td className={td}>
                        <span className={`text-[10px] font-semibold uppercase rounded-full px-2 py-0.5 ${n.noteType === "CREDIT" ? "bg-green-100 text-green-800" : "bg-purple-100 text-purple-800"}`}>
                          {to(n.noteType === "CREDIT" ? "credit" : "debit")}
                        </span>
                      </td>
                      <td className={`${td} font-mono text-xs`}>{n.partNumber || n.invoiceNumber || "—"}</td>
                      <td className={`${td} text-xs text-gray-500`}>{n.reason || "—"}</td>
                      <td className={`${td} text-right tabular-nums`}>{resta ? "− " : "+ "}{money(n.amount)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-8">
          <div>
            <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500 mb-3">{to("profitSummary")}</h2>
            <div className="bg-slate-50 border border-slate-200 rounded-lg p-4 text-sm">
              <Linea label={to("revenue")} value={money(resumen.revenue)} />
              <Linea label={`− ${to("partCost")}`} value={money(resumen.partCost)} rojo />
              <Linea label={`− ${to("agentCommission")}`} value={money(resumen.agentCommission)} rojo />
              <Linea label={`− ${to("techLabour")}`} value={money(resumen.technicianLabour)} rojo />
              <div className="flex justify-between items-baseline border-t border-slate-300 mt-2 pt-2">
                <b>{to("grossProfit")}</b>
                <b className="text-xl text-green-700 tabular-nums">{money(resumen.grossProfit)}</b>
              </div>
              <Linea label={to("margin")} value={`${Number(resumen.margin || 0).toFixed(1)}%`} />
            </div>
          </div>
          <div>
            <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500 mb-3">{to("payoutTitle")}</h2>
            <div className="bg-slate-50 border border-slate-200 rounded-lg p-4 text-sm">
              {terminos.map((x) => (
                <Fragment key={x.k}>
                  <Linea label={`${x.signo ? `${x.signo} ` : ""}${t(`term.${x.k}`)}`} value={money(x.v)} rojo={x.signo === "−"} />
                  {(x.items || []).map((b, i) => (
                    <div key={b.id ?? i} className="flex justify-between gap-3 pl-5 text-[11px] text-gray-400">
                      <span>{b.bonusType ? tp(`bonusTypes.${b.bonusType}`) : t(`term.${x.k}`)}{b.note ? ` · ${b.note}` : ""}</span>
                      <span className="tabular-nums">{money(b.amount)}</span>
                    </div>
                  ))}
                </Fragment>
              ))}
              <div className="flex justify-between items-baseline border-t border-slate-300 mt-2 pt-2">
                <b>{t("netPaid")}</b>
                <b className="text-xl tabular-nums">{money(data.amount)}</b>
              </div>
            </div>
            {Number(resumen.unpaidCount) > 0 && (
              <p className="text-xs text-amber-700 mt-2">{to("unpaidNote", { count: resumen.unpaidCount })}</p>
            )}
            {/* Cómo se le manda el dinero: es lo que el socio necesita para pagar sin preguntar
                (Antonio, 21-sep-2026). Sale de la ficha del técnico o del agente. */}
            {preferida && (
              <div className="mt-3 bg-sky-50 border border-sky-200 rounded-lg p-3">
                <div className="text-[10px] uppercase tracking-wider text-sky-700 mb-1">{to("sendTo")}</div>
                <div className="font-semibold text-sky-900">{describePayoutMethod(preferida)}</div>
                {preferida.notes && <div className="text-[11px] text-sky-700 mt-0.5">{preferida.notes}</div>}
                {otrasFormas.length > 0 && (
                  <div className="text-[11px] text-sky-700 mt-1">{to("alsoAccepts")}: {otrasFormas.map(describePayoutMethod).join(" · ")}</div>
                )}
              </div>
            )}
          </div>
        </div>

        <p className="text-[11px] text-gray-400 mt-8 border-t pt-4">{to("footer")}</p>
      </div>
    </div>
  );
}

function Linea({ label, value, rojo }) {
  return (
    <div className="flex justify-between items-baseline gap-3 py-0.5">
      <span className="text-gray-500">{label}</span>
      <span className={`tabular-nums ${rojo ? "text-red-700" : ""}`}>{value}</span>
    </div>
  );
}
