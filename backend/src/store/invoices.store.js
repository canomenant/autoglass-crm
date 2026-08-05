const crypto = require("crypto");
const { loadOrSeed, save, nextIdFrom } = require("../lib/persistence");
const quotesStore = require("./quotes.store");
const insuranceStore = require("./insurance.store");

const FILE = "invoices.json";
let invoices = loadOrSeed(FILE, () => []);
let nextId = nextIdFrom(invoices);

function persist() {
  save(FILE, invoices);
}

const STATUSES = ["Draft", "Sent", "Viewed", "Partially_Paid", "Paid", "Overdue", "Void"];
const BILL_TO = ["Customer", "Insurance", "Split"];
const TEMPLATES = ["Personal", "Insurance", "Custom"];

const SECTION_KEYS = [
  "customer", "vehicle", "workOrder",
  "insuranceCompany", "policyNumber", "claimNumber",
  "parts", "labor", "calibration", "longTrip", "tax",
  "flatRateKit", "claimTotal", "deductible", "insuranceResponsibility", "customerResponsibility", "totalClaimValue",
  "total", "paid", "balance",
  "customerNotes",
];

function defaultSections(allOn) {
  return Object.fromEntries(SECTION_KEYS.map((k) => [k, allOn]));
}

// Backfill the template system added for the three-invoice-type redesign.
(function migrateTemplateShape() {
  let changed = false;
  for (const invoice of invoices) {
    if (!TEMPLATES.includes(invoice.template)) {
      invoice.template = "Personal";
      changed = true;
    }
    if (!invoice.customSections) {
      invoice.customSections = defaultSections(true);
      changed = true;
    }
    if (invoice.internalNotes === undefined) {
      invoice.internalNotes = "";
      changed = true;
    }
  }
  if (changed) persist();
})();

function pad(n) {
  return String(n).padStart(4, "0");
}

function genToken() {
  return crypto.randomBytes(12).toString("hex");
}

function pushAudit(invoice, user, action, oldValue, newValue) {
  invoice.auditLog.push({
    user: user || "System",
    timestamp: new Date().toISOString(),
    action,
    oldValue: oldValue ?? null,
    newValue: newValue ?? null,
  });
}

function computeTotals(invoice) {
  const subtotal = invoice.items.reduce((sum, it) => sum + Number(it.quantity || 0) * Number(it.unitPrice || 0), 0);
  const total = Math.max(0, subtotal + Number(invoice.tax || 0) - Number(invoice.discount || 0));
  const amountPaid = invoice.payments.reduce((sum, p) => sum + Number(p.amount || 0), 0);
  const balance = total - amountPaid;
  return { subtotal, total, amountPaid, balance };
}

function computeStatus(invoice, totals) {
  if (invoice.status === "Draft" || invoice.status === "Void") return invoice.status;
  if (totals.total > 0 && totals.balance <= 0) return "Paid";
  if (totals.amountPaid > 0 && totals.balance > 0) return "Partially_Paid";
  const today = new Date(new Date().toDateString());
  if (invoice.dueDate && new Date(invoice.dueDate) < today && totals.balance > 0) return "Overdue";
  return invoice.status;
}

// Customer-safe breakdown pulled from the linked Quote's own totals, computed server-side so
// neither the internal editor nor the public invoice view need direct Quote API access (the
// public view has no auth token). Deliberately excludes any cost/profit/commission field.
async function buildBreakdown(invoice) {
  const quote = invoice.quoteId ? await quotesStore.get(invoice.quoteId) : null;
  const company = invoice.insuranceCompanyId ? insuranceStore.get(invoice.insuranceCompanyId) : null;
  const totals = quote?.totals || {};
  const isInsuranceQuote = quote?.paymentType === "Insurance";

  return {
    insuranceCompanyName: company?.name || "",
    policyNumber: quote?.policyNumber || "",
    partsAmount: isInsuranceQuote ? totals.pricePartInsurance || 0 : totals.subtotalParts || 0,
    laborAmount: isInsuranceQuote ? totals.laborTotal || 0 : totals.priceTierTotal || 0,
    calibration: totals.subtotalServices || 0,
    longTripFee: totals.longTripFee || 0,
    taxAmount: totals.taxAmount || 0,
    flatRateKit: totals.flatRateKit || 0,
    claimTotal: totals.claimTotalBeforeAdjustment || 0,
    insuranceAdjustmentAmount: totals.insuranceAdjustmentAmount || 0,
    deductible: totals.deductible || 0,
    insuranceResponsibility: totals.insuranceResponsibility || 0,
    customerResponsibility: totals.customerResponsibility || 0,
    totalClaimValue: totals.totalClaimValue || 0,
  };
}

async function withComputed(invoice) {
  if (!invoice) return invoice;
  const totals = computeTotals(invoice);
  return { ...invoice, ...totals, status: computeStatus(invoice, totals), breakdown: await buildBreakdown(invoice) };
}

function stripInternal(invoice) {
  if (!invoice) return invoice;
  const { internalNotes, ...rest } = invoice;
  return rest;
}

async function list(filters = {}) {
  let result = await Promise.all(invoices.map(withComputed));
  if (filters.workOrderId) result = result.filter((i) => i.workOrderId === Number(filters.workOrderId));
  if (filters.status) result = result.filter((i) => i.status === filters.status);
  return result.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

function get(id) {
  return withComputed(invoices.find((i) => i.id === Number(id)));
}

function getByToken(token) {
  return withComputed(invoices.find((i) => i.publicToken === token));
}

async function getPublicByToken(token) {
  return stripInternal(await getByToken(token));
}

function createFromWorkOrder(workOrder, quote, user) {
  const items = [];
  (quote?.lineItems || []).forEach((li) => {
    if (Number(li.pricePart || 0) <= 0 && !li.jobType) return;
    items.push({
      id: items.length + 1,
      description: [li.jobType, li.nagsDescription || li.partNumber].filter(Boolean).join(" - ") || "Service",
      quantity: 1,
      unitPrice: Number(li.pricePart || 0),
    });
  });
  if (Number(workOrder.glassCost) > 0) items.push({ id: items.length + 1, description: "Glass", quantity: 1, unitPrice: Number(workOrder.glassCost) });
  if (Number(workOrder.laborCost) > 0) items.push({ id: items.length + 1, description: "Labor", quantity: 1, unitPrice: Number(workOrder.laborCost) });
  if (items.length === 0 && Number(workOrder.totalSale) > 0) {
    items.push({ id: 1, description: "Service", quantity: 1, unitPrice: Number(workOrder.totalSale) });
  }

  const invoice = {
    id: nextId,
    invoiceNumber: `INV-${pad(nextId)}`,
    workOrderId: workOrder.id,
    workOrderNo: workOrder.workOrderNo,
    quoteId: workOrder.quoteId || null,
    customerId: workOrder.customerId,
    customerName: workOrder.customerName || "",
    customerPhone: workOrder.phone || "",
    customerEmail: workOrder.email || "",
    vehicle: workOrder.vehicle || {},
    insuranceCompanyId: workOrder.insuranceCompanyId ?? null,
    claimNumber: workOrder.claimNumber || "",
    technician: workOrder.tech || "",
    billTo: "Customer",
    splitBilling: { customerAmount: 0, insuranceAmount: 0, deductible: 0 },
    items,
    tax: 0,
    discount: 0,
    invoiceDate: new Date().toISOString().slice(0, 10),
    dueDate: "",
    status: "Draft",
    publicToken: genToken(),
    template: quote?.paymentType === "Insurance" ? "Insurance" : "Personal",
    customSections: defaultSections(true),
    notes: "",
    internalNotes: "",
    payments: [],
    auditLog: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  pushAudit(invoice, user, "Created", null, null);
  invoices.push(invoice);
  nextId += 1;
  persist();
  return withComputed(invoice);
}

function update(id, data, user) {
  const invoice = invoices.find((i) => i.id === Number(id));
  if (!invoice) return null;

  Object.assign(invoice, {
    customerName: data.customerName ?? invoice.customerName,
    customerPhone: data.customerPhone ?? invoice.customerPhone,
    customerEmail: data.customerEmail ?? invoice.customerEmail,
    insuranceCompanyId: data.insuranceCompanyId !== undefined ? data.insuranceCompanyId : invoice.insuranceCompanyId,
    claimNumber: data.claimNumber ?? invoice.claimNumber,
    billTo: data.billTo && BILL_TO.includes(data.billTo) ? data.billTo : invoice.billTo,
    splitBilling: { ...invoice.splitBilling, ...data.splitBilling },
    items: Array.isArray(data.items) ? data.items.map((it, i) => ({ id: it.id ?? i + 1, description: it.description || "", quantity: it.quantity ?? 1, unitPrice: it.unitPrice ?? 0 })) : invoice.items,
    tax: data.tax ?? invoice.tax,
    discount: data.discount ?? invoice.discount,
    invoiceDate: data.invoiceDate ?? invoice.invoiceDate,
    dueDate: data.dueDate ?? invoice.dueDate,
    template: data.template && TEMPLATES.includes(data.template) ? data.template : invoice.template,
    customSections: data.customSections ? { ...invoice.customSections, ...data.customSections } : invoice.customSections,
    notes: data.notes ?? invoice.notes,
    internalNotes: data.internalNotes ?? invoice.internalNotes,
    updatedAt: new Date().toISOString(),
  });

  pushAudit(invoice, user, "Updated", null, null);
  persist();
  return withComputed(invoice);
}

function markSent(id, user) {
  const invoice = invoices.find((i) => i.id === Number(id));
  if (!invoice) return null;
  const oldStatus = invoice.status;
  invoice.status = "Sent";
  invoice.updatedAt = new Date().toISOString();
  pushAudit(invoice, user, "Sent", { status: oldStatus }, { status: "Sent" });
  persist();
  return withComputed(invoice);
}

function markViewed(token) {
  const invoice = invoices.find((i) => i.publicToken === token);
  if (!invoice) return null;
  if (invoice.status === "Sent") {
    invoice.status = "Viewed";
    invoice.updatedAt = new Date().toISOString();
    pushAudit(invoice, "Customer", "Viewed", null, null);
    persist();
  }
  return withComputed(invoice);
}

function addPayment(id, data, user) {
  const invoice = invoices.find((i) => i.id === Number(id));
  if (!invoice) return null;
  invoice.payments.push({
    id: invoice.payments.length + 1,
    paymentDate: data.paymentDate || new Date().toISOString().slice(0, 10),
    paymentMethod: data.paymentMethod || "",
    referenceNumber: data.referenceNumber || "",
    amount: Number(data.amount || 0),
    notes: data.notes || "",
  });
  invoice.updatedAt = new Date().toISOString();
  pushAudit(invoice, user, "Payment Recorded", null, { amount: data.amount });
  persist();
  return withComputed(invoice);
}

function voidInvoice(id, user, reason) {
  const invoice = invoices.find((i) => i.id === Number(id));
  if (!invoice) return null;
  const oldStatus = invoice.status;
  invoice.status = "Void";
  if (reason) invoice.notes = `${invoice.notes ? invoice.notes + " | " : ""}Void: ${reason}`;
  invoice.updatedAt = new Date().toISOString();
  pushAudit(invoice, user, "Voided", { status: oldStatus }, { status: "Void" });
  persist();
  return withComputed(invoice);
}

function remove(id) {
  const index = invoices.findIndex((i) => i.id === Number(id));
  if (index === -1) return false;
  invoices.splice(index, 1);
  persist();
  return true;
}

module.exports = {
  STATUSES,
  BILL_TO,
  TEMPLATES,
  SECTION_KEYS,
  list,
  get,
  getByToken,
  getPublicByToken,
  createFromWorkOrder,
  update,
  markSent,
  markViewed,
  addPayment,
  void: voidInvoice,
  remove,
};
