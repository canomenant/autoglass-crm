const express = require("express");
const quotesStore = require("../store/quotes.store");
const workOrdersStore = require("../store/workorders.store");
const expensesStore = require("../store/expenses.store");

const router = express.Router();

router.get("/profit-loss", async (req, res) => {
  const workOrders = await workOrdersStore.list();
  const expenses = await expensesStore.list();

  const revenue = workOrders
    .filter((w) => w.payment.paid)
    .reduce((sum, w) => sum + Number(w.payment.amount || 0), 0);

  const totalExpenses = expenses.reduce((sum, e) => sum + Number(e.amount || 0), 0);

  res.json({ revenue, expenses: totalExpenses, profit: revenue - totalExpenses });
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
