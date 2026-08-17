"use client";

import { useTranslations } from "next-intl";
import { getCurrentUser } from "@/lib/api";
import { Badge, TotalCard, Section, Row, Empty, money } from "./OrderSummaryUI";

export default function QuoteSummaryPanel({ form, totals, displayCustomerName, vehicleSummary, insuranceCompanyName }) {
  const t = useTranslations("orderSummary");
  const tq = useTranslations("quoteForm");
  const tc = useTranslations("common");
  const isAdmin = getCurrentUser()?.role === "ADMIN";
  const isInsurance = form.paymentType === "Insurance";

  const revenue = totals.totalAmount;

  // Only one real cost figure exists on a Quote today (Glass Cost). Part Cost and Distributor
  // Cost are shown as separate admin-facing labels but reflect that same tracked value, so it
  // is only subtracted once in the profit calculation below.
  const partCost = Number(form.glassCost || 0);
  const distributorCost = Number(form.glassCost || 0);
  const grossProfit = revenue - partCost;
  const margin = revenue ? (grossProfit / revenue) * 100 : 0;

  return (
    <div className="bg-white dark:bg-gray-900 dark:border dark:border-gray-800 rounded-xl shadow-sm p-4">
      <TotalCard
        label={isInsurance ? t("totalClaimValue") : t("totalEstimate")}
        amount={revenue}
        tone={isInsurance ? "paid" : "info"}
      />

      <Section title={t("customerInformation")}>
        {displayCustomerName ? (
          <>
            <Row label={tc("name")} value={displayCustomerName} emphasis />
            {form.customerType === "New" && form.newCustomer?.phone && <Row label={tc("phone")} value={form.newCustomer.phone} />}
            {form.customerType === "New" && form.newCustomer?.email && <Row label={tc("email")} value={form.newCustomer.email} />}
            {form.customerType === "New" && form.newCustomer?.address && <Row label={tc("address")} value={form.newCustomer.address} />}
          </>
        ) : (
          <Empty>{t("noCustomer")}</Empty>
        )}
      </Section>

      <Section title={t("vehicleInformation")}>
        {vehicleSummary ? (
          <>
            <Row label={tc("vehicleTitle")} value={vehicleSummary} emphasis />
            {form.vehicle?.bodyType && <Row label={tc("bodyType")} value={form.vehicle.bodyType} />}
            {form.vehicle?.vin && <Row label={tc("vin")} value={form.vehicle.vin} />}
            {form.vehicle?.plate && <Row label={tc("plate")} value={form.vehicle.plate} />}
          </>
        ) : (
          <Empty>{t("noVehicle")}</Empty>
        )}
      </Section>

      <Section title={t("partsAndServices")}>
        {form.lineItems?.length > 0 ? (
          <>
            {form.lineItems.map((li) => (
              <Row key={li.id} label={li.jobType || li.nagsDescription || tq("jobType")} value={money(li.pricePart)} />
            ))}
            <Row label={t("itemCount", { count: form.lineItems.length })} value={money(totals.subtotalParts)} emphasis />
          </>
        ) : (
          <Empty>{t("noItems")}</Empty>
        )}
      </Section>

      {isInsurance ? (
        <>
          <Section title={t("insuranceInformation")}>
            <Row label={tq("insuranceCompany")} value={insuranceCompanyName || "—"} />
            <Row label={tq("policyNumber")} value={form.policyNumber || "—"} />
            <Row label={tq("claimNumber")} value={form.claimNumber || "—"} />
          </Section>

          <Section title={t("nagsSummary")}>
            <Row label={tq("listPrice")} value={money(form.insurance?.listPrice)} />
            <Row label={tq("nagsRate")} value={`${form.insurance?.nagsRate || 0}%`} />
            <Row label={tq("pricePartInsurance")} value={money(totals.pricePartInsurance)} />
            <Row label={t("laborHours")} value={form.insurance?.nagsLaborHour || 0} />
            <Row label={tq("totalLabor")} value={money(totals.laborTotal)} />
            <Row label={tq("flatRateKit")} value={money(totals.flatRateKit)} />
            <Row label={t("calibration")} value={money(totals.subtotalServices)} />
          </Section>

          <Section title={t("insuranceSettlement")}>
            <Row label={t("claimTotal")} value={money(totals.claimTotalBeforeAdjustment)} />
            {totals.insuranceAdjustmentAmount !== 0 && (
              <Row label={tq("insuranceAdjustmentSection")} value={money(totals.insuranceAdjustmentAmount)} />
            )}
            {form.invoiceMode === "itemized" && (
              <Row label={`${tq("taxRate")} (${form.taxRate || 0}%)`} value={money(totals.taxAmount)} />
            )}
            <Row label={tq("deductible")} value={money(totals.deductible)} />
            <Row label={t("insuranceResponsibility")} value={money(totals.insuranceResponsibility)} tone="paid" />
            <Row label={t("customerResponsibility")} value={money(totals.customerResponsibility)} tone={totals.customerResponsibility > 0 ? "outstanding" : undefined} />
          </Section>

          <Section title={t("totalClaimValue")}>
            <Row label={t("totalClaimValue")} value={money(totals.totalClaimValue)} emphasis />
          </Section>
        </>
      ) : (
        <Section title={t("financialSummary")}>
          <Row label={t("partPrice")} value={money(totals.nonLaborPartsTotal)} />
          <Row label={t("calibration")} value={money(totals.subtotalServices)} />
          <Row label={tq("priceTier")} value={money(totals.priceTierTotal)} />
          {totals.laborLineItemTotal > 0 && <Row label={t("labor")} value={money(totals.laborLineItemTotal)} />}
          <Row label={tq("longTrip")} value={money(totals.longTripFee)} />
          {totals.discountAmount > 0 && (
            <Row
              label={t("discount")}
              value={
                <span className="inline-flex items-center gap-2">
                  {`-${money(totals.discountAmount)}`}
                  {form.discount?.reason === "Manager Approval" && <Badge tone="pending">{t("pendingApproval")}</Badge>}
                </span>
              }
              tone="outstanding"
            />
          )}
          <Row label={t("subtotal")} value={money(totals.subtotal)} />
          <Row
            label={
              <span className="inline-flex items-center gap-2">
                {`${tq("taxRate")} (${form.taxRate || 0}%)`}
                {form.invoiceMode === "itemized" && <Badge tone="info">{tq("invoiceModes.itemized")}</Badge>}
              </span>
            }
            value={money(totals.taxAmount)}
          />
          <Row label={tq("totalAmount")} value={money(totals.personalTotal)} emphasis />
          <Row label={tq("customerSuggestedPrice")} value={money(form.customerSuggestedPrice)} />
        </Section>
      )}

      {isAdmin && (
        <Section title={t("profitSummary")} action={<Badge tone="info">{t("adminOnly")}</Badge>}>
          <Row label={t("revenue")} value={money(revenue)} />
          <Row label={t("partCost")} value={money(partCost)} />
          <Row label={t("distributorCost")} value={money(distributorCost)} />
          <Row label={t("grossProfit")} value={money(grossProfit)} emphasis tone={grossProfit >= 0 ? "paid" : "outstanding"} />
          <Row label={t("profitMargin")} value={`${margin.toFixed(1)}%`} />
        </Section>
      )}
    </div>
  );
}
