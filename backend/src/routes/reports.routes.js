const express = require("express");
const quotesStore = require("../store/quotes.store");
const workOrdersStore = require("../store/workorders.store");
const expensesStore = require("../store/expenses.store");
const partnerDistributionsStore = require("../store/partnerDistributions.store");

const router = express.Router();

const DRILL_CAP = 200;

function capList(items) {
  const sorted = [...items].sort((a, b) => b.amount - a.amount);
  return { items: sorted.slice(0, DRILL_CAP), totalCount: items.length };
}

// Single source of truth for revenue/cost figures — consumed by the QuickView header cards
// (frontend/src/lib/quickViewData.js), the Reports overview page, and the P&L report. Revenue
// counts only paid work orders (money actually collected); costs count every work order
// matching the filters regardless of payment status (a cost is incurred once the job is done,
// not once the customer settles). Technician cost comes from work_orders.labor_cost, not the
// payouts table — payouts only records already-processed payment batches (200 rows covering a
// fraction of jobs), not the real per-job labor cost.
router.get("/profit-loss", async (req, res) => {
  const { dateFrom, dateTo, type } = req.query;

  function inRange(d) {
    if (!d) return !dateFrom && !dateTo;
    if (dateFrom && d < dateFrom) return false;
    if (dateTo && d > dateTo) return false;
    return true;
  }

  const allWorkOrders = await workOrdersStore.list();
  const workOrders = allWorkOrders.filter((w) => {
    if (!inRange(w.appointmentDate)) return false;
    if (type && (w.workOrderType || "Personal") !== type) return false;
    return true;
  });

  const quotes = await quotesStore.list();
  const quoteById = new Map(quotes.map((q) => [q.id, q]));

  const expenses = expensesStore.list().filter((e) => inRange(e.date));

  const paidWorkOrders = workOrders.filter((w) => w.payment?.paid);
  const revenue = paidWorkOrders.reduce((sum, w) => sum + Number(w.payment?.amount || 0), 0);

  // Revenue breakdown: "parts"/"calibration"/"deductibles" come from the linked Quote's
  // computed totals (what was quoted for that portion of the job); "other" is whatever's left
  // of the amount actually paid — a deliberate plug, not a tracked category, since the business
  // doesn't record revenue by line item at payment time. Guarantees the 4 categories always sum
  // to exactly `revenue`.
  let revParts = 0, revCalibration = 0, revDeductibles = 0, revOther = 0;
  const revPartsWOs = [], revCalibrationWOs = [], revDeductiblesWOs = [], revOtherWOs = [];

  for (const w of paidWorkOrders) {
    const amount = Number(w.payment?.amount || 0);
    const quote = w.quoteId ? quoteById.get(w.quoteId) : null;
    const parts = Number(quote?.totals?.subtotalParts || 0);
    const calibration = Number(quote?.totals?.subtotalServices || 0);
    const deductibles = Number(quote?.totals?.customerResponsibility || 0);
    const other = amount - parts - calibration - deductibles;
    const row = { id: w.id, workOrderNo: w.workOrderNo, customerName: w.customerName };

    revParts += parts;
    revCalibration += calibration;
    revDeductibles += deductibles;
    revOther += other;
    if (parts) revPartsWOs.push({ ...row, amount: parts });
    if (calibration) revCalibrationWOs.push({ ...row, amount: calibration });
    if (deductibles) revDeductiblesWOs.push({ ...row, amount: deductibles });
    if (other) revOtherWOs.push({ ...row, amount: other });
  }

  // Cost breakdown: direct per-work-order costs, counted regardless of payment status.
  let costParts = 0, costCommissions = 0, costPayroll = 0;
  const costPartsWOs = [], costCommissionsWOs = [], costPayrollWOs = [];

  for (const w of workOrders) {
    const glass = Number(w.glassCost || 0);
    const commission = Number(w.commission || 0);
    const labor = Number(w.laborCost || 0);
    const row = { id: w.id, workOrderNo: w.workOrderNo, customerName: w.customerName };

    costParts += glass;
    costCommissions += commission;
    costPayroll += labor;
    if (glass) costPartsWOs.push({ ...row, amount: glass });
    if (commission) costCommissionsWOs.push({ ...row, amount: commission });
    if (labor) costPayrollWOs.push({ ...row, amount: labor });
  }

  // Partner distributions are date-filtered by paid_at (when the distribution actually happened),
  // not appointmentDate like the 3 categories above — a distribution doesn't exist until the WO
  // is paid, so appointmentDate would be the wrong axis. Sourced from the stored ledger rather
  // than recomputed here, so the configured cutoff date and the "which job type" logic only ever
  // live in one place (partnerDistributions.store.js).
  const workOrderTypeById = new Map(allWorkOrders.map((w) => [w.id, w.workOrderType || "Personal"]));
  const partnerDistributions = (await partnerDistributionsStore.query({ dateFrom, dateTo })).filter(
    (d) => !type || workOrderTypeById.get(d.workOrderId) === type
  );
  const costPartnerDist = partnerDistributions.reduce((sum, d) => sum + d.amount, 0);
  const costPartnerDistWOs = partnerDistributions.map((d) => ({
    id: d.workOrderId,
    workOrderNo: d.workOrderNo,
    customerName: d.partnerName,
    amount: d.amount,
  }));

  const operatingExpenses = expenses.reduce((sum, e) => sum + Number(e.amount || 0), 0);
  const costs = costParts + costCommissions + costPayroll + costPartnerDist + operatingExpenses;
  const profit = revenue - costs;
  const marginPercent = revenue ? (profit / revenue) * 100 : 0;
  const pctOfRevenue = (amount) => (revenue ? (amount / revenue) * 100 : 0);

  res.json({
    filters: { dateFrom: dateFrom || "", dateTo: dateTo || "", type: type || "" },
    kpis: { revenue, costs, profit, marginPercent },
    revenueBreakdown: [
      { key: "parts", amount: revParts, percentOfRevenue: pctOfRevenue(revParts), ...capList(revPartsWOs) },
      { key: "calibration", amount: revCalibration, percentOfRevenue: pctOfRevenue(revCalibration), ...capList(revCalibrationWOs) },
      { key: "deductibles", amount: revDeductibles, percentOfRevenue: pctOfRevenue(revDeductibles), ...capList(revDeductiblesWOs) },
      { key: "other", amount: revOther, percentOfRevenue: pctOfRevenue(revOther), ...capList(revOtherWOs) },
    ],
    costBreakdown: [
      { key: "partsDistributors", amount: costParts, percentOfRevenue: pctOfRevenue(costParts), ...capList(costPartsWOs) },
      { key: "agentCommissions", amount: costCommissions, percentOfRevenue: pctOfRevenue(costCommissions), ...capList(costCommissionsWOs) },
      { key: "technicianPayroll", amount: costPayroll, percentOfRevenue: pctOfRevenue(costPayroll), ...capList(costPayrollWOs) },
      { key: "partnerDistribution", amount: costPartnerDist, percentOfRevenue: pctOfRevenue(costPartnerDist), ...capList(costPartnerDistWOs) },
      {
        key: "operatingExpenses",
        amount: operatingExpenses,
        percentOfRevenue: pctOfRevenue(operatingExpenses),
        items: expenses
          .slice()
          .sort((a, b) => Number(b.amount) - Number(a.amount))
          .slice(0, DRILL_CAP)
          .map((e) => ({ id: e.id, category: e.category, date: e.date, amount: Number(e.amount) })),
        totalCount: expenses.length,
      },
    ],
  });
});

router.get("/sales", async (req, res) => {
  const quotes = await quotesStore.list();
  const workOrders = await workOrdersStore.list();
  const personalWOs = workOrders.filter((w) => w.workOrderType !== "Insurance");
  const insuranceWOs = workOrders.filter((w) => w.workOrderType === "Insurance");
  const revenueOf = (list) => list.filter((w) => w.payment.paid).reduce((sum, w) => sum + Number(w.payment.amount || 0), 0);
  const completedOf = (list) => list.filter((w) => workOrdersStore.COMPLETED_STATUSES.includes(w.status)).length;

  res.json({
    totalQuotes: quotes.length,
    convertedQuotes: quotes.filter((q) => q.status === "Converted").length,
    totalWorkOrders: workOrders.length,
    completedWorkOrders: workOrders.filter((w) => workOrdersStore.COMPLETED_STATUSES.includes(w.status)).length,
    pendingPayment: workOrders.filter((w) => !w.payment.paid).length,
    personalQuotes: quotes.filter((q) => q.paymentType !== "Insurance").length,
    insuranceQuotes: quotes.filter((q) => q.paymentType === "Insurance").length,
    personalWorkOrders: personalWOs.length,
    insuranceWorkOrders: insuranceWOs.length,
    personalRevenue: revenueOf(personalWOs),
    insuranceRevenue: revenueOf(insuranceWOs),
    completedPersonalWorkOrders: completedOf(personalWOs),
    completedInsuranceWorkOrders: completedOf(insuranceWOs),
  });
});

router.get("/technicians", async (req, res) => {
  const workOrders = await workOrdersStore.list();
  const byTech = {};

  for (const w of workOrders) {
    const tech = w.tech || "Sin asignar";
    if (!byTech[tech]) byTech[tech] = { tech, jobs: 0, revenue: 0 };
    byTech[tech].jobs += 1;
    if (w.payment.paid) byTech[tech].revenue += Number(w.payment.amount || 0);
  }

  res.json(Object.values(byTech));
});

router.get("/partners", async (req, res) => {
  const { dateFrom, dateTo } = req.query;
  const distributions = await partnerDistributionsStore.query({ dateFrom, dateTo });

  const byPartner = new Map();
  for (const d of distributions) {
    if (!byPartner.has(d.partnerId)) {
      byPartner.set(d.partnerId, { partnerId: d.partnerId, partnerName: d.partnerName, amount: 0, workOrders: [] });
    }
    const bucket = byPartner.get(d.partnerId);
    bucket.amount += d.amount;
    bucket.workOrders.push({ id: d.id, workOrderId: d.workOrderId, workOrderNo: d.workOrderNo, jobType: d.jobType, amount: d.amount, paidAt: d.paidAt });
  }

  const rows = [...byPartner.values()]
    .map(({ workOrders, ...bucket }) => ({ ...bucket, ...capList(workOrders) }))
    .sort((a, b) => b.amount - a.amount);

  res.json({
    filters: { dateFrom: dateFrom || "", dateTo: dateTo || "" },
    totalAmount: distributions.reduce((sum, d) => sum + d.amount, 0),
    partners: rows,
  });
});

router.get("/expenses", async (req, res) => {
  const expenses = await expensesStore.list();
  const byCategory = {};

  for (const e of expenses) {
    const category = e.category || "Sin categoría";
    byCategory[category] = (byCategory[category] || 0) + Number(e.amount || 0);
  }

  res.json(Object.entries(byCategory).map(([category, total]) => ({ category, total })));
});

module.exports = router;
