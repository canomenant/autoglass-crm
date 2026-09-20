"use client";

import { Fragment, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { getPaymentStatement } from "@/lib/api";

// El detalle de UN pago de comisión, visto por el agente: el mismo comprobante que sale por el link
// público, dentro del CRM. La pantalla de la oficina le mostraba el editor del bono (con botón de
// borrar), los botones de notas de crédito/débito, el aviso interno de "sin obligación detrás" y
// la bitácora con quién aprobó qué — todo de captura, nada suyo.

function money(n) {
  return `$${Number(n || 0).toFixed(2)}`;
}

const STATUS_TONE = {
  Paid: "bg-green-100 text-green-800",
  Approved: "bg-green-100 text-green-800",
  "Ready For Payment": "bg-amber-100 text-amber-800",
  Pending: "bg-gray-200 text-gray-700",
  Cancelled: "bg-red-100 text-red-800",
};

export default function AgentPaymentStatement({ id }) {
  const t = useTranslations("agentPortal");
  const ts = useTranslations("statement");
  const tp = useTranslations("payments");
  const [data, setData] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    getPaymentStatement(id).then(setData).catch(() => setError(t("payments.notFound")));
  }, [id, t]);

  if (error) return <p className="text-red-600 dark:text-red-400 text-sm">{error}</p>;
  if (!data) return <p className="text-gray-500 text-sm">{ts("loading")}</p>;

  const obligations = data.obligations || [];
  const notes = data.notes || [];
  const hasJobType = obligations.some((o) => o.jobType);
  const workDates = obligations.map((o) => (o.workDate ? String(o.workDate).slice(0, 10) : "")).filter(Boolean).sort();

  // Los mismos renglones y el mismo orden que el comprobante público: lo que vale cero no se dibuja.
  const terms = [
    { k: "commission", label: t("columns.commission"), v: data.grossAmount, sign: "", always: true },
    { k: "bonus", label: ts("term.bonus"), v: data.bonus, sign: "+", note: data.bonusReason, items: data.bonusItems || [] },
    { k: "deductions", label: ts("term.deductions"), v: data.deductions, sign: "−" },
    { k: "creditNotes", label: ts("term.creditNotes"), v: data.creditNotesTotal, sign: "−" },
    { k: "debitNotes", label: ts("term.debitNotes"), v: data.debitNotesTotal, sign: "+" },
  ].filter((x) => x.always || Number(x.v || 0) !== 0);

  return (
    <div className="max-w-3xl">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4 print:hidden">
        <Link href="/dashboard/payments" className="text-sm text-blue-600 dark:text-blue-400 hover:underline">{t("payments.backToList")}</Link>
        <button type="button" onClick={() => window.print()} className="bg-gray-900 hover:bg-gray-800 text-white rounded-lg px-4 py-2 text-sm transition-colors">
          {t("payments.print")}
        </button>
      </div>

      <div className="bg-white dark:bg-gray-900 dark:border dark:border-gray-800 rounded-xl shadow-sm p-6 print:shadow-none print:p-0">
        <style>{"@page { margin: 14mm }"}</style>

        <div className="flex items-start gap-4 mb-6 border-b-2 border-gray-900 dark:border-gray-200 pb-4">
          <img src="/logo-print.png" alt="Reyes Auto Glass Group" className="w-20 h-auto" />
          <div className="flex-1">
            <div className="font-bold dark:text-gray-100">Reyes Auto Glass Group</div>
            <div className="text-xs text-gray-500">info@reyesautoglassgroup.com</div>
          </div>
          <div className="text-right">
            <h1 className="text-xl font-semibold tracking-tight dark:text-gray-100">{ts("title")}</h1>
            <div className="text-xs text-gray-500">{data.paymentNumber || ts("noNumberYet")}</div>
            <span className={`inline-block mt-1 text-[10px] font-bold uppercase tracking-wider rounded-full px-2 py-1 ${STATUS_TONE[data.status] || STATUS_TONE.Pending}`}>
              {tp(`statuses.${data.status}`)}
            </span>
            <div className="text-xs text-gray-500 mt-1">{data.paymentDate || "—"}</div>
            {data.paymentMethod && <div className="text-xs text-gray-500">{data.paymentMethod}</div>}
          </div>
        </div>

        <div className="flex flex-wrap justify-between items-end gap-2 mb-6">
          <div>
            <span className="block text-[10px] uppercase tracking-wider text-gray-400">{ts("paidTo")}</span>
            <b className="text-base dark:text-gray-100">{(data.parties || []).join(", ") || "—"}</b>
          </div>
          {workDates.length > 0 && (
            <span className="text-xs text-gray-500">
              {ts("periodSummary", { count: obligations.length, from: workDates[0], to: workDates[workDates.length - 1] })}
            </span>
          )}
        </div>

        <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500 mb-3">{ts("workOrders", { count: obligations.length })}</h2>
        {obligations.length === 0 ? (
          <p className="text-sm text-gray-400 mb-8">{t("payments.noJobs")}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm mb-8">
              <thead>
                <tr className="text-left border-b text-xs text-gray-400 uppercase">
                  <th className="py-2 pr-3">{tp("workOrder")}</th>
                  <th className="py-2 pr-3">{tp("customer")}</th>
                  {hasJobType && <th className="py-2 pr-3">{tp("jobType")}</th>}
                  <th className="py-2 pr-3">{tp("workDate")}</th>
                  <th className="py-2 text-right">{ts("amount")}</th>
                </tr>
              </thead>
              <tbody>
                {obligations.map((o, i) => (
                  <tr key={i} className="border-b last:border-0 dark:border-gray-800">
                    <td className="py-2 pr-3 font-medium dark:text-gray-100">{o.workOrderNo || "—"}</td>
                    <td className="py-2 pr-3">
                      <div className="dark:text-gray-200">{o.customerName || "—"}</div>
                      {o.vehicle && <div className="text-xs text-gray-400">{o.vehicle}</div>}
                    </td>
                    {hasJobType && <td className="py-2 pr-3 text-xs text-gray-500">{o.jobType || "—"}</td>}
                    <td className="py-2 pr-3 whitespace-nowrap dark:text-gray-300">{o.workDate ? String(o.workDate).slice(0, 10) : "—"}</td>
                    <td className="py-2 text-right tabular-nums dark:text-gray-100">{money(o.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {notes.length > 0 && (
          <>
            <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500 mb-3">{ts("notesSection")}</h2>
            <table className="w-full text-sm mb-8">
              <thead>
                <tr className="text-left border-b text-xs text-gray-400 uppercase">
                  <th className="py-2 pr-3">{ts("note")}</th>
                  <th className="py-2 pr-3">{ts("reason")}</th>
                  <th className="py-2 text-right">{ts("amount")}</th>
                </tr>
              </thead>
              <tbody>
                {notes.map((n, i) => (
                  <tr key={i} className="border-b last:border-0 dark:border-gray-800">
                    <td className="py-2 pr-3 dark:text-gray-100">{n.noteNumber}</td>
                    <td className="py-2 pr-3 text-xs text-gray-500">{n.reason || "—"}</td>
                    <td className="py-2 text-right tabular-nums dark:text-gray-100">{n.noteType === "CREDIT" || n.chargedHere ? "− " : "+ "}{money(n.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}

        <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500 mb-3">{t("payments.breakdown")}</h2>
        <div className="max-w-sm ml-auto text-sm">
          {terms.map((x) => (
            <Fragment key={x.k}>
              <div className="flex justify-between gap-3 py-1.5 border-b last:border-0 dark:border-gray-800">
                <span className="text-gray-500">
                  <span className="inline-block w-3">{x.sign}</span> {x.label}
                  {x.note && <span className="block text-xs text-gray-400 ml-3">{x.note}</span>}
                </span>
                <span className="tabular-nums dark:text-gray-100">{money(x.v)}</span>
              </div>
              {(x.items || []).map((b, i) => (
                <div key={b.id ?? i} className="flex justify-between gap-3 py-1 pl-6 text-xs text-gray-400 border-b last:border-0 dark:border-gray-800">
                  <span>
                    {b.bonusType ? tp(`bonusTypes.${b.bonusType}`) : x.label}
                    {b.note && <span className="block text-gray-400">{b.note}</span>}
                  </span>
                  <span className="tabular-nums whitespace-nowrap">{money(b.amount)}</span>
                </div>
              ))}
            </Fragment>
          ))}
          <div className="flex justify-between pt-3 mt-1 font-semibold text-base border-t-2 border-gray-900 dark:border-gray-200 dark:text-gray-100">
            <span>{ts("netPaid")}</span>
            <span className="tabular-nums">{money(data.amount)}</span>
          </div>
        </div>

        <p className="text-xs text-gray-400 mt-8 border-t dark:border-gray-800 pt-4">{ts("footer")}</p>
      </div>
    </div>
  );
}
