const crypto = require("crypto");
const customersStore = require("./customers.store");
const quotesStore = require("./quotes.store");
const { loadOrSeed, save, nextIdFrom } = require("../lib/persistence");
const pool = require("../config/db");
const { isShadowEnabled, shadowRead } = require("../lib/sqlShadow");
const { isDualWriteEnabled, syncToSql, nextBusinessNumber } = require("../lib/sqlSync");
const { mapWorkOrder } = require("../lib/sqlMappers");

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
// Async IIFE: quotesStore.get() is async now that it can read from SQL, and this migration
// only touches legacy records that already have the field set correctly, so it's safe for
// this to finish after module load rather than block it.
(async function migrateWorkOrderType() {
  let changed = false;
  for (const workOrder of workOrders) {
    if (workOrder.workOrderType !== "Personal" && workOrder.workOrderType !== "Insurance") {
      const quote = workOrder.quoteId ? await quotesStore.get(workOrder.quoteId) : null;
      workOrder.workOrderType = quote?.paymentType === "Insurance" ? "Insurance" : "Personal";
      changed = true;
    }
  }
  if (changed) persist();
})().catch((err) => console.error("migrateWorkOrderType failed:", err.message));

function pad(n) {
  return String(n).padStart(4, "0");
}

function genToken() {
  return crypto.randomBytes(10).toString("hex");
}

async function listFromSql() {
  const r = await pool.query(
    "SELECT id, work_order_no, quote_id, customer_id, tech, distributor, status, total_sale FROM work_orders"
  );
  return r.rows;
}

function compareWorkOrder(json, sql) {
  const diffs = [];
  if ((json.status || "") !== (sql.status || "")) diffs.push(`status: '${json.status}' vs '${sql.status}'`);
  if ((json.tech || "") !== (sql.tech || "")) diffs.push(`tech: '${json.tech}' vs '${sql.tech}'`);
  if ((json.distributor || "") !== (sql.distributor || "")) diffs.push(`distributor: '${json.distributor}' vs '${sql.distributor}'`);
  if (Number(json.totalSale || 0) !== Number(sql.total_sale || 0)) diffs.push(`totalSale: ${json.totalSale} vs ${sql.total_sale}`);
  if (!!json.quoteId !== !!sql.quote_id) diffs.push(`quoteId presence: ${!!json.quoteId} vs ${!!sql.quote_id}`);
  return diffs.length ? diffs : null;
}

function sqlSourceActive() {
  return process.env.WORKORDERS_SOURCE === "sql";
}

function runShadow(result) {
  if (!isShadowEnabled(process.env.WORKORDERS_SOURCE)) return;
  shadowRead({
    label: "workorders",
    jsonResult: result,
    sqlQueryFn: listFromSql,
    matchKeyFn: (w) => w.id,
    compareFn: compareWorkOrder,
  }).catch(() => {});
}

async function list() {
  const jsonResult = workOrders.filter((w) => w.active !== false);
  runShadow(jsonResult);
  if (!sqlSourceActive()) return jsonResult;
  const r = await pool.query("SELECT * FROM work_orders WHERE active <> false ORDER BY created_at");
  return r.rows.map(mapWorkOrder);
}

const SORTABLE_FIELDS = {
  woNo: (w) => w.workOrderNo,
  status: (w) => w.status,
  priority: (w) => w.priority,
  jobType: (w) => w.jobType,
  customerName: (w) => w.customerName,
  phone: (w) => w.phone,
  year: (w) => w.vehicle?.year,
  make: (w) => w.vehicle?.make,
  model: (w) => w.vehicle?.model,
  claimNumber: (w) => w.claimNumber,
  partNumber: (w) => w.partNumber,
  appointmentDate: (w) => w.appointmentDate,
  assignedTech: (w) => w.tech,
  distributorName: (w) => w.distributor,
  totalSale: (w) => Number(w.totalSale) || 0,
  glassCost: (w) => Number(w.glassCost) || 0,
  laborCost: (w) => Number(w.laborCost) || 0,
  createdDate: (w) => w.createdAt,
  lastUpdated: (w) => w.updatedAt,
};

function compareValues(a, b) {
  if (a == null && b == null) return 0;
  if (a == null) return -1;
  if (b == null) return 1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: "base" });
}

function matchesSearch(w, q) {
  const haystack = [w.workOrderNo, w.customerName, w.phone, w.claimNumber, w.vehicle?.vin, w.vehicle?.plate]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return haystack.includes(q);
}

// Filters/sorts/paginates server-side. `scope` lets callers pass an already role-restricted
// array (e.g. a technician's own work orders) instead of querying the full active set.
function query({ status, type, search, sortBy, sortDir = "asc", limit, offset = 0, scope } = {}) {
  let items = scope || list();

  if (status) items = items.filter((w) => w.status === status);
  if (type) items = items.filter((w) => (w.workOrderType || "Personal") === type);
  const q = search ? String(search).trim().toLowerCase() : "";
  if (q) items = items.filter((w) => matchesSearch(w, q));

  const total = items.length;

  const getValue = sortBy && SORTABLE_FIELDS[sortBy];
  if (getValue) {
    const dir = sortDir === "desc" ? -1 : 1;
    items = [...items].sort((a, b) => dir * compareValues(getValue(a), getValue(b)));
  }

  const lim = Number(limit) > 0 ? Number(limit) : total;
  const off = Number(offset) > 0 ? Number(offset) : 0;
  const data = items.slice(off, off + lim);

  return { data, total };
}

// Aggregate counts for the dashboard stat tiles — computed over the full (role-scoped) set,
// unaffected by the current status/type/search filters, matching the tiles' "click to filter" UX.
function summarize(scope) {
  const items = scope || list();
  const byStatus = Object.fromEntries(STATUSES.map((s) => [s, 0]));
  let personal = 0;
  let insurance = 0;
  for (const w of items) {
    if (byStatus[w.status] !== undefined) byStatus[w.status] += 1;
    if ((w.workOrderType || "Personal") === "Insurance") insurance += 1;
    else personal += 1;
  }
  return { total: items.length, personal, insurance, ...byStatus };
}

// The raw in-memory JSON array item, regardless of *_SOURCE — needed anywhere that mutates
// and calls persist() afterward, since persist() serializes this array. Using the (possibly
// SQL-sourced, disconnected) object from get() as a mutation target would silently break the
// JSON backup: Object.assign on a detached object never reaches what persist() writes out.
function findJsonWorkOrder(id) {
  return workOrders.find((w) => String(w.id) === String(id) && w.active !== false);
}

async function get(id) {
  if (sqlSourceActive()) {
    const r = await pool.query("SELECT * FROM work_orders WHERE id = $1 AND active <> false", [id]);
    if (r.rows[0]) return mapWorkOrder(r.rows[0]);
  }
  return findJsonWorkOrder(id);
}

function getByToken(token) {
  return workOrders.find((w) => w.publicToken === token && w.active !== false);
}

function getByPaymentToken(token) {
  return workOrders.find((w) => w.paymentToken === token && w.active !== false);
}

async function ensurePaymentToken(id) {
  const workOrder = findJsonWorkOrder(id) || (await get(id));
  if (!workOrder) return null;
  if (!workOrder.paymentToken) {
    workOrder.paymentToken = genToken();
    persist();
    if (sqlSourceActive()) await writeWorkOrderToSql(workOrder);
    else syncWorkOrderToSql(workOrder).catch(() => {});
  }
  return workOrder;
}

async function resolveCustomerContact(quote) {
  if (quote.customerType === "New") {
    return {
      phone: quote.newCustomer?.phone || "",
      email: quote.newCustomer?.email || "",
      address: quote.newCustomer?.address || "",
    };
  }
  const customer = await customersStore.get(quote.customerId);
  return { phone: customer?.phone || "", email: customer?.email || "", address: customer?.address || "" };
}

// technician_id is left NULL here: technicians.store.js isn't migrated yet, and the live
// app's technicianId (still an integer) doesn't correspond to the UUID technicians.id in SQL.
// vehicle_id is left NULL too — vehicleTypes stays out of dual-write per your instruction.
// The flat text fields (tech, distributor, vehicle_year/make/model/...) still carry the real
// data either way, so nothing is lost, only the optional FK link is absent.
function writeWorkOrderToSql(workOrder) {
  return pool.query(
    `INSERT INTO work_orders (id, work_order_no, quote_id, customer_id, work_order_type,
       vehicle_year, vehicle_make, vehicle_model, vehicle_body_type, vehicle_vin,
       distributor, tech, part_number, job_type, labor_cost, glass_cost, total_sale,
       status, appointment_date, quote_no, customer_name, phone, email, address,
       insurance_company_id, claim_number, policy_number, priority, glass_type, nags_description,
       appointment_time, appointment_duration_minutes, special_instructions, tech_instructions,
       internal_notes, cancellation_reason, cancelled_at, payment, payment_history, public_token,
       payment_token, tech_photos, active, deleted_at, created_by, updated_by, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,
       $25,$26,$27,$28,$29,$30,$31,$32,$33,$34,$35,$36,$37,$38,$39,$40,$41,$42,$43,$44,$45,$46,$47)
     ON CONFLICT (id) DO UPDATE SET quote_id = EXCLUDED.quote_id, customer_id = EXCLUDED.customer_id,
       work_order_type = EXCLUDED.work_order_type, vehicle_year = EXCLUDED.vehicle_year,
       vehicle_make = EXCLUDED.vehicle_make, vehicle_model = EXCLUDED.vehicle_model,
       vehicle_body_type = EXCLUDED.vehicle_body_type, vehicle_vin = EXCLUDED.vehicle_vin,
       distributor = EXCLUDED.distributor, tech = EXCLUDED.tech, part_number = EXCLUDED.part_number,
       job_type = EXCLUDED.job_type, labor_cost = EXCLUDED.labor_cost, glass_cost = EXCLUDED.glass_cost,
       total_sale = EXCLUDED.total_sale, status = EXCLUDED.status, appointment_date = EXCLUDED.appointment_date,
       quote_no = EXCLUDED.quote_no, customer_name = EXCLUDED.customer_name, phone = EXCLUDED.phone,
       email = EXCLUDED.email, address = EXCLUDED.address, insurance_company_id = EXCLUDED.insurance_company_id,
       claim_number = EXCLUDED.claim_number, policy_number = EXCLUDED.policy_number, priority = EXCLUDED.priority,
       glass_type = EXCLUDED.glass_type, nags_description = EXCLUDED.nags_description,
       appointment_time = EXCLUDED.appointment_time, appointment_duration_minutes = EXCLUDED.appointment_duration_minutes,
       special_instructions = EXCLUDED.special_instructions, tech_instructions = EXCLUDED.tech_instructions,
       internal_notes = EXCLUDED.internal_notes, cancellation_reason = EXCLUDED.cancellation_reason,
       cancelled_at = EXCLUDED.cancelled_at, payment = EXCLUDED.payment, payment_history = EXCLUDED.payment_history,
       public_token = EXCLUDED.public_token, payment_token = EXCLUDED.payment_token, tech_photos = EXCLUDED.tech_photos,
       active = EXCLUDED.active, deleted_at = EXCLUDED.deleted_at, updated_by = EXCLUDED.updated_by,
       updated_at = EXCLUDED.updated_at`,
    [
      workOrder.id, workOrder.workOrderNo, workOrder.quoteId, workOrder.customerId, workOrder.workOrderType,
      workOrder.vehicle?.year || "", workOrder.vehicle?.make || "", workOrder.vehicle?.model || "",
      workOrder.vehicle?.bodyType || "", workOrder.vehicle?.vin || "", workOrder.distributor || "",
      workOrder.tech || "", workOrder.partNumber || "", workOrder.jobType || "", workOrder.laborCost || 0,
      workOrder.glassCost || 0, workOrder.totalSale || 0, workOrder.status, workOrder.appointmentDate || null,
      workOrder.quoteNo || "", workOrder.customerName || "", workOrder.phone || "", workOrder.email || "",
      workOrder.address || "", workOrder.insuranceCompanyId || null, workOrder.claimNumber || "",
      workOrder.policyNumber || "", workOrder.priority || "Normal", workOrder.glassType || "",
      workOrder.nagsDescription || "", workOrder.appointmentTime || "", workOrder.appointmentDurationMinutes ?? 60,
      workOrder.specialInstructions || "", workOrder.techInstructions || "", workOrder.internalNotes || "",
      workOrder.cancellationReason || "", workOrder.cancelledAt || null, JSON.stringify(workOrder.payment || {}),
      JSON.stringify(workOrder.paymentHistory || []), workOrder.publicToken || null, workOrder.paymentToken || null,
      JSON.stringify(workOrder.techPhotos || []), workOrder.active !== false, workOrder.deletedAt || null,
      workOrder.createdBy || "System", workOrder.updatedBy || "System", workOrder.updatedAt || null,
    ]
  );
}

function syncWorkOrderToSql(workOrder) {
  if (!isDualWriteEnabled()) return Promise.resolve();
  return syncToSql({
    entity: "workorders",
    id: workOrder.id,
    businessKey: workOrder.workOrderNo,
    sqlFn: () => writeWorkOrderToSql(workOrder),
  });
}

async function createFromQuote(quote, actor) {
  const contact = await resolveCustomerContact(quote);
  const jobType = quote.lineItems?.[0]?.jobType || "";
  const laborCost = quote.totals?.laborTotal ?? 0;
  const glassCost = quote.glassCost ?? 0;
  const totalSale = quote.totals?.totalAmount ?? 0;
  const num = await nextBusinessNumber({ pool, table: "work_orders", column: "work_order_no", jsonNextId: nextId });

  const workOrder = {
    id: crypto.randomUUID(),
    workOrderNo: `WO-${pad(num)}`,
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
  nextId = Math.max(nextId, num) + 1;
  persist();
  if (sqlSourceActive()) {
    await writeWorkOrderToSql(workOrder);
  } else {
    syncWorkOrderToSql(workOrder).catch(() => {});
  }
  return workOrder;
}

const PAYMENT_TRACKED_FIELDS = ["method", "amount", "paid", "cashComeback", "authorizationId"];

function paymentDidChange(before, after) {
  return PAYMENT_TRACKED_FIELDS.some((field) => (before?.[field] ?? "") !== (after?.[field] ?? ""));
}

async function update(id, data) {
  const workOrder = findJsonWorkOrder(id) || (await get(id));
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
  if (sqlSourceActive()) {
    await writeWorkOrderToSql(workOrder);
  } else {
    syncWorkOrderToSql(workOrder).catch(() => {});
  }
  return workOrder;
}

async function assignTech(id, technicianId, technicianName) {
  const workOrder = findJsonWorkOrder(id) || (await get(id));
  if (!workOrder) return null;
  workOrder.technicianId = technicianId;
  workOrder.tech = technicianName || "";
  workOrder.techAssignedAt = new Date().toISOString();
  workOrder.updatedAt = new Date().toISOString();
  if (!workOrder.publicToken) workOrder.publicToken = genToken();
  persist();
  if (sqlSourceActive()) {
    await writeWorkOrderToSql(workOrder);
  } else {
    syncWorkOrderToSql(workOrder).catch(() => {});
  }
  return workOrder;
}

async function remove(id) {
  const workOrder = findJsonWorkOrder(id) || (await get(id));
  if (!workOrder) return false;
  workOrder.active = false;
  workOrder.deletedAt = new Date().toISOString();
  persist();
  if (sqlSourceActive()) {
    await pool.query("UPDATE work_orders SET active = false, deleted_at = $2 WHERE id = $1", [workOrder.id, workOrder.deletedAt]);
  } else if (isDualWriteEnabled()) {
    syncToSql({
      entity: "workorders",
      id: workOrder.id,
      businessKey: workOrder.workOrderNo,
      sqlFn: () => pool.query("DELETE FROM work_orders WHERE id = $1", [workOrder.id]),
    }).catch(() => {});
  }
  return true;
}

module.exports = {
  STATUSES,
  COMPLETED_STATUSES,
  CLOSED_STATUSES,
  TERMINAL_STATUSES,
  CANCELLATION_REASONS,
  list,
  query,
  summarize,
  get,
  getByToken,
  getByPaymentToken,
  ensurePaymentToken,
  createFromQuote,
  update,
  assignTech,
  remove,
  listFromSql,
};
