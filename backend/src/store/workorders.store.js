const crypto = require("crypto");
const customersStore = require("./customers.store");
const quotesStore = require("./quotes.store");
const { loadOrSeed, save, nextIdFrom } = require("../lib/persistence");

const FILE = "workorders.json";
let workOrders = loadOrSeed(FILE, () => []);
let nextId = nextIdFrom(workOrders);

function persist() {
  save(FILE, workOrders);
}

const STATUSES = ["Scheduled", "Assigned", "In Progress", "Completed", "Paid", "Closed", "Cancelled"];

const COMPLETED_STATUSES = ["Completed", "Paid"];
const CLOSED_STATUSES = ["Closed"];
// "Terminal" = no longer active/open, for scheduling and dashboard filters. Distinct from
// CLOSED_STATUSES because Closed (successful) and Cancelled (lost opportunity) must be
// reported separately even though both mean "this work order won't move forward."
const TERMINAL_STATUSES = ["Closed", "Cancelled"];

const CANCELLATION_REASONS = [
  "Customer Cancelled",
  "Insurance Declined Claim",
  "Customer Never Responded",
  "Pricing Rejected",
  "Duplicate Order",
  "No Authorization Received",
  "Other",
];

// One-time reconciliation: Work Order status was collapsed from 16 values down to a flat
// 6-value operations pipeline. Remap any legacy status still on disk to its closest
// equivalent so old records keep displaying/filtering correctly. "Cancelled" is deliberately
// NOT remapped anymore — it is a real, separately-tracked status again.
const LEGACY_STATUS_MAP = {
  "New": "Scheduled",
  "Accepted": "Assigned",
  "Waiting Customer": "Scheduled",
  "Waiting Parts": "Scheduled",
  "Rescheduled": "Scheduled",
  "Completed Pending Payment": "Completed",
  "Warranty": "Completed",
  "Rework Required": "In Progress",
  "Charge Back": "Closed",
  "No Show": "Closed",
};

(function migrateLegacyStatuses() {
  let changed = false;
  for (const workOrder of workOrders) {
    if (LEGACY_STATUS_MAP[workOrder.status]) {
      workOrder.status = LEGACY_STATUS_MAP[workOrder.status];
      changed = true;
    }
  }
  if (changed) persist();
})();

// Backfill payment tracking fields added when payment functionality moved from Quotes to Work Orders.
(function migratePaymentShape() {
  let changed = false;
  for (const workOrder of workOrders) {
    if (!Array.isArray(workOrder.paymentHistory)) {
      workOrder.paymentHistory = [];
      changed = true;
    }
    if (workOrder.payment && (workOrder.payment.cashComeback === undefined || workOrder.payment.authorizationId === undefined)) {
      workOrder.payment.cashComeback = workOrder.payment.cashComeback ?? 0;
      workOrder.payment.authorizationId = workOrder.payment.authorizationId ?? "";
      changed = true;
    }
    if (workOrder.techInstructions === undefined) {
      workOrder.techInstructions = "";
      changed = true;
    }
    if (workOrder.internalNotes === undefined) {
      workOrder.internalNotes = "";
      changed = true;
    }
    if (workOrder.cancellationReason === undefined) {
      workOrder.cancellationReason = "";
      changed = true;
    }
    if (workOrder.cancelledAt === undefined) {
      workOrder.cancelledAt = null;
      changed = true;
    }
  }
  if (changed) persist();
})();

// Backfill Work Order Type for records created before the Personal/Insurance distinction —
// derive it from the originating Quote when available, defaulting to Personal otherwise.
(function migrateWorkOrderType() {
  let changed = false;
  for (const workOrder of workOrders) {
    if (workOrder.workOrderType !== "Personal" && workOrder.workOrderType !== "Insurance") {
      const quote = workOrder.quoteId ? quotesStore.get(workOrder.quoteId) : null;
      workOrder.workOrderType = quote?.paymentType === "Insurance" ? "Insurance" : "Personal";
      changed = true;
    }
  }
  if (changed) persist();
})();

function pad(n) {
  return String(n).padStart(4, "0");
}

function genToken() {
  return crypto.randomBytes(10).toString("hex");
}

function list() {
  return workOrders.filter((w) => w.active !== false);
}

function get(id) {
  return workOrders.find((w) => w.id === Number(id) && w.active !== false);
}

function getByToken(token) {
  return workOrders.find((w) => w.publicToken === token && w.active !== false);
}

function getByPaymentToken(token) {
  return workOrders.find((w) => w.paymentToken === token && w.active !== false);
}

function ensurePaymentToken(id) {
  const workOrder = get(id);
  if (!workOrder) return null;
  if (!workOrder.paymentToken) {
    workOrder.paymentToken = genToken();
    persist();
  }
  return workOrder;
}

function resolveCustomerContact(quote) {
  if (quote.customerType === "New") {
    return {
      phone: quote.newCustomer?.phone || "",
      email: quote.newCustomer?.email || "",
      address: quote.newCustomer?.address || "",
    };
  }
  const customer = customersStore.get(quote.customerId);
  return { phone: customer?.phone || "", email: customer?.email || "", address: customer?.address || "" };
}

function createFromQuote(quote, actor) {
  const contact = resolveCustomerContact(quote);
  const jobType = quote.lineItems?.[0]?.jobType || "";
  const laborCost = quote.totals?.laborTotal ?? 0;
  const glassCost = quote.glassCost ?? 0;
  const totalSale = quote.totals?.totalAmount ?? 0;

  const workOrder = {
    id: nextId,
    workOrderNo: `WO-${pad(nextId)}`,
    quoteId: quote.id,
    quoteNo: quote.quoteNo,
    customerId: quote.customerId,
    customerName: quote.customerName,
    workOrderType: quote.paymentType === "Insurance" ? "Insurance" : "Personal",
    phone: contact.phone,
    email: contact.email,
    address: contact.address,
    vehicle: quote.vehicle,
    insuranceCompanyId: quote.insuranceCompanyId ?? null,
    claimNumber: quote.claimNumber || "",
    policyNumber: quote.policyNumber || "",
    distributorId: null,
    distributor: "",
    tech: "",
    technicianId: null,
    techAssignedAt: null,
    partNumber: quote.partNumber,
    glassType: quote.glassType || "",
    nagsDescription: quote.lineItems?.[0]?.nagsDescription || "",
    jobType,
    priority: "Normal",
    laborCost,
    glassCost,
    totalSale,
    status: "Scheduled",
    appointmentDate: quote.appointmentDate || "",
    appointmentTime: quote.startTime || "",
    appointmentDurationMinutes: 60,
    specialInstructions: "",
    techInstructions: "",
    internalNotes: "",
    cancellationReason: "",
    cancelledAt: null,
    payment: { method: "", amount: 0, paid: false, cashComeback: 0, authorizationId: "" },
    paymentHistory: [],
    publicToken: null,
    paymentToken: null,
    techPhotos: [],
    active: true,
    deletedAt: null,
    createdBy: actor || "System",
    updatedBy: actor || "System",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  workOrders.push(workOrder);
  nextId += 1;
  persist();
  return workOrder;
}

const PAYMENT_TRACKED_FIELDS = ["method", "amount", "paid", "cashComeback", "authorizationId"];

function paymentDidChange(before, after) {
  return PAYMENT_TRACKED_FIELDS.some((field) => (before?.[field] ?? "") !== (after?.[field] ?? ""));
}

function update(id, data) {
  const workOrder = get(id);
  if (!workOrder) return null;
  const paymentBefore = { ...workOrder.payment };
  const statusBefore = workOrder.status;
  Object.assign(workOrder, {
    customerName: data.customerName ?? workOrder.customerName,
    phone: data.phone ?? workOrder.phone,
    email: data.email ?? workOrder.email,
    address: data.address ?? workOrder.address,
    vehicle: { ...workOrder.vehicle, ...data.vehicle },
    insuranceCompanyId: data.insuranceCompanyId !== undefined ? data.insuranceCompanyId : workOrder.insuranceCompanyId,
    claimNumber: data.claimNumber ?? workOrder.claimNumber,
    policyNumber: data.policyNumber ?? workOrder.policyNumber,
    distributorId: data.distributorId !== undefined ? data.distributorId : workOrder.distributorId,
    distributor: data.distributor ?? workOrder.distributor,
    tech: data.tech ?? workOrder.tech,
    partNumber: data.partNumber ?? workOrder.partNumber,
    glassType: data.glassType ?? workOrder.glassType,
    nagsDescription: data.nagsDescription ?? workOrder.nagsDescription,
    jobType: data.jobType ?? workOrder.jobType,
    priority: data.priority ?? workOrder.priority,
    laborCost: data.laborCost ?? workOrder.laborCost,
    glassCost: data.glassCost ?? workOrder.glassCost,
    totalSale: data.totalSale ?? workOrder.totalSale,
    status: data.status ?? workOrder.status,
    appointmentDate: data.appointmentDate ?? workOrder.appointmentDate,
    appointmentTime: data.appointmentTime ?? workOrder.appointmentTime,
    appointmentDurationMinutes: data.appointmentDurationMinutes ?? workOrder.appointmentDurationMinutes,
    specialInstructions: data.specialInstructions ?? workOrder.specialInstructions,
    techInstructions: data.techInstructions ?? workOrder.techInstructions,
    internalNotes: data.internalNotes ?? workOrder.internalNotes,
    cancellationReason: data.cancellationReason ?? workOrder.cancellationReason,
    payment: { ...workOrder.payment, ...data.payment },
    techPhotos: Array.isArray(data.techPhotos) ? data.techPhotos : workOrder.techPhotos,
    updatedBy: data.updatedBy || workOrder.updatedBy,
    updatedAt: new Date().toISOString(),
  });

  if (workOrder.status === "Cancelled" && statusBefore !== "Cancelled") {
    workOrder.cancelledAt = new Date().toISOString();
  } else if (workOrder.status !== "Cancelled" && statusBefore === "Cancelled") {
    workOrder.cancelledAt = null;
    workOrder.cancellationReason = "";
  }

  if (data.payment && paymentDidChange(paymentBefore, workOrder.payment)) {
    if (!Array.isArray(workOrder.paymentHistory)) workOrder.paymentHistory = [];
    workOrder.paymentHistory.push({
      timestamp: new Date().toISOString(),
      actor: data.updatedBy || "System",
      method: workOrder.payment.method,
      amount: workOrder.payment.amount,
      paid: workOrder.payment.paid,
      cashComeback: workOrder.payment.cashComeback,
      authorizationId: workOrder.payment.authorizationId,
    });
  }

  persist();
  return workOrder;
}

function assignTech(id, technicianId, technicianName) {
  const workOrder = get(id);
  if (!workOrder) return null;
  workOrder.technicianId = technicianId;
  workOrder.tech = technicianName || "";
  workOrder.techAssignedAt = new Date().toISOString();
  workOrder.updatedAt = new Date().toISOString();
  if (!workOrder.publicToken) workOrder.publicToken = genToken();
  persist();
  return workOrder;
}

function remove(id) {
  const workOrder = get(id);
  if (!workOrder) return false;
  workOrder.active = false;
  workOrder.deletedAt = new Date().toISOString();
  persist();
  return true;
}

module.exports = {
  STATUSES,
  COMPLETED_STATUSES,
  CLOSED_STATUSES,
  TERMINAL_STATUSES,
  CANCELLATION_REASONS,
  list,
  get,
  getByToken,
  getByPaymentToken,
  ensurePaymentToken,
  createFromQuote,
  update,
  assignTech,
  remove,
};
