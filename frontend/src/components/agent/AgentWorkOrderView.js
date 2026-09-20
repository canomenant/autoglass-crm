"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { getPayments } from "@/lib/api";
import { money, Row, Badge } from "@/components/OrderSummaryUI";
import WorkOrderOperationsDashboard from "@/components/WorkOrderOperationsDashboard";
import WorkOrderSummaryPanel from "@/components/WorkOrderSummaryPanel";

// La orden vista por el agente que la refirió. Antes le salía la pantalla de operaciones de la
// oficina entera: asignar técnico (con el catálogo en 403), notas internas, vender el lead, cobrar
// tarjeta, dar por incobrable, el historial de quién cobró. Nada de eso es suyo. Lo que sí le
// importa: en qué va el trabajo, si el cliente ya pagó, y cuánto y cuándo le toca de comisión.
//
// Sólo lectura a propósito. Lo que el agente edita (precio, cliente, cita) vive en la cotización,
// que sigue siendo suya y se abre desde aquí.
export default function AgentWorkOrderView({ wo, quote }) {
  const t = useTranslations("agentPortal");
  const [payments, setPayments] = useState([]);

  useEffect(() => {
    getPayments().then(setPayments).catch(() => setPayments([]));
  }, []);

  const mine = wo.isMine !== false;
  const commission = Number(wo.agentCommission || 0);
  const paidIn = payments.find((p) => p.status === "Paid" && (p.workOrderIds || []).includes(wo.workOrderNo));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold dark:text-gray-100 tracking-tight">
            {wo.workOrderNo} <span className="text-sm text-gray-500">({wo.quoteNo})</span>
          </h1>
          <p className="text-sm text-slate-500 dark:text-gray-400 mt-1">{mine ? t("workOrder.readOnlyHint") : t("workOrder.otherAgent", { agent: wo.agentName || "—" })}</p>
        </div>
        {mine && wo.quoteId && (
          <Link href={`/dashboard/quotes/${wo.quoteId}`} className="bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors px-4 py-2 text-sm font-medium">
            {t("workOrder.editQuote")}
          </Link>
        )}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[1fr_340px] gap-6 items-start">
        <div className="space-y-6 min-w-0">
          <WorkOrderOperationsDashboard wo={wo} quote={quote} role="AGENT" onChange={() => {}} />

          {mine && (
          <section className="bg-white dark:bg-gray-900 dark:border dark:border-gray-800 rounded-xl shadow-sm p-4">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-3">{t("workOrder.yourCommission")}</h3>
            {commission > 0 ? (
              <div className="space-y-1.5 text-sm">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-2xl font-bold dark:text-gray-100 tabular-nums">{money(commission)}</span>
                  <Badge tone={paidIn ? "paid" : "pending"}>{paidIn ? t("workOrder.commissionPaidIn", { paymentNumber: paidIn.paymentNumber, date: paidIn.paymentDate || "" }) : t("workOrder.commissionPending")}</Badge>
                </div>
                <Row label={t("workOrder.commissionAmount")} value={money(commission)} />
                {paidIn && (
                  <Row
                    label={t("columns.payment")}
                    value={<Link href={`/dashboard/payments/${paidIn.id}`} className="text-blue-600 dark:text-blue-400 hover:underline">{paidIn.paymentNumber}</Link>}
                  />
                )}
              </div>
            ) : (
              <p className="text-sm text-gray-400 dark:text-gray-500">{t("workOrder.commissionNone")}</p>
            )}
          </section>
          )}

          {wo.specialInstructions && (
            <section className="bg-white dark:bg-gray-900 dark:border dark:border-gray-800 rounded-xl shadow-sm p-4">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-2">{t("workOrder.specialInstructions")}</h3>
              <p className="text-sm text-slate-700 dark:text-gray-200 whitespace-pre-wrap">{wo.specialInstructions}</p>
            </section>
          )}
        </div>

        <WorkOrderSummaryPanel wo={wo} quote={quote} />
      </div>
    </div>
  );
}
