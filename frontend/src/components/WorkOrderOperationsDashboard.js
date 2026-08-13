"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { getAgent } from "@/lib/api";
import { WORK_ORDER_FLOW_STATUSES } from "@/lib/workOrderStatuses";
import { STATUS_COLORS } from "@/lib/workOrderStatusColors";
import { Badge, Row, money } from "./OrderSummaryUI";

const STEPS = ["Approved", ...WORK_ORDER_FLOW_STATUSES];

function StatusTracker({ wo }) {
  const tq = useTranslations("quotes");
  const tw = useTranslations("workOrders");
  const to = useTranslations("operationsDashboard");

  function labelFor(step) {
    return step === "Approved" ? tq("statuses.Approved") : tw(`statuses.${step}`);
  }

  if (wo.status === "Cancelled") {
    return (
      <div className="bg-white dark:bg-gray-900 dark:border dark:border-gray-800 rounded-xl shadow-sm p-4">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-4">{to("statusTracker")}</h2>
        <div className="flex items-center gap-3 rounded-lg p-3" style={{ backgroundColor: `${STATUS_COLORS.Cancelled}1a` }}>
          <span className="w-4 h-4 rounded-full flex-shrink-0" style={{ backgroundColor: STATUS_COLORS.Cancelled }} />
          <div>
            <div className="font-semibold" style={{ color: STATUS_COLORS.Cancelled }}>{tw("statuses.Cancelled")}</div>
            {wo.cancellationReason && (
              <div className="text-xs text-gray-500 dark:text-gray-400">
                {tw(`cancellationReasons.${wo.cancellationReason}`)}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  const currentIndex = 1 + Math.max(0, WORK_ORDER_FLOW_STATUSES.indexOf(wo.status));

  return (
    <div className="bg-white dark:bg-gray-900 dark:border dark:border-gray-800 rounded-xl shadow-sm p-4 overflow-x-auto">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-4">{to("statusTracker")}</h2>
      <div className="flex items-center min-w-[640px]">
        {STEPS.map((step, i) => {
          const reached = i <= currentIndex;
          const color = reached ? STATUS_COLORS[step] : "#d1d5db";
          return (
            <div key={step} className="flex items-center flex-1 last:flex-none">
              <div className="flex flex-col items-center gap-1.5 flex-shrink-0">
                <span className="w-4 h-4 rounded-full" style={{ backgroundColor: color }} />
                <span className={`text-[11px] whitespace-nowrap ${reached ? "font-semibold" : "text-gray-400 dark:text-gray-500"}`} style={reached ? { color } : undefined}>
                  {labelFor(step)}
                </span>
              </div>
              {i < STEPS.length - 1 && (
                <div className="flex-1 h-0.5 mx-1" style={{ backgroundColor: i < currentIndex ? STATUS_COLORS[STEPS[i + 1]] : "#e5e7eb" }} />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Card({ title, children }) {
  return (
    <div className="bg-white dark:bg-gray-900 dark:border dark:border-gray-800 rounded-xl shadow-sm p-4">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-3">{title}</h3>
      <div className="space-y-1.5 text-sm">{children}</div>
    </div>
  );
}

function PaymentPanel({ wo, t }) {
  const totalSale = Number(wo.totalSale || 0);
  const paidAmount = Number(wo.payment?.amount || 0);
  const balanceDue = totalSale - paidAmount;
  const paid = !!wo.payment?.paid;
  const status = paid ? t("paidInFull") : paidAmount > 0 ? t("partial") : t("unpaid");
  const tone = paid ? "paid" : paidAmount > 0 ? "pending" : "outstanding";

  return (
    <Card title={t("paymentPanel")}>
      <div className="flex items-center justify-between mb-2">
        <span className="text-2xl font-bold dark:text-gray-100">{money(totalSale)}</span>
        <Badge tone={tone}>{status}</Badge>
      </div>
      <Row label={t("amountPaid")} value={money(paidAmount)} />
      <Row label={t("balanceDue")} value={money(balanceDue)} emphasis tone={balanceDue > 0 ? "outstanding" : "paid"} />
    </Card>
  );
}

function TechnicianPanel({ wo, quote, t, tw }) {
  const isInsurance = quote?.paymentType === "Insurance";
  const laborHours = isInsurance ? quote?.insurance?.nagsLaborHour : null;
  const laborRate = isInsurance ? quote?.insurance?.priceForHour : null;

  return (
    <Card title={t("technicianPanel")}>
      <Row label={t("assignedTechnician")} value={wo.tech || tw("unassigned")} emphasis />
      <Row label={t("appointmentDate")} value={wo.appointmentDate || tw("notScheduled")} />
      <Row label={t("laborHours")} value={laborHours ?? t("notTracked")} />
      <Row label={t("laborRate")} value={laborRate ? money(laborRate) : t("notTracked")} />
      <Row label={t("technicianPay")} value={t("notTracked")} />
      <Row label={t("jobStatus")} value={tw(`statuses.${wo.status}`)} />
    </Card>
  );
}

function AgentPanel({ wo, quote, agent, t }) {
  if (!quote?.agentName) {
    return (
      <Card title={t("agentPanel")}>
        <p className="text-gray-400 dark:text-gray-500 text-sm">{t("noReferralAgent")}</p>
      </Card>
    );
  }
  return (
    <Card title={t("agentPanel")}>
      <Row label={t("referralAgent")} value={quote.agentName} emphasis />
      <Row label={t("commissionType")} value={agent ? t(`commissionTypes.${agent.commissionType}`) : t("notTracked")} />
      <Row label={t("commissionAmount")} value={money(wo.commission)} />
      <Row label={t("commissionStatus")} value={t("commissionEligible")} />
    </Card>
  );
}

function DistributorPanel({ wo, quote, t }) {
  const distributorNames = [...new Set((quote?.lineItems || []).map((li) => li.distributor).filter(Boolean))];
  const distributorName = wo.distributor || distributorNames[0] || "";

  if (!distributorName) {
    return (
      <Card title={t("distributorPanel")}>
        <p className="text-gray-400 dark:text-gray-500 text-sm">{t("noDistributor")}</p>
      </Card>
    );
  }
  return (
    <Card title={t("distributorPanel")}>
      <Row label={t("distributor")} value={distributorName} emphasis />
      <Row label={t("partCost")} value={money(wo.glassCost)} />
      <Row label={t("invoiceNumber")} value={t("notTracked")} />
      <Row label={t("paymentStatus")} value={t("notTracked")} />
    </Card>
  );
}

function AdminPanel({ wo, quote, t }) {
  const revenue = Number(wo.totalSale || 0);
  const partCost = Number(wo.glassCost || 0);
  const distributorCost = Number(wo.glassCost || 0);
  const grossProfit = revenue - partCost;
  const margin = revenue ? (grossProfit / revenue) * 100 : 0;

  return (
    <div className="bg-white dark:bg-gray-900 dark:border dark:border-gray-800 rounded-xl shadow-sm p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-400">{t("adminPanel")}</h3>
        <Badge tone="info">{t("adminOnly")}</Badge>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-1.5 text-sm">
        <Row label={t("revenue")} value={money(revenue)} />
        <Row label={t("partCost")} value={money(partCost)} />
        <Row label={t("distributorCost")} value={money(distributorCost)} />
        <Row label={t("grossProfit")} value={money(grossProfit)} emphasis tone={grossProfit >= 0 ? "paid" : "outstanding"} />
        <Row label={t("profitMargin")} value={`${margin.toFixed(1)}%`} emphasis />
      </div>
      <div className="border-t dark:border-gray-800 mt-3 pt-3 grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-1.5 text-sm">
        <Row label={t("agentCommission")} value={money(wo.commission)} />
        <Row label={t("technicianLabor")} value={money(wo.laborCost)} />
        <Row label={t("technicianPay")} value={t("notTracked")} />
        <Row label={t("distributorPayable")} value={t("notTracked")} />
      </div>
    </div>
  );
}

export default function WorkOrderOperationsDashboard({ wo, quote, role }) {
  const t = useTranslations("operationsDashboard");
  const tw = useTranslations("workOrders");
  const isAdmin = role === "ADMIN";
  const [agent, setAgent] = useState(null);

  useEffect(() => {
    if (isAdmin && quote?.agentId) {
      getAgent(quote.agentId).then(setAgent).catch(() => setAgent(null));
    } else {
      setAgent(null);
    }
  }, [isAdmin, quote?.agentId]);

  return (
    <div className="space-y-6">
      <StatusTracker wo={wo} />

      <PaymentPanel wo={wo} t={t} />

      {isAdmin && (
        <>
          <AdminPanel wo={wo} quote={quote} t={t} />

          <div>
            <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-3">{t("adminOperations")}</h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <TechnicianPanel wo={wo} quote={quote} t={t} tw={tw} />
              <AgentPanel wo={wo} quote={quote} agent={agent} t={t} />
              <DistributorPanel wo={wo} quote={quote} t={t} />
            </div>
          </div>
        </>
      )}
    </div>
  );
}
