"use client";

import { useTranslations } from "next-intl";
import { getStatusColor } from "@/lib/workOrderStatusColors";
import { Section, Row, Empty } from "./OrderSummaryUI";

export default function WorkOrderSummaryPanel({ wo, quote }) {
  const t = useTranslations("orderSummary");
  const tw = useTranslations("workOrders");
  const tc = useTranslations("common");

  return (
    <div className="bg-white dark:bg-gray-900 dark:border dark:border-gray-800 rounded-xl shadow-sm p-4">
      <Section title={t("workOrderStatus")}>
        <div className="flex items-center gap-2">
          <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: getStatusColor(wo) }} />
          <span className="font-semibold">{tw(`statuses.${wo.status}`)}</span>
        </div>
        <Row label={tw("woNo")} value={wo.workOrderNo} />
        {quote?.quoteNo && <Row label={t("quoteNumber")} value={quote.quoteNo} />}
      </Section>

      <Section title={t("customerInformation")}>
        {wo.customerName ? (
          <>
            <Row label={tc("name")} value={wo.customerName} emphasis />
            {wo.phone && <Row label={tc("phone")} value={wo.phone} />}
            {wo.email && <Row label={tc("email")} value={wo.email} />}
            {wo.address && <Row label={tc("address")} value={wo.address} />}
          </>
        ) : (
          <Empty>{t("noCustomer")}</Empty>
        )}
      </Section>

      <Section title={t("vehicleInformation")}>
        {wo.vehicle?.year || wo.vehicle?.make || wo.vehicle?.model ? (
          <>
            <Row label={tc("vehicleTitle")} value={[wo.vehicle?.year, wo.vehicle?.make, wo.vehicle?.model].filter(Boolean).join(" ")} emphasis />
            {wo.vehicle?.bodyType && <Row label={tc("bodyType")} value={wo.vehicle.bodyType} />}
            {wo.vehicle?.vin && <Row label={tc("vin")} value={wo.vehicle.vin} />}
            {wo.vehicle?.plate && <Row label={tc("plate")} value={wo.vehicle.plate} />}
          </>
        ) : (
          <Empty>{t("noVehicle")}</Empty>
        )}
      </Section>

      <Section title={t("scheduling")}>
        <Row label={t("appointment")} value={wo.appointmentDate ? [wo.appointmentDate, wo.appointmentTime].filter(Boolean).join(" ") : t("notScheduled")} />
        <Row label={t("technician")} value={wo.tech || t("unassigned")} />
      </Section>
    </div>
  );
}
