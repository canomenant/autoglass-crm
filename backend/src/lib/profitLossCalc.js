// Per-work-order revenue/cost/tax math, shared between /reports/profit-loss (single aggregate
// total), /reports/profit-loss-matrix (same numbers, bucketed by month/state) and
// /reports/sales-tax. Extracted verbatim from the original inline logic in reports.routes.js —
// keeping this the only place that computes these figures is what guarantees the endpoints can
// never disagree.

// "parts"/"calibration"/"deductibles" come from the linked Quote's computed totals (what was
// quoted for that portion of the job); "salesTax" is the tax the quote charged the customer (see
// computeSalesTax); "other" is whatever's left of the amount actually paid — a deliberate plug,
// not a tracked category, since the business doesn't record revenue by line item at payment
// time. Guarantees the 5 categories always sum to exactly `amount`.
//
// KNOWN DEBT — this breakdown is not trustworthy yet; the totals are (see below). Three issues,
// all scheduled for the "Phase B" revenue-snapshot work, none of which affect any total:
//
//  1. Most of the revenue lands in "other", and the earlier explanation for that — the Price
//     Tier having no category — was wrong. Measured against production: priceTierTotal across
//     every paid quote sums to $750, which is 0.07% of the plug. The field is filled on 4 of
//     4,341 line items, so it cannot account for anything.
//
//     Adding up everything that IS modelled — price tier, labour line items, tax, long-trip
//     fees, upsell — covers only a fifth of "other", and most of that is upsell and tax (the tax
//     is now split out into its own component, the rest still isn't). What is left is margin
//     that exists in no field at all: the gap between what was charged and the sum of what the
//     quote itemises, and it was never recorded anywhere.
//
//     So Phase B is not "give the Price Tier a category". It is deciding how to classify a
//     margin the data model never captured — and for historical orders, whether it can be
//     reconstructed at all or only ever labelled honestly as unattributed.
//  2. The work order freezes payment.amount, but parts/calibration/deductibles/tax are read live
//     from the quote. Editing a quote after it converted retroactively changes the split and can
//     drive "other" negative — 2 work orders are already in that state (-$190.36). Silent, and
//     it grows with every post-conversion edit.
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
  const salesTax = computeSalesTax(workOrder, quote);
  const other = amount - parts - calibration - deductibles - salesTax;
  return { amount, parts, calibration, deductibles, salesTax, other };
}

// Sales tax the quote charged the customer. It is collected inside payment.amount and owed to the
// state (CA CDTFA / TX Comptroller), so for the P&L it is a pass-through, not revenue: it comes
// off the top before any margin is computed. Antonio, 8-sep-2026: "no veo cuánto pagamos de sales
// tax cada mes y anualmente" — this is the figure, by job date, that the returns are filed from.
//
// Read live off the quote (quote.taxRate × the taxable base, as computeTotals() defines it for
// lump-sum vs itemized), so it carries the same "edited after conversion" caveat as the other
// components above. Measured 8-sep-2026: 4,120 of 4,237 paid orders carry a rate (7.25%–10.75%),
// 15 have rate 0, 1 has no quote. Only counted on PAID orders — an unpaid job has collected no
// tax yet — and not prorated on partial payments (the whole tax is attributed once paid = true).
//
// Never on a CANCELLED order, even if it still carries paid = true (Antonio, 8-sep-2026: "los sale
// tax hay que aplicarlos solo a las work orders que están pagadas, los cancelados no tenemos que
// contarlos"). Measured that day: 0 of the 473 cancelled orders are marked paid, so this changes
// nothing today; it is here so a pay-then-cancel never leaks into the return.
//
// SOLO PARTES (Antonio con el socio, 8-sep-2026): al estado se reporta el impuesto de las partes,
// no del labor. La cifra sale del snapshot de la orden (work_orders.sales_tax, escrito al convertir
// y congelado al pagar) y, si la orden es anterior al snapshot y no tiene backfill, de
// quote.totals.taxOnParts — nunca de taxAmount, que en las cotizaciones viejas grava también el labor.
function computeSalesTax(workOrder, quote) {
  if (!workOrder.payment?.paid || workOrder.status === "Cancelled") return 0;
  if (workOrder.salesTax != null) return Number(workOrder.salesTax);
  return Number(quote?.totals?.taxOnParts ?? 0);
}

// Base gravable (partes) y base no gravable (mano de obra, calibración, viaje, servicios) de la
// orden, para que el reporte de Sales Tax muestre las ventas como las pide la declaración. Mismas
// fuentes que computeSalesTax; la base gravable cae al inverso tax × 100 / tasa cuando no hay más.
function computeTaxableBase(workOrder, quote, salesTax) {
  if (workOrder.taxableBase != null) return Number(workOrder.taxableBase);
  if (quote?.totals?.taxableBase != null) return Number(quote.totals.taxableBase);
  const rate = Number(quote?.taxRate || 0);
  return rate ? (salesTax * 100) / rate : 0;
}

function computeNonTaxableBase(workOrder, quote) {
  if (workOrder.nonTaxableBase != null) return Number(workOrder.nonTaxableBase);
  return Number(quote?.totals?.nonTaxableBase ?? 0);
}

// Métodos de cobro que pasan por el procesador de tarjetas y por tanto pagan la comisión
// (Antonio, 8-sep-2026: "pagamos alrededor del 3% por procesar cobros por tarjeta; todo lo que
// tenga pagos de credit card hay que aplicarle ese porcentaje"). Medido en producción ese día:
// "We Have CC In File" ($1.20M), "Credit Card" ($149k), "Debit Card", y tres órdenes mixtas
// ("Credit Card + Cash", "We Have CC In File + Cash") a las que se aplica al monto completo porque
// el pago agregado no dice cuánto fue con tarjeta — se marcan `mixed` para que se vean en el
// detalle. Cash, Zelle, Venmo, Cash App, PayPal, Check y Deposit no pagan comisión.
//
// No duplica nada registrado: las "Comisiones bancarias" de gastos son INTERESES y overlimit fees
// de la tarjeta de crédito de la empresa (INTEREST CHARGE ON PURCHASES, OVERLIMIT FEE), no
// comisiones del procesador. Si algún día el procesador se captura como gasto, hay que quitar esta
// fila o bajar el porcentaje a 0 para no contarlo dos veces.
const CARD_METHOD_RE = /credit card|debit card|cc in file|tap to pay|apple pay|google pay/i;
const DEFAULT_CARD_FEE_PERCENT = 3;
const MAX_CARD_FEE_PERCENT = 15;

function isCardPayment(method) {
  return CARD_METHOD_RE.test(String(method || ""));
}

// The UI lets the owner type the rate; anything absent or absurd falls back to the default rather
// than zeroing the row, so a blank input never silently hides $40k of fees.
function normalizeCardFeePercent(raw) {
  if (raw === undefined || raw === null || raw === "") return DEFAULT_CARD_FEE_PERCENT;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0 || n > MAX_CARD_FEE_PERCENT) return DEFAULT_CARD_FEE_PERCENT;
  return n;
}

function computeCardFee(workOrder, feePercent = DEFAULT_CARD_FEE_PERCENT) {
  const method = workOrder.payment?.method || "";
  if (!workOrder.payment?.paid || !isCardPayment(method)) return { cardAmount: 0, fee: 0, method, mixed: false };
  const cardAmount = Number(workOrder.payment.amount || 0);
  return { cardAmount, fee: (cardAmount * feePercent) / 100, method, mixed: /\+/.test(method) };
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

// How the statement groups its cost rows. "costOfSales" is what it takes to deliver the jobs
// (parts, installer labor and its bonuses, agent commissions and theirs, the card processor's cut,
// the partner's share); "operating" is the expenses ledger (marketing, phone, software, bank
// interest, accounting). Gross profit = net revenue − cost of sales; net profit takes operating
// off that. Kept here so the aggregate and the matrix can never disagree on where a row sits.
const COST_GROUPS = {
  partsDistributors: "costOfSales",
  technicianPayroll: "costOfSales",
  agentCommissions: "costOfSales",
  cardProcessingFees: "costOfSales",
  partnerDistribution: "costOfSales",
  technicianAdjustments: "costOfSales",
  agentAdjustments: "costOfSales",
  priorBalances: "costOfSales",
  operatingExpenses: "operating",
};

// Sales tax is filed per state; anything without a state lands in its own bucket rather than
// being dropped, so the annual total still matches the P&L to the cent.
const TAX_STATES = ["CA", "TX"];
function taxStateOf(workOrder) {
  return TAX_STATES.includes(workOrder.state) ? workOrder.state : "none";
}

// Qué parte del negocio salió de cada estado (Paul, el contador, sep-2026: "What percentage of
// your business was from each state (California vs Texas) for 2025?"). Mismo ingreso que el P&L:
// lo cobrado en las órdenes pagadas (payment.amount), por estado de la orden, así que CA + TX +
// sin estado cuadra al centavo con la fila de ingresos de la matriz para el mismo año.
//
// `share` es el porcentaje sobre TODO lo cobrado, incluidas las órdenes sin estado; `shareAssigned`
// deja fuera ese cubo y reparte solo entre CA y TX, que es la cifra que se le contesta al contador
// cuando las órdenes sin estado son pocas. Si no lo fueran, lo honesto es asignarles estado
// (scripts/backfill-workorder-state.js) antes de contestar, no repartirlas a ojo.
function computeRevenueByState(paidWorkOrders) {
  const states = [...TAX_STATES, "none"];
  const out = Object.fromEntries(states.map((s) => [s, { state: s, orders: 0, revenue: 0, share: 0, shareAssigned: 0 }]));
  for (const w of paidWorkOrders) {
    if (!w.payment?.paid) continue;
    const cell = out[taxStateOf(w)];
    cell.orders += 1;
    cell.revenue += Number(w.payment.amount || 0);
  }
  const all = { orders: 0, revenue: 0 };
  let assigned = 0;
  for (const s of states) {
    all.orders += out[s].orders;
    all.revenue += out[s].revenue;
    if (s !== "none") assigned += out[s].revenue;
  }
  for (const s of states) {
    out[s].share = all.revenue ? (out[s].revenue / all.revenue) * 100 : 0;
    out[s].shareAssigned = s !== "none" && assigned ? (out[s].revenue / assigned) * 100 : 0;
  }
  return { ...out, all, assignedRevenue: assigned };
}

module.exports = {
  computeRevenueComponents,
  computeRevenueByState,
  computeSalesTax,
  computeTaxableBase,
  computeNonTaxableBase,
  computeCostComponents,
  computeCardFee,
  isCardPayment,
  normalizeCardFeePercent,
  DEFAULT_CARD_FEE_PERCENT,
  COST_GROUPS,
  TAX_STATES,
  taxStateOf,
};
