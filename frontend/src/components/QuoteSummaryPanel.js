"use client";

import { useTranslations } from "next-intl";
import { getCurrentUser } from "@/lib/api";
import CurrencyInput from "./CurrencyInput";
import { Badge, TotalCard, Section, Row, Empty, money } from "./OrderSummaryUI";

export default function QuoteSummaryPanel({ form, totals, displayCustomerName, vehicleSummary, insuranceCompanyName, onFinalSalePriceChange }) {
  const t = useTranslations("orderSummary");
  const tq = useTranslations("quoteForm");
  const tc = useTranslations("common");
  const isAdmin = getCurrentUser()?.role === "ADMIN";
  const isInsurance = form.paymentType === "Insurance";

  // Revenue is what we actually sell the job for, upsell included — not the bare computed total.
  const revenue = totals.finalSalePrice;
  // Derived from the line items, not the vestigial form.glassCost (which has no input anywhere
  // in the UI and is therefore always 0). "Distributor Cost" used to be displayed next to this
  // reading the exact same value — removed rather than shown twice, since a quote can carry line
  // items from several distributors and one scalar can't represent that. The distributor names
  // live in the Work Order's own Distributor panel.
  const partCost = totals.partCost;
  const grossProfit = totals.grossProfit;
  const margin = totals.profitMargin;

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

          {/* What the job actually sold for. Stored as `upsell` (final price minus computed
              total) — the same column the 2,897 historical records use — so no schema change. */}
          <div className="border-t dark:border-gray-800 pt-3 mt-3">
            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">{tq("finalSalePrice")}</label>
            <CurrencyInput value={totals.finalSalePrice} onChange={onFinalSalePriceChange} />
            {/* Always rendered, including at exactly $0.00 — a row that only appears once the
                number is non-zero is indistinguishable from a broken one. Sold-below-estimate is
                a real case, so it shows signed and in red rather than being hidden. */}
            <div className="mt-2">
              <Row
                label={tq("upsell")}
                // Sign goes outside the currency symbol ("-$15.11", not "$-15.11") — money()
                // formats the number itself, so negatives are handled here rather than by it.
                value={`${totals.upsell > 0 ? "+" : totals.upsell < 0 ? "-" : ""}${money(Math.abs(totals.upsell))}`}
                tone={totals.upsell > 0 ? "paid" : totals.upsell < 0 ? "outstanding" : undefined}
                emphasis
              />
            </div>
          </div>
        </Section>
      )}

      {isAdmin && (
        <Section title={t("profitSummary")} action={<Badge tone="info">{t("adminOnly")}</Badge>}>
          <Row label={t("revenue")} value={money(revenue)} />
          <Row label={t("partCost")} value={money(partCost)} />
          <Row label={t("grossProfit")} value={money(grossProfit)} emphasis tone={grossProfit >= 0 ? "paid" : "outstanding"} />
          <Row label={t("profitMargin")} value={`${margin.toFixed(1)}%`} />
          {/* Agent commission and technician labor are entered on the work order, not here, so
              this margin is before those two costs — the Work Order panel subtracts them. */}
        </Section>
      )}
    </div>
  );
}
