"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { getPayments } from "@/lib/api";
import { money, Row, Badge } from "@/components/OrderSummaryUI";
import CommissionPlanDetail from "@/components/CommissionPlanDetail";

// La tarjeta "Tu comisión" dentro de la orden, para el agente que la refirió: cuánto le toca y en
// qué lote se le pagó. Va en la misma pantalla de orden que usa la oficina (Antonio, 20-sep-2026:
// misma interfaz que el admin salvo lo "Admin Only"); en una orden de otro agente no aparece.
export default function AgentCommissionCard({ wo }) {
  const t = useTranslations("agentPortal");
  const [payments, setPayments] = useState([]);

  useEffect(() => {
    getPayments().then(setPayments).catch(() => setPayments([]));
  }, []);

  if (wo.isMine === false) return null;

  const commission = Number(wo.agentCommission || 0);
  const paidIn = payments.find((p) => p.status === "Paid" && (p.workOrderIds || []).includes(wo.workOrderNo));

  return (
    <section className="bg-white dark:bg-gray-900 dark:border dark:border-gray-800 rounded-xl shadow-sm p-4">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-3">{t("workOrder.yourCommission")}</h3>
      {commission > 0 ? (
        <div className="space-y-1.5 text-sm">
          <div className="flex items-center justify-between mb-2">
            <span className="text-2xl font-bold dark:text-gray-100 tabular-nums">{money(commission)}</span>
            <Badge tone={paidIn ? "paid" : "pending"}>
              {paidIn ? t("workOrder.commissionPaidIn", { paymentNumber: paidIn.paymentNumber, date: paidIn.paymentDate || "" }) : t("workOrder.commissionPending")}
            </Badge>
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
      {/* Cómo se calcula con su plan, o cuánto ganaría cuando el cliente pague. */}
      <CommissionPlanDetail workOrderId={wo.id} refreshKey={`${commission}|${wo.updatedAt}`} />
    </section>
  );
}
