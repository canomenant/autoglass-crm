"use client";

import { useEffect, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { getPayoutStatement } from "@/lib/api";

// Comprobante de pago, publico y autorizado solo por el token. Lo abre el tecnico o el agente
// para ver de que sale su monto sin tener cuenta en el sistema.
//
// El PDF sale de imprimir: ?print=1 dispara el dialogo del navegador, igual que la vista de
// factura. Guardar como PDF es un boton del propio dialogo, y evita cargar una libreria entera
// para replicar lo que el navegador ya hace bien.

function money(n) {
  return `$${Number(n || 0).toFixed(2)}`;
}

// Pagado en verde, en camino en ámbar, sin aprobar en gris: quien recibe el papel tiene que poder
// distinguir de un vistazo un pago hecho de una propuesta que todavía no se firma.
const TONO_ESTADO = {
  Paid: "bg-green-100 text-green-800",
  Approved: "bg-green-100 text-green-800",
  "Ready For Payment": "bg-amber-100 text-amber-800",
  Pending: "bg-gray-200 text-gray-700",
  Cancelled: "bg-red-100 text-red-800",
};

export default function StatementPage() {
  const { token } = useParams();
  const searchParams = useSearchParams();
  const t = useTranslations("statement");
  const tp = useTranslations("payments");
  const [data, setData] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    getPayoutStatement(token)
      .then(setData)
      .catch(() => setError(t("notFound")));
  }, [token, t]);

  useEffect(() => {
    if (data && searchParams.get("print") === "1") {
      const id = setTimeout(() => window.print(), 400);
      return () => clearTimeout(id);
    }
  }, [data, searchParams]);

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6 bg-gray-100">
        <p className="text-gray-600 text-sm">{error}</p>
      </div>
    );
  }
  if (!data) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6 bg-gray-100">
        <p className="text-gray-400 text-sm">{t("loading")}</p>
      </div>
    );
  }

  const esTecnico = data.type === "TECHNICIAN";
  const esDistribuidor = data.type === "DISTRIBUTOR";
  const facturas = esDistribuidor ? data.invoices || [] : [];
  const hayFacturaNota = data.notes.some((n) => n.invoiceNumber);
  const base = esTecnico ? data.baseAmount : data.type === "AGENT" ? data.grossAmount : data.subtotal;
  const hayParte = data.obligations.some((o) => o.partNumber);
  // La columna de comeback solo se dibuja si alguien devolvio algo: en la mayoria de los lotes es
  // cero y una columna de guiones no dice nada.
  const hayComeback = (data.cashJobs || []).some((c) => Number(c.comeback) > 0);
  const fechasTrabajo = data.obligations
    .map((o) => (o.workDate ? String(o.workDate).slice(0, 10) : ""))
    .filter(Boolean)
    .sort();
  // El tipo de trabajo sólo tiene sentido en el lote de técnico y de agente: al distribuidor se le
  // paga una pieza, no un trabajo.
  const hayTrabajo = !esDistribuidor && data.obligations.some((o) => o.jobType);
  const hayMetodoCliente = !esDistribuidor && data.obligations.some((o) => o.customerMethod);
  const totalEfectivo = (data.cashJobs || []).reduce((s, c) => s + Number(c.collected || 0) - Number(c.comeback || 0), 0);

  // Los mismos terminos que el desglose interno y en el mismo orden, para que el tecnico y quien
  // le paga esten mirando exactamente la misma cuenta. Lo que vale cero no se dibuja.
  const terminos = [
    { k: esTecnico ? "laborSubtotal" : "subtotal", v: base, signo: "", siempre: true },
    { k: "bonus", v: data.bonus, signo: "+", nota: data.bonusReason },
    { k: "deductions", v: data.deductions, signo: "−" },
    { k: "cashCollected", v: data.cashAdvance, signo: "−" },
    { k: "partsCharged", v: data.partsDeduction, signo: "−" },
    { k: "partsReturned", v: data.partsReturn, signo: "+" },
    { k: "tax", v: data.taxAmount, signo: "+" },
    { k: "creditNotes", v: data.creditNotesTotal, signo: "−" },
    { k: "debitNotes", v: data.debitNotesTotal, signo: "+" },
  ].filter((x) => x.siempre || Number(x.v || 0) !== 0);

  return (
    <div className="min-h-screen bg-gray-100 py-8 px-4 print:bg-white print:p-0">
      {/* Márgenes del papel: sin esto el comprobante sale pegado al borde de la hoja. */}
      <style>{"@page { margin: 14mm }"}</style>
      <div className="max-w-3xl mx-auto bg-white rounded-xl shadow-sm print:shadow-none print:rounded-none p-8 print:p-0">
        <div className="flex justify-end mb-6 print:hidden">
          <button
            type="button"
            onClick={() => window.print()}
            className="bg-gray-900 hover:bg-gray-800 text-white rounded-lg px-4 py-2 text-sm transition-colors"
          >
            {t("savePdf")}
          </button>
        </div>

        {/* Es un papel que sale de la empresa y se le entrega a alguien: lleva el logo y de quién
            viene, como la factura al cliente. Sin esto lo único que identificaba al documento era
            el encabezado que el navegador imprime, que no es parte del papel. */}
        <div className="flex items-start gap-4 mb-6 border-b-2 border-gray-900 pb-4">
          <img src="/logo.png" alt="Reyes Auto Glass Group" className="w-20 h-auto" />
          <div className="flex-1">
            <div className="font-bold">Reyes Auto Glass Group</div>
            <div className="text-xs text-gray-500">info@reyesautoglassgroup.com</div>
            <div className="text-xs text-gray-500">crmreyesautoglassgroup.com</div>
          </div>
          <div className="text-right">
            <h1 className="text-xl font-semibold tracking-tight">{t("title")}</h1>
            {/* Sin número asignado se decía con un guión, que se lee como "no aplica". El número
                nace al aprobar, así que aquí se dice con todas sus letras. */}
            <div className="text-xs text-gray-500">{data.paymentNumber || t("noNumberYet")}</div>
            <span className={`inline-block mt-1 text-[10px] font-bold uppercase tracking-wider rounded-full px-2 py-1 ${TONO_ESTADO[data.status] || "bg-gray-200 text-gray-700"}`}>
              {tp(`statuses.${data.status}`)}
            </span>
            <div className="text-xs text-gray-500 mt-1">{data.paymentDate || "—"}</div>
            {data.paymentMethod && <div className="text-xs text-gray-500">{data.paymentMethod}</div>}
          </div>
        </div>

        {/* A nombre de quién va, y de qué periodo: ubicar la quincena de un vistazo. */}
        <div className="flex justify-between items-end mb-8">
          <div>
            <span className="block text-[10px] uppercase tracking-wider text-gray-400">{t("paidTo")}</span>
            <b className="text-base">{data.parties.join(", ") || "—"}</b>
          </div>
          {fechasTrabajo.length > 0 && (
            <span className="text-xs text-gray-500">
              {t("periodSummary", { count: data.obligations.length, from: fechasTrabajo[0], to: fechasTrabajo[fechasTrabajo.length - 1] })}
            </span>
          )}
        </div>

        {facturas.length > 0 && (
          <>
            <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500 mb-3">{t("invoicesSection")}</h2>
            <table className="w-full text-sm mb-8">
              <thead>
                <tr className="text-left border-b text-xs text-gray-400 uppercase">
                  <th className="py-2 pr-3">{t("invoiceDate")}</th>
                  <th className="py-2 pr-3">{t("invoiceNo")}</th>
                  <th className="py-2 text-right">{t("amount")}</th>
                </tr>
              </thead>
              <tbody>
                {facturas.map((f, i) => (
                  <tr key={i} className="border-b last:border-0">
                    <td className="py-2 pr-3">{f.date || "—"}</td>
                    <td className="py-2 pr-3 font-mono text-xs">{f.number || "—"}</td>
                    <td className="py-2 text-right tabular-nums">{money(f.amount)}</td>
                  </tr>
                ))}
                <tr className="font-semibold">
                  <td className="py-2 pr-3" colSpan={2}>{t("invoicesTotal")}</td>
                  <td className="py-2 text-right tabular-nums">{money(data.invoiceTotal)}</td>
                </tr>
              </tbody>
            </table>
          </>
        )}

        <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500 mb-3">
          {t("workOrders", { count: data.obligations.length })}
        </h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm mb-8">
            <thead>
              <tr className="text-left border-b text-xs text-gray-400 uppercase">
                <th className="py-2 pr-3">{tp("workOrder")}</th>
                {/* Quien recibe esto reconoce el trabajo por el cliente y el carro, no por el
                    numero de orden. La parte solo aparece del lado del distribuidor. */}
                <th className="py-2 pr-3">{tp("customer")}</th>
                {hayTrabajo && <th className="py-2 pr-3">{tp("jobType")}</th>}
                {hayParte && <th className="py-2 pr-3">{tp("partInstalled")}</th>}
                {hayMetodoCliente && <th className="py-2 pr-3">{t("customerPaidWith")}</th>}
                <th className="py-2 pr-3">{tp("workDate")}</th>
                <th className="py-2 text-right">{t("amount")}</th>
              </tr>
            </thead>
            <tbody>
              {data.obligations.map((o, i) => (
                <tr key={i} className="border-b last:border-0">
                  <td className="py-2 pr-3 font-medium">{o.workOrderNo || "—"}</td>
                  <td className="py-2 pr-3">
                    {o.customerName || "—"}
                    {o.vehicle && <span className="block text-xs text-gray-400">{o.vehicle}</span>}
                  </td>
                  {hayTrabajo && <td className="py-2 pr-3">{o.jobType || "—"}</td>}
                  {/* Con la columna de trabajo al lado, repetir "Chip Repair" como pieza es ruido:
                      esos renglones no llevan pieza de verdad, llevan el nombre del servicio. */}
                  {hayParte && (
                    <td className="py-2 pr-3 font-mono text-xs">
                      {o.partNumber && o.partNumber !== o.jobType ? o.partNumber : "—"}
                    </td>
                  )}
                  {/* El método siempre; el importe SOLO si fue efectivo que él se quedó. De una
                      tarjeta no tocó nada y cuánto pagó el cliente no le hace falta para cuadrar
                      su pago (Antonio, 9-sep-2026). */}
                  {hayMetodoCliente && (
                    <td className="py-2 pr-3">
                      {Number(o.cashInHand) > 0 ? (
                        <>
                          <span className="text-green-700 font-medium">{t("cashAmount", { amount: money(o.cashInHand) })}</span>
                          <span className="block text-xs text-gray-400">{t("cashInYourHands")}</span>
                        </>
                      ) : (
                        <span className="text-gray-500">{o.customerMethod || "—"}</span>
                      )}
                    </td>
                  )}
                  <td className="py-2 pr-3">{o.workDate ? String(o.workDate).slice(0, 10) : "—"}</td>
                  <td className="py-2 text-right tabular-nums">{money(o.amount)}</td>
                </tr>
              ))}
              {data.obligations.length === 0 && (
                <tr>
                  <td colSpan={3 + (hayTrabajo ? 1 : 0) + (hayParte ? 1 : 0) + (hayMetodoCliente ? 1 : 0)} className="py-3 text-gray-400">
                    {t("noWorkOrders")}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Las partes que se le cobraron van con su numero: "te descontamos $265.08" sin decir de
            que piezas es justo lo que genera el reclamo que este comprobante deberia evitar. */}
        {data.notes.length > 0 && (
          <>
            <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500 mb-3">
              {esDistribuidor ? t("notesSection") : t("partsCharged")}
            </h2>
            <table className="w-full text-sm mb-8">
              <thead>
                <tr className="text-left border-b text-xs text-gray-400 uppercase">
                  <th className="py-2 pr-3">{t("note")}</th>
                  {hayFacturaNota && <th className="py-2 pr-3">{t("invoiceNo")}</th>}
                  <th className="py-2 pr-3">{tp("partInstalled")}</th>
                  {esDistribuidor && <th className="py-2 pr-3">{t("reason")}</th>}
                  <th className="py-2 text-right">{t("amount")}</th>
                </tr>
              </thead>
              <tbody>
                {data.notes.map((n, i) => (
                  <tr key={i} className="border-b last:border-0">
                    <td className="py-2 pr-3">{n.noteNumber}</td>
                    {hayFacturaNota && <td className="py-2 pr-3 font-mono text-xs">{n.invoiceNumber || "—"}</td>}
                    <td className="py-2 pr-3 font-mono text-xs">{n.partNumber || "—"}</td>
                    {esDistribuidor && <td className="py-2 pr-3 text-xs text-gray-500">{n.reason || "—"}</td>}
                    <td className="py-2 text-right tabular-nums">
                      {n.noteType === "CREDIT" || n.chargedHere ? "− " : "+ "}{money(n.amount)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}

        {/* De donde sale el efectivo que se descuenta. Es casi siempre el descuento mas grande y
            era el unico sin explicar: el comprobante decia "− Efectivo cobrado $940.00" y punto.
            Solo aparecen las ordenes que el tecnico cobro en mano; del resto no toco dinero. */}
        {(data.cashJobs || []).length > 0 && (
          <>
            <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500 mb-3">{t("cashSection")}</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-sm mb-8">
                <thead>
                  <tr className="text-left border-b text-xs text-gray-400 uppercase">
                    <th className="py-2 pr-3">{tp("workOrder")}</th>
                    <th className="py-2 pr-3">{tp("customer")}</th>
                    <th className="py-2 pr-3">{tp("workDate")}</th>
                    <th className="py-2 pr-3 text-right">{t("cashCollected")}</th>
                    {hayComeback && <th className="py-2 pr-3 text-right">{t("cashComeback")}</th>}
                    <th className="py-2 text-right">{t("cashNet")}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.cashJobs.map((c, i) => (
                    <tr key={i} className="border-b last:border-0">
                      <td className="py-2 pr-3 font-medium">{c.workOrderNo || "—"}</td>
                      <td className="py-2 pr-3">
                        {c.customerName || "—"}
                        {c.vehicle && <span className="block text-xs text-gray-400">{c.vehicle}</span>}
                      </td>
                      <td className="py-2 pr-3">{c.workDate ? String(c.workDate).slice(0, 10) : "—"}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{money(c.collected)}</td>
                      {hayComeback && (
                        <td className="py-2 pr-3 text-right tabular-nums text-gray-500">
                          {c.comeback ? `− ${money(c.comeback)}` : "—"}
                        </td>
                      )}
                      <td className="py-2 text-right tabular-nums">{money(c.collected - c.comeback)}</td>
                    </tr>
                  ))}
                  {/* El total dice adónde va: enlaza con el renglón "− Efectivo cobrado" del
                      desglose, que antes era una cifra suelta sin relación visible con esta lista. */}
                  <tr className="font-semibold">
                    <td className="py-2 pr-3" colSpan={hayComeback ? 5 : 4}>{t("cashTotalDeducted")}</td>
                    <td className="py-2 text-right tabular-nums">{money(totalEfectivo)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </>
        )}

        <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500 mb-3">{tp("breakdown")}</h2>
        <div className="max-w-sm ml-auto text-sm">
          {terminos.map((x) => (
            <div key={x.k} className="flex justify-between py-1.5 border-b">
              <span className="text-gray-500">
                <span className="inline-block w-3">{x.signo}</span> {t(`term.${x.k}`)}
                {x.nota && <span className="block text-xs text-gray-400 ml-3">{x.nota}</span>}
              </span>
              <span className="tabular-nums">{money(x.v)}</span>
            </div>
          ))}
          <div className="flex justify-between pt-3 mt-1 font-semibold text-base border-t-2 border-gray-900">
            <span>{t("netPaid")}</span>
            <span className="tabular-nums">{money(data.amount)}</span>
          </div>
        </div>

        <p className="text-xs text-gray-400 mt-10 pt-4 border-t">{t("footer")}</p>
      </div>
    </div>
  );
}
