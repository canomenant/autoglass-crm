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

        <div className="flex justify-between items-start mb-8 border-b pb-6">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
            <p className="text-sm text-gray-500 mt-1">{data.parties.join(", ") || "—"}</p>
          </div>
          <div className="text-right text-sm">
            <div className="font-semibold text-lg">{data.paymentNumber || "—"}</div>
            <div className="text-gray-500">{data.paymentDate || "—"}</div>
            {data.paymentMethod && <div className="text-gray-500">{data.paymentMethod}</div>}
          </div>
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
                {hayParte && <th className="py-2 pr-3">{tp("partInstalled")}</th>}
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
                  {hayParte && <td className="py-2 pr-3 font-mono text-xs">{o.partNumber || "—"}</td>}
                  <td className="py-2 pr-3">{o.workDate ? String(o.workDate).slice(0, 10) : "—"}</td>
                  <td className="py-2 text-right tabular-nums">{money(o.amount)}</td>
                </tr>
              ))}
              {data.obligations.length === 0 && (
                <tr><td colSpan={hayParte ? 5 : 4} className="py-3 text-gray-400">{t("noWorkOrders")}</td></tr>
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
                  <tr className="font-semibold">
                    <td className="py-2 pr-3" colSpan={hayComeback ? 5 : 4}>{t("cashTotal")}</td>
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
