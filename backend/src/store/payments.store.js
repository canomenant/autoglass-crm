const workordersStore = require("./workorders.store");
const quotesStore = require("./quotes.store");
const { loadOrSeed, save, nextIdFrom } = require("../lib/persistence");

// Lazy require: agents.store.js requires payments.store.js (for computeStats' commissionsPaid),
// so a top-level require here would create a circular dependency and hand one side a
// partially-loaded module. Requiring inside the functions that need it defers resolution
// until both modules have fully finished loading.
function agentsStore() {
  return require("./agents.store");
}

const FILE = "payments.json";
let payments = loadOrSeed(FILE, () => []);
let nextId = nextIdFrom(payments);

function persist() {
  save(FILE, payments);
}

const PREFIX = { TECHNICIAN: "PT", DISTRIBUTOR: "PD", AGENT: "PA" };
const TYPES = ["TECHNICIAN", "DISTRIBUTOR", "AGENT"];
const STATUSES = ["Pending", "Ready For Payment", "Approved", "Paid", "Cancelled"];

function pad(n) {
  return String(n).padStart(4, "0");
}

function normalizeType(type) {
  return TYPES.includes(type) ? type : "TECHNICIAN";
}

function pushAudit(payment, user, action, oldValue, newValue) {
  payment.auditLog.push({
    user: user || "System",
    timestamp: new Date().toISOString(),
    action,
    oldValue: oldValue ?? null,
    newValue: newValue ?? null,
  });
}

function withComputed(payment) {
  if (!payment) return payment;
  const amount =
    payment.type === "TECHNICIAN"
      ? payment.netAmount
      : payment.type === "DISTRIBUTOR"
      ? payment.totalAmount
      : payment.commissionAmount;
  return { ...payment, amount };
}

// The per-Work-Order amount owed to a given entity, before batch-level adjustments
// (bonus/deductions for Technician, tax for Distributor). Agent uses the agent's own
// catalog commission type/rate rather than re-entering it per batch.
function amountOwedForWorkOrder(type, workOrder, agent) {
  if (type === "TECHNICIAN") return Number(workOrder.laborCost || 0);
  if (type === "DISTRIBUTOR") return Number(workOrder.glassCost || 0);
  if (type === "AGENT") {
    const gross = Number(workOrder.totalSale || 0);
    return agent?.commissionType === "Fixed" ? Number(agent.commissionRate || 0) : (gross * Number(agent?.commissionRate || 0)) / 100;
  }
  return 0;
}

function claimedWorkOrderIds() {
  const claimed = new Set();
  payments.forEach((p) => {
    if (p.status === "Cancelled") return;
    (p.workOrderIds || []).forEach((id) => claimed.add(id));
  });
  return claimed;
}

function listEligibleWorkOrders(type, entityId) {
  const normalizedType = normalizeType(type);
  const id = Number(entityId);
  const claimed = claimedWorkOrderIds();
  let workOrders = workordersStore.list();

  if (normalizedType === "TECHNICIAN") {
    workOrders = workOrders.filter((w) => w.technicianId === id);
  } else if (normalizedType === "DISTRIBUTOR") {
    workOrders = workOrders.filter((w) => w.distributorId === id);
  } else {
    const quoteAgentMap = {};
    quotesStore.list().forEach((q) => {
      quoteAgentMap[q.id] = q.agentId;
    });
    workOrders = workOrders.filter((w) => quoteAgentMap[w.quoteId] === id);
  }

  const agent = normalizedType === "AGENT" ? agentsStore().get(id) : null;

  return workOrders
    .filter((w) => !claimed.has(w.id))
    .map((w) => ({
      id: w.id,
      workOrderNo: w.workOrderNo,
      customerName: w.customerName,
      vehicle: [w.vehicle?.year, w.vehicle?.make, w.vehicle?.model].filter(Boolean).join(" "),
      appointmentDate: w.appointmentDate,
      partNumber: w.partNumber,
      amountOwed: amountOwedForWorkOrder(normalizedType, w, agent),
    }));
}

function list(filters = {}) {
  let result = payments.filter((p) => p.active !== false).map(withComputed);
  if (filters.type) result = result.filter((p) => p.type === filters.type);
  if (filters.status) result = result.filter((p) => p.status === filters.status);
  if (filters.dateFrom) result = result.filter((p) => (p.paymentDate || p.createdAt) >= filters.dateFrom);
  if (filters.dateTo) result = result.filter((p) => (p.paymentDate || p.createdAt) <= filters.dateTo);
  if (filters.search) {
    const q = String(filters.search).toLowerCase();
    result = result.filter((p) =>
      [p.paymentNumber, p.notes, p.invoiceNumber, p.poNumber]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q))
    );
  }
  return result.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

function get(id) {
  return withComputed(payments.find((p) => p.id === Number(id) && p.active !== false));
}

function create(data, user) {
  const type = normalizeType(data.type);
  const workOrderIds = Array.isArray(data.workOrderIds) ? data.workOrderIds.map(Number) : [];
  const isAdhoc = workOrderIds.length === 0 && data.manualAmount != null;

  if (workOrderIds.length === 0 && !isAdhoc) throw new Error("At least one Work Order must be selected");
  if (isAdhoc && type === "TECHNICIAN") throw new Error("Technician payments must be linked to Work Orders");
  if (isAdhoc && !(Number(data.manualAmount) > 0)) throw new Error("A manual amount greater than zero is required for an adhoc payment");

  let workOrders = [];
  const agent = type === "AGENT" ? agentsStore().get(data.agentId) : null;
  let baseTotal;

  if (isAdhoc) {
    baseTotal = Number(data.manualAmount);
  } else {
    const claimed = claimedWorkOrderIds();
    const alreadyClaimed = workOrderIds.filter((id) => claimed.has(id));
    if (alreadyClaimed.length) throw new Error(`Work Order(s) already in a payment: ${alreadyClaimed.join(", ")}`);

    workOrders = workOrderIds.map((id) => workordersStore.get(id)).filter(Boolean);
    if (workOrders.length !== workOrderIds.length) throw new Error("One or more Work Orders not found");

    baseTotal = workOrders.reduce((sum, w) => sum + amountOwedForWorkOrder(type, w, agent), 0);
  }

  const bonus = type === "TECHNICIAN" ? Number(data.bonus || 0) : 0;
  const deductions = type === "TECHNICIAN" ? Number(data.deductions || 0) : 0;
  const taxAmount = type === "DISTRIBUTOR" ? Number(data.taxAmount || 0) : 0;

  const netAmount = type === "TECHNICIAN" ? baseTotal + bonus - deductions : 0;
  const totalAmount = type === "DISTRIBUTOR" ? baseTotal + taxAmount : 0;
  const commissionAmount = type === "AGENT" ? baseTotal : 0;

  const payment = {
    id: nextId,
    paymentNumber: null,
    type,
    status: "Pending",
    paymentMethod: data.paymentMethod || "",
    paymentDate: data.paymentDate || "",
    notes: data.notes || "",

    workOrderIds,
    isAdhoc,

    technicianId: type === "TECHNICIAN" ? Number(data.technicianId) || null : null,
    agentId: type === "AGENT" ? Number(data.agentId) || null : null,
    distributorId: type === "DISTRIBUTOR" ? Number(data.distributorId) || null : null,

    baseAmount: type === "TECHNICIAN" ? baseTotal : 0,
    bonus,
    deductions,
    netAmount,

    invoiceNumber: data.invoiceNumber || "",
    poNumber: data.poNumber || "",
    partNumber: data.partNumber || "",
    invoiceDate: data.invoiceDate || "",
    dueDate: data.dueDate || "",
    taxAmount,
    subtotal: type === "DISTRIBUTOR" ? baseTotal : 0,
    totalAmount,
    attachment: data.attachment || null,

    commissionType: agent?.commissionType || "Percentage",
    commissionRate: agent?.commissionRate ?? 0,
    grossAmount: type === "AGENT" ? baseTotal : 0,
    commissionAmount,

    creditNotesTotal: 0,
    debitNotesTotal: 0,

    transactions: [],
    auditLog: [],
    active: true,
    deletedAt: null,
    createdBy: user || "System",
    updatedBy: user || "System",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  // credit/debit note adjustments (none exist yet for a brand-new payment, kept for symmetry with applyAdjustmentTotals)
  if (type === "TECHNICIAN") payment.netAmount = payment.netAmount - payment.creditNotesTotal + payment.debitNotesTotal;
  if (type === "DISTRIBUTOR") payment.totalAmount = payment.totalAmount - payment.creditNotesTotal + payment.debitNotesTotal;
  if (type === "AGENT") payment.commissionAmount = payment.commissionAmount - payment.creditNotesTotal + payment.debitNotesTotal;

  pushAudit(payment, user, "Created", null, { status: payment.status, workOrderCount: workOrderIds.length });
  payments.push(payment);
  nextId += 1;
  persist();
  return withComputed(payment);
}

function update(id, data, user) {
  const payment = payments.find((p) => p.id === Number(id) && p.active !== false);
  if (!payment) return null;

  const before = { ...payment };

  Object.assign(payment, {
    paymentMethod: data.paymentMethod ?? payment.paymentMethod,
    paymentDate: data.paymentDate ?? payment.paymentDate,
    notes: data.notes ?? payment.notes,
    bonus: data.bonus ?? payment.bonus,
    deductions: data.deductions ?? payment.deductions,
    invoiceNumber: data.invoiceNumber ?? payment.invoiceNumber,
    poNumber: data.poNumber ?? payment.poNumber,
    partNumber: data.partNumber ?? payment.partNumber,
    invoiceDate: data.invoiceDate ?? payment.invoiceDate,
    dueDate: data.dueDate ?? payment.dueDate,
    taxAmount: data.taxAmount ?? payment.taxAmount,
    attachment: data.attachment ?? payment.attachment,
    updatedBy: user || payment.updatedBy,
    updatedAt: new Date().toISOString(),
  });

  if (payment.type === "TECHNICIAN") payment.netAmount = payment.baseAmount + Number(payment.bonus || 0) - Number(payment.deductions || 0) - payment.creditNotesTotal + payment.debitNotesTotal;
  if (payment.type === "DISTRIBUTOR") payment.totalAmount = payment.subtotal + Number(payment.taxAmount || 0) - payment.creditNotesTotal + payment.debitNotesTotal;

  pushAudit(payment, user, "Updated", { status: before.status }, { status: payment.status });
  persist();
  return withComputed(payment);
}

function markReady(id, user) {
  const payment = payments.find((p) => p.id === Number(id) && p.active !== false);
  if (!payment) return null;
  if (payment.status !== "Pending") throw new Error("Only Pending payments can be marked Ready For Payment");
  payment.status = "Ready For Payment";
  payment.updatedBy = user || payment.updatedBy;
  payment.updatedAt = new Date().toISOString();
  pushAudit(payment, user, "Marked Ready For Payment", { status: "Pending" }, { status: "Ready For Payment" });
  persist();
  return withComputed(payment);
}

function approve(id, user) {
  const payment = payments.find((p) => p.id === Number(id) && p.active !== false);
  if (!payment) return null;
  if (payment.status !== "Ready For Payment") throw new Error("Only Ready For Payment payments can be approved");
  const oldStatus = payment.status;
  payment.status = "Approved";
  if (!payment.paymentNumber) {
    const typeCount = payments.filter((p) => p.type === payment.type && p.paymentNumber).length + 1;
    payment.paymentNumber = `${PREFIX[payment.type]}-${pad(typeCount)}`;
  }
  payment.updatedBy = user || payment.updatedBy;
  payment.updatedAt = new Date().toISOString();
  pushAudit(payment, user, "Approved", { status: oldStatus }, { status: "Approved", paymentNumber: payment.paymentNumber });
  persist();
  return withComputed(payment);
}

function markPaid(id, user, data = {}) {
  const payment = payments.find((p) => p.id === Number(id) && p.active !== false);
  if (!payment) return null;
  if (payment.status !== "Approved") throw new Error("Only Approved payments can be marked Paid");
  payment.paymentDate = data.paymentDate || payment.paymentDate || new Date().toISOString().slice(0, 10);
  if (data.paymentMethod) payment.paymentMethod = data.paymentMethod;
  payment.transactions.push({
    id: payment.transactions.length + 1,
    transactionReference: data.transactionReference || "",
    paymentGateway: data.paymentGateway || "Manual",
    paymentMethod: data.paymentMethod || payment.paymentMethod,
    amount: withComputed(payment).amount,
    date: payment.paymentDate,
  });
  const oldStatus = payment.status;
  payment.status = "Paid";
  payment.updatedBy = user || payment.updatedBy;
  payment.updatedAt = new Date().toISOString();
  pushAudit(payment, user, "Marked as Paid", { status: oldStatus }, { status: "Paid" });
  persist();
  return withComputed(payment);
}

function cancel(id, user, reason) {
  const payment = payments.find((p) => p.id === Number(id) && p.active !== false);
  if (!payment) return null;
  if (payment.status === "Paid" || payment.status === "Cancelled") throw new Error("Cannot cancel a Paid or already-Cancelled payment");
  if (reason) payment.notes = `${payment.notes ? payment.notes + " | " : ""}Cancelled: ${reason}`;
  const oldStatus = payment.status;
  payment.status = "Cancelled";
  payment.updatedBy = user || payment.updatedBy;
  payment.updatedAt = new Date().toISOString();
  pushAudit(payment, user, "Cancelled", { status: oldStatus }, { status: "Cancelled" });
  persist();
  return withComputed(payment);
}

function remove(id) {
  const payment = payments.find((p) => p.id === Number(id) && p.active !== false);
  if (!payment) return false;
  payment.active = false;
  payment.deletedAt = new Date().toISOString();
  persist();
  return true;
}

function applyAdjustmentTotals(paymentId, creditTotal, debitTotal) {
  const payment = payments.find((p) => p.id === Number(paymentId) && p.active !== false);
  if (!payment) return null;
  const before = withComputed(payment).amount;

  payment.creditNotesTotal = creditTotal;
  payment.debitNotesTotal = debitTotal;
  if (payment.type === "TECHNICIAN") payment.netAmount = payment.baseAmount + Number(payment.bonus || 0) - Number(payment.deductions || 0) - creditTotal + debitTotal;
  if (payment.type === "DISTRIBUTOR") payment.totalAmount = payment.subtotal + Number(payment.taxAmount || 0) - creditTotal + debitTotal;
  if (payment.type === "AGENT") payment.commissionAmount = payment.grossAmount - creditTotal + debitTotal;
  payment.updatedAt = new Date().toISOString();

  const after = withComputed(payment).amount;
  if (before !== after) {
    pushAudit(payment, "System", "Recalculated from Credit/Debit Notes", { amount: before }, { amount: after });
  }
  persist();
  return withComputed(payment);
}

function dashboard() {
  const all = list();
  const now = new Date();
  const monthKey = (d) => (d ? String(d).slice(0, 7) : "");
  const thisMonth = monthKey(now.toISOString());

  const pendingTechnician = all.filter((p) => p.type === "TECHNICIAN" && p.status === "Pending").length;
  const pendingDistributor = all.filter((p) => p.type === "DISTRIBUTOR" && p.status === "Pending").length;
  const pendingAgent = all.filter((p) => p.type === "AGENT" && p.status === "Pending").length;

  const totalThisMonth = all
    .filter((p) => monthKey(p.createdAt) === thisMonth)
    .reduce((sum, p) => sum + Number(p.amount || 0), 0);

  const paid = all.filter((p) => p.status === "Paid");
  const totalPaidThisMonth = paid
    .filter((p) => monthKey(p.paymentDate || p.updatedAt) === thisMonth)
    .reduce((sum, p) => sum + Number(p.amount || 0), 0);

  const outstandingAmount = all
    .filter((p) => p.status !== "Paid" && p.status !== "Cancelled")
    .reduce((sum, p) => sum + Number(p.amount || 0), 0);

  const paidByMonth = {};
  paid.forEach((p) => {
    const key = monthKey(p.paymentDate || p.updatedAt);
    paidByMonth[key] = (paidByMonth[key] || 0) + Number(p.amount || 0);
  });
  const months = Object.keys(paidByMonth);
  const averageMonthlyPayments = months.length
    ? months.reduce((sum, m) => sum + paidByMonth[m], 0) / months.length
    : 0;

  return {
    pendingTechnician,
    pendingDistributor,
    pendingAgent,
    totalThisMonth,
    totalPaidThisMonth,
    outstandingAmount,
    averageMonthlyPayments,
  };
}

module.exports = {
  TYPES,
  STATUSES,
  list,
  get,
  create,
  update,
  markReady,
  approve,
  markPaid,
  cancel,
  remove,
  listEligibleWorkOrders,
  applyAdjustmentTotals,
  dashboard,
};
