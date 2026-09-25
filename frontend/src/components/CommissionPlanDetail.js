"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { getWorkOrderCommission } from "@/lib/api";
import { money } from "./OrderSummaryUI";

// De dónde salió la comisión del agente en esta orden (backend lib/agentCommission): calculada por
// el plan, estimada (aún no se paga), tecleada a mano, o por qué el plan no la toca. Con el
// desglose por vidrio, para que "$65" nunca sea un número mudo.
//
// `refreshKey` cambia cuando la orden se guarda (comisión, pago), y con él se vuelve a pedir.
// `onBackToPlan` solo lo pasa el admin: quita la marca de "manual".
export default function CommissionPlanDetail({ workOrderId, refreshKey, onBackToPlan }) {
  const t = useTranslations("commissionPlan");
  const [info, setInfo] = useState(null);

  useEffect(() => {
    if (!workOrderId) return;
    getWorkOrderCommission(workOrderId).then(setInfo).catch(() => setInfo(null));
  }, [workOrderId, refreshKey]);

  if (!info) return null;

  const lines = info.source === "plan" ? info.detail?.lines || [] : info.plan?.lines || [];
  const versionFrom = info.source === "plan" ? info.detail?.versionFrom : info.plan?.versionFrom;

  let headline;
  if (info.source === "plan") headline = t(info.detail?.payMode === "cash" ? "wo.byPlanCash" : "wo.byPlan", { date: versionFrom });
  else if (info.reason === "manual") headline = t("wo.manual");
  else if (info.reason === "legacy") headline = t("wo.legacy");
  else if (info.reason === "paidBeforePlans") headline = t("wo.paidBeforePlans");
  else if (info.reason === "noPlan") headline = t("wo.noPlan");
  else if (info.reason === "noAgent") headline = null;
  else if (info.estimated && info.plan) {
    headline =
      info.planIfCash && info.planIfCash.amount !== info.plan.amount
        ? t("wo.estimatedBoth", { amount: money(info.plan.amount), cash: money(info.planIfCash.amount) })
        : t("wo.estimated", { amount: money(info.plan.amount) });
  }

  if (!headline) return null;

  return (
    <div className="mt-2 rounded-lg bg-gray-50 dark:bg-gray-800/60 p-2.5 text-xs space-y-1.5">
      <p className="text-gray-700 dark:text-gray-200">{headline}</p>
      {lines.length > 0 && (info.source === "plan" || info.estimated) && (
        <ul className="space-y-0.5">
          {lines.map((l, i) => (
            <li key={i} className="flex justify-between gap-2 text-gray-600 dark:text-gray-300">
              <span className="truncate">
                {l.label}
                {l.priceTier ? ` · ${l.priceTier}` : l.kind === "noTier" ? ` · ${t("noTier")}` : l.kind === "service" ? ` · ${t("services")}` : ""}
                {l.type === "Percentage" ? ` (${l.value}% × ${money(l.base)})` : ""}
              </span>
              <span className="tabular-nums">{money(l.amount)}</span>
            </li>
          ))}
        </ul>
      )}
      {info.reason === "manual" && info.plan && (
        <div className="flex items-center justify-between gap-2">
          <span className="text-gray-600 dark:text-gray-300">{t("wo.planWouldSay", { amount: money(info.plan.amount) })}</span>
          {onBackToPlan && (
            <button type="button" onClick={onBackToPlan} className="text-blue-600 dark:text-blue-400 hover:underline whitespace-nowrap">
              {t("wo.backToPlan")}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
