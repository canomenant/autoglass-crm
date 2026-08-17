// Per-work-order revenue/cost/tax math, shared between /reports/profit-loss (single aggregate
// total) and /reports/profit-loss-matrix (same numbers, bucketed by month/state). Extracted
// verbatim from the original inline logic in reports.routes.js — keeping this the only place
// that computes these figures is what guarantees the two endpoints can never disagree.

// "parts"/"calibration"/"deductibles" come from the linked Quote's computed totals (what was
// quoted for that portion of the job); "other" is whatever's left of the amount actually paid —
// a deliberate plug, not a tracked category, since the business doesn't record revenue by line
// item at payment time. Guarantees the 4 categories always sum to exactly `amount`.
function computeRevenueComponents(workOrder, quote) {
  const amount = Number(workOrder.payment?.amount || 0);
  const parts = Number(quote?.totals?.subtotalParts || 0);
  const calibration = Number(quote?.totals?.subtotalServices || 0);
  const deductibles = Number(quote?.totals?.customerResponsibility || 0);
  const other = amount - parts - calibration - deductibles;
  return { amount, parts, calibration, deductibles, other };
}

// Direct per-work-order costs, counted regardless of payment status — a cost is incurred once
// the job is done, not once the customer settles.
function computeCostComponents(workOrder) {
  return {
    glass: Number(workOrder.glassCost || 0),
    commission: Number(workOrder.commission || 0),
    labor: Number(workOrder.laborCost || 0),
  };
}

// quote.totals.taxAmount is already computed by quotes.store.js#computeTotals() from the
// quote's snapshotted taxRate — this just reads it, it doesn't recompute anything.
function computeTaxAmount(quote) {
  return Number(quote?.totals?.taxAmount || 0);
}

module.exports = { computeRevenueComponents, computeCostComponents, computeTaxAmount };
