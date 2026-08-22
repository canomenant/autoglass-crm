// Per-work-order revenue/cost/tax math, shared between /reports/profit-loss (single aggregate
// total) and /reports/profit-loss-matrix (same numbers, bucketed by month/state). Extracted
// verbatim from the original inline logic in reports.routes.js — keeping this the only place
// that computes these figures is what guarantees the two endpoints can never disagree.

// "parts"/"calibration"/"deductibles" come from the linked Quote's computed totals (what was
// quoted for that portion of the job); "other" is whatever's left of the amount actually paid —
// a deliberate plug, not a tracked category, since the business doesn't record revenue by line
// item at payment time. Guarantees the 4 categories always sum to exactly `amount`.
//
// KNOWN DEBT — this breakdown is not trustworthy yet; the totals are (see below). Three issues,
// all scheduled for the "Phase B" revenue-snapshot work, none of which affect any total:
//
//  1. 71.8% of revenue ($1,078,870.57 of $1,502,199.13) lands in "other", and the earlier
//     explanation for that — the Price Tier having no category — was wrong. Measured against
//     production: priceTierTotal across every paid quote sums to $750, which is 0.07% of the
//     plug. The field is filled on 4 of 4,341 line items, so it cannot account for anything.
//
//     Adding up everything that IS modelled — price tier, labour line items, tax, long-trip
//     fees, upsell — covers only 19.4% of "other", and most of that is upsell ($171,604) and
//     tax ($36,356). What is left, $869,916.96, is 57.9% of everything ever collected: margin
//     that exists in no field at all. It is the gap between what was charged and the sum of
//     what the quote itemises, and it was never recorded anywhere.
//
//     So Phase B is not "give the Price Tier a category". It is deciding how to classify a
//     margin the data model never captured — and for historical orders, whether it can be
//     reconstructed at all or only ever labelled honestly as unattributed.
//  2. The work order freezes payment.amount, but parts/calibration/deductibles are read live from
//     the quote. Editing a quote after it converted retroactively changes the split and can drive
//     "other" negative — 2 work orders are already in that state (-$190.36). Silent, and it grows
//     with every post-conversion edit.
//  3. quoteById is built from quotesStore.list(), which filters active <> false, so soft-deleting
//     a quote silently orphans its work order: the whole amount drops into "other" with no signal.
//
// The fix is to snapshot the revenue components onto work_orders at conversion/sync (mirroring
// what the cost side already does) so this function reads work-order columns only.
function computeRevenueComponents(workOrder, quote) {
  const amount = Number(workOrder.payment?.amount || 0);
  const parts = Number(quote?.totals?.subtotalParts || 0);
  const calibration = Number(quote?.totals?.subtotalServices || 0);
  const deductibles = Number(quote?.totals?.customerResponsibility || 0);
  const other = amount - parts - calibration - deductibles;
  return { amount, parts, calibration, deductibles, other };
}

// Direct per-work-order costs, counted regardless of payment status — a cost is incurred once
// the job is done, not once the customer settles. Genuinely work-order-only: these three columns
// are written at conversion (glassCost from the line items, commission from the agent suggestion)
// and edited on the order itself, never read back off the quote.
function computeCostComponents(workOrder) {
  return {
    glass: Number(workOrder.glassCost || 0),
    commission: Number(workOrder.commission || 0),
    labor: Number(workOrder.laborCost || 0),
  };
}

module.exports = { computeRevenueComponents, computeCostComponents };
