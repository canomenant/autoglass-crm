import {
  getWorkOrders,
  getQuotes,
  getCustomers,
  getInsuranceCompanies,
  getDistributors,
  getUsers,
  getExpenses,
  getPayments,
  getPaymentsDashboard,
  getCreditNotesDashboard,
  getDebitNotesDashboard,
  getProfitLossReport,
  getSalesReport,
  getTechniciansReport,
  getExpensesReport,
} from "./api";
import { isCompletedWorkOrderStatus, isTerminalWorkOrderStatus } from "./workOrderStatuses";

function money(n) {
  return `$${Number(n || 0).toFixed(2)}`;
}

function monthOf(d) {
  return d ? String(d).slice(0, 7) : "";
}

function thisMonth() {
  return new Date().toISOString().slice(0, 7);
}

function topEntry(totalsByKey) {
  let bestKey = null;
  let bestValue = -Infinity;
  Object.entries(totalsByKey).forEach(([key, value]) => {
    if (value > bestValue) {
      bestValue = value;
      bestKey = key;
    }
  });
  return { key: bestKey, value: bestValue === -Infinity ? 0 : bestValue };
}

async function dashboardView() {
  const [sales, pl, customers] = await Promise.all([getSalesReport(), getProfitLossReport(), getCustomers()]);
  return [
    { key: "openWorkOrders", value: sales.totalWorkOrders - sales.completedWorkOrders },
    { key: "completedWorkOrders", value: sales.completedWorkOrders },
    { key: "totalQuotes", value: sales.totalQuotes },
    { key: "totalCustomers", value: customers.length },
    { key: "revenue", value: money(pl.kpis.revenue) },
    { key: "expenses", value: money(pl.kpis.costs) },
  ];
}

async function quotesView() {
  const [quotes, sales] = await Promise.all([getQuotes(), getSalesReport()]);
  const thisM = thisMonth();
  return [
    { key: "totalQuotes", value: quotes.length },
    { key: "draft", value: quotes.filter((q) => q.status === "Draft").length },
    { key: "converted", value: sales.convertedQuotes },
    { key: "approved", value: quotes.filter((q) => q.status === "Approved").length },
    { key: "thisMonth", value: quotes.filter((q) => monthOf(q.date) === thisM).length },
  ];
}

async function workOrdersView() {
  const [workOrders, sales] = await Promise.all([getWorkOrders(), getSalesReport()]);
  return [
    { key: "totalWorkOrders", value: sales.totalWorkOrders },
    { key: "completed", value: sales.completedWorkOrders },
    { key: "open", value: workOrders.filter((w) => !isCompletedWorkOrderStatus(w.status) && !isTerminalWorkOrderStatus(w.status)).length },
    { key: "scheduled", value: workOrders.filter((w) => w.status === "Scheduled").length },
    { key: "pendingPayment", value: sales.pendingPayment },
  ];
}

async function customersView() {
  const [customers, workOrders] = await Promise.all([getCustomers(), getWorkOrders()]);
  const thisM = thisMonth();
  const newThisMonth = customers.filter((c) => monthOf(c.createdAt) === thisM).length;

  const revenueByCustomer = {};
  workOrders.forEach((w) => {
    if (!w.customerId) return;
    revenueByCustomer[w.customerId] = (revenueByCustomer[w.customerId] || 0) + Number(w.payment?.amount || 0);
  });
  const totalRevenue = Object.values(revenueByCustomer).reduce((s, v) => s + v, 0);
  const top = topEntry(revenueByCustomer);
  const topCustomer = customers.find((c) => c.id === Number(top.key));
  const recent = customers.slice().sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))[0];

  return [
    { key: "totalCustomers", value: customers.length },
    { key: "newThisMonth", value: newThisMonth },
    { key: "topCustomer", value: topCustomer ? `${topCustomer.name} (${money(top.value)})` : "—" },
    { key: "recentCustomer", value: recent ? recent.name : "—" },
    { key: "customerRevenue", value: money(totalRevenue) },
  ];
}

async function insuranceView() {
  const [quotes, companies] = await Promise.all([getQuotes(), getInsuranceCompanies()]);
  const claims = quotes.filter((q) => q.paymentType === "Insurance" || q.insuranceCompanyId);
  const approved = claims.filter((q) => q.status === "Approved" || q.status === "Converted").length;
  const pending = claims.filter((q) => ["Draft", "Waiting Customer", "Ready For Review"].includes(q.status)).length;

  const revenueByCompany = {};
  claims.forEach((q) => {
    if (!q.insuranceCompanyId) return;
    revenueByCompany[q.insuranceCompanyId] = (revenueByCompany[q.insuranceCompanyId] || 0) + Number(q.totals?.totalAmount || 0);
  });
  const top = topEntry(revenueByCompany);
  const topCompany = companies.find((c) => c.id === Number(top.key));

  return [
    { key: "insuranceClaims", value: claims.length },
    { key: "approvedClaims", value: approved },
    { key: "pendingClaims", value: pending },
    { key: "revenueByInsurance", value: money(top.value) },
    { key: "topInsuranceCompany", value: topCompany ? topCompany.name : "—" },
  ];
}

async function distributorsView() {
  const [distributors, payments] = await Promise.all([getDistributors(), getPayments({ type: "DISTRIBUTOR" })]);
  const thisM = thisMonth();
  const ordersThisMonth = payments.filter((p) => monthOf(p.createdAt) === thisM).length;
  const pendingPayments = payments.filter((p) => ["Pending", "Approved", "Scheduled"].includes(p.status)).length;
  const outstandingBalance = payments
    .filter((p) => p.status !== "Paid" && p.status !== "Cancelled")
    .reduce((s, p) => s + Number(p.amount || 0), 0);

  const paidByDistributor = {};
  payments.filter((p) => p.status === "Paid").forEach((p) => {
    paidByDistributor[p.distributorId] = (paidByDistributor[p.distributorId] || 0) + Number(p.amount || 0);
  });
  const top = topEntry(paidByDistributor);
  const topDistributor = distributors.find((d) => d.id === Number(top.key));

  return [
    { key: "totalDistributors", value: distributors.length },
    { key: "ordersThisMonth", value: ordersThisMonth },
    { key: "pendingPayments", value: pendingPayments },
    { key: "outstandingBalance", value: money(outstandingBalance) },
    { key: "topDistributor", value: topDistributor ? topDistributor.name : "—" },
  ];
}

async function expensesView() {
  const [expenses, byCategory] = await Promise.all([getExpenses(), getExpensesReport()]);
  const thisM = thisMonth();
  const total = expenses.reduce((s, e) => s + Number(e.amount || 0), 0);
  const thisMonthTotal = expenses.filter((e) => monthOf(e.date) === thisM).reduce((s, e) => s + Number(e.amount || 0), 0);
  const top = byCategory.slice().sort((a, b) => b.total - a.total)[0];

  return [
    { key: "totalExpenses", value: money(total) },
    { key: "thisMonth", value: money(thisMonthTotal) },
    { key: "records", value: expenses.length },
    { key: "topCategory", value: top ? `${top.category} (${money(top.total)})` : "—" },
  ];
}

async function paymentsView() {
  const [pd, cd, dd] = await Promise.all([getPaymentsDashboard(), getCreditNotesDashboard(), getDebitNotesDashboard()]);
  return [
    { key: "technicianPayments", value: pd.pendingTechnician },
    { key: "distributorPayments", value: pd.pendingDistributor },
    { key: "agentCommissions", value: pd.pendingAgent },
    { key: "creditNotes", value: cd.active },
    { key: "debitNotes", value: dd.active },
    { key: "outstandingPayments", value: money(pd.outstandingAmount) },
  ];
}

async function reportsView() {
  const [pl, sales] = await Promise.all([getProfitLossReport(), getSalesReport()]);
  return [
    { key: "revenue", value: money(pl.kpis.revenue) },
    { key: "expenses", value: money(pl.kpis.costs) },
    { key: "profit", value: money(pl.kpis.profit) },
    { key: "convertedQuotes", value: sales.convertedQuotes },
    { key: "completedWorkOrders", value: sales.completedWorkOrders },
  ];
}

async function usersView() {
  const [users, techReport, workOrders] = await Promise.all([getUsers(), getTechniciansReport(), getWorkOrders()]);
  const technicians = users.filter((u) => u.role === "Tech");
  const assignedJobs = workOrders.filter((w) => w.tech).length;
  const completedJobs = workOrders.filter((w) => w.tech && isCompletedWorkOrderStatus(w.status)).length;
  const pendingJobs = workOrders.filter((w) => w.tech && !isCompletedWorkOrderStatus(w.status) && !isTerminalWorkOrderStatus(w.status)).length;
  const monthlyProduction = techReport.reduce((s, t) => s + Number(t.revenue || 0), 0);

  return [
    { key: "totalUsers", value: users.length },
    { key: "technicians", value: technicians.length },
    { key: "assignedJobs", value: assignedJobs },
    { key: "completedJobs", value: completedJobs },
    { key: "pendingJobs", value: pendingJobs },
    { key: "monthlyProduction", value: money(monthlyProduction) },
  ];
}

const VIEWS = {
  dashboard: dashboardView,
  quotes: quotesView,
  workorders: workOrdersView,
  customers: customersView,
  insurance: insuranceView,
  distributors: distributorsView,
  expenses: expensesView,
  payments: paymentsView,
  reports: reportsView,
  users: usersView,
};

export async function getQuickViewCards(moduleKey) {
  const view = VIEWS[moduleKey];
  if (!view) return [];
  return view();
}
