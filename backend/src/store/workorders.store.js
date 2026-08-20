const crypto = require("crypto");
const customersStore = require("./customers.store");
const quotesStore = require("./quotes.store");
const partnerDistributionsStore = require("./partnerDistributions.store");
const pool = require("../config/db");
const { mapWorkOrder } = require("../lib/sqlMappers");

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

function pad(n) {
  return String(n).padStart(4, "0");
}

function genToken() {
  return crypto.randomBytes(10).toString("hex");
}

// Historical synthesized records (WO-0001..WO-3865) already occupy that number range —
// new work orders must continue past the highest one either side has ever used.
async function nextWorkOrderNumber() {
  const r = await pool.query(
    "SELECT COALESCE(MAX((regexp_replace(work_order_no, '\\D', '', 'g'))::int), 0) AS max_num FROM work_orders"
  );
  return (Number(r.rows[0] && r.rows[0].max_num) || 0) + 1;
}

// Excludes tech_photos — same rationale as quotes.store.js's list(): query() filters/sorts
// in-memory over what list() already fetched, so this is the query behind every list-page
// request. get(id) below keeps SELECT * for the single-record detail view, where photos are needed.
async function list() {
  const r = await pool.query(
    `SELECT id, work_order_no, work_order_type, vehicle_id, vehicle_year, vehicle_make, vehicle_model,
       vehicle_body_type, vehicle_vin, distributor_id, distributor, tech, part_number, job_type,
       labor_cost, glass_cost, total_sale, status, appointment_date, created_at, quote_id, customer_id,
       technician_id, quote_no, customer_name, phone, email, address, insurance_company_id, claim_number,
       policy_number, priority, glass_type, nags_description, appointment_time, appointment_duration_minutes,
       special_instructions, tech_instructions, internal_notes, cancellation_reason, cancelled_at, payment,
       payment_history, public_token, payment_token, active, deleted_at, created_by, updated_by, updated_at,
       commission, invoice_mode, state, is_chargeback
     FROM work_orders WHERE active <> false ORDER BY created_at`
  );
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
  let items = scope || [];

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
  const items = scope || [];
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

async function get(id) {
  const r = await pool.query("SELECT * FROM work_orders WHERE id = $1 AND active <> false", [id]);
  if (!r.rows[0]) return null;
  return mapWorkOrder(r.rows[0]);
}

function getByToken(token) {
  return pool
    .query("SELECT * FROM work_orders WHERE public_token = $1 AND active <> false", [token])
    .then((r) => (r.rows[0] ? mapWorkOrder(r.rows[0]) : null));
}

function getByPaymentToken(token) {
  return pool
    .query("SELECT * FROM work_orders WHERE payment_token = $1 AND active <> false", [token])
    .then((r) => (r.rows[0] ? mapWorkOrder(r.rows[0]) : null));
}

async function ensurePaymentToken(id) {
  const workOrder = await get(id);
  if (!workOrder) return null;
  if (!workOrder.paymentToken) {
    workOrder.paymentToken = genToken();
    await writeWorkOrderToSql(workOrder);
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

// technician_id: workOrder.technicianId is already the SQL technicians.id UUID by the time it
// gets here — the /assign-tech route resolves it via techniciansStore.get() before calling
// assignTech(). The ON CONFLICT clause COALESCEs technician_id rather than overwriting it
// outright, since a caller updating unrelated fields on a work order via update() doesn't
// necessarily carry the current assignment forward (defensive, harmless once SQL is the only
// source of truth — kept for symmetry with how existing assignments must never be clobbered).
// distributor_id stays legacy integer — distributors has no SQL table (out of scope).
function writeWorkOrderToSql(workOrder) {
  return pool.query(
    `INSERT INTO work_orders (id, work_order_no, quote_id, customer_id, work_order_type,
       vehicle_year, vehicle_make, vehicle_model, vehicle_body_type, vehicle_vin,
       distributor, tech, technician_id, part_number, job_type, labor_cost, glass_cost, total_sale,
       commission, status, appointment_date, quote_no, customer_name, phone, email, address,
       insurance_company_id, claim_number, policy_number, priority, glass_type, nags_description,
       appointment_time, appointment_duration_minutes, special_instructions, tech_instructions,
       internal_notes, cancellation_reason, cancelled_at, payment, payment_history, public_token,
       payment_token, tech_photos, active, deleted_at, created_by, updated_by, updated_at, invoice_mode, state,
       is_chargeback)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,
       $25,$26,$27,$28,$29,$30,$31,$32,$33,$34,$35,$36,$37,$38,$39,$40,$41,$42,$43,$44,$45,$46,$47,$48,$49,$50,$51,
       $52)
     ON CONFLICT (id) DO UPDATE SET quote_id = EXCLUDED.quote_id, customer_id = EXCLUDED.customer_id,
       work_order_type = EXCLUDED.work_order_type, vehicle_year = EXCLUDED.vehicle_year,
       vehicle_make = EXCLUDED.vehicle_make, vehicle_model = EXCLUDED.vehicle_model,
       vehicle_body_type = EXCLUDED.vehicle_body_type, vehicle_vin = EXCLUDED.vehicle_vin,
       distributor = EXCLUDED.distributor, tech = EXCLUDED.tech,
       technician_id = COALESCE(EXCLUDED.technician_id, work_orders.technician_id),
       part_number = EXCLUDED.part_number,
       job_type = EXCLUDED.job_type, labor_cost = EXCLUDED.labor_cost, glass_cost = EXCLUDED.glass_cost,
       total_sale = EXCLUDED.total_sale, commission = EXCLUDED.commission, status = EXCLUDED.status,
       appointment_date = EXCLUDED.appointment_date,
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
       updated_at = EXCLUDED.updated_at, state = COALESCE(EXCLUDED.state, work_orders.state),
       is_chargeback = EXCLUDED.is_chargeback`,
    [
      workOrder.id, workOrder.workOrderNo, workOrder.quoteId, workOrder.customerId, workOrder.workOrderType,
      workOrder.vehicle?.year || "", workOrder.vehicle?.make || "", workOrder.vehicle?.model || "",
      workOrder.vehicle?.bodyType || "", workOrder.vehicle?.vin || "", workOrder.distributor || "",
      workOrder.tech || "", workOrder.technicianId || null, workOrder.partNumber || "", workOrder.jobType || "",
      workOrder.laborCost || 0, workOrder.glassCost || 0, workOrder.totalSale || 0, workOrder.commission || 0,
      workOrder.status,
      workOrder.appointmentDate || null, workOrder.quoteNo || "", workOrder.customerName || "",
      workOrder.phone || "", workOrder.email || "", workOrder.address || "", workOrder.insuranceCompanyId || null,
      workOrder.claimNumber || "", workOrder.policyNumber || "", workOrder.priority || "Normal",
      workOrder.glassType || "", workOrder.nagsDescription || "", workOrder.appointmentTime || "",
      workOrder.appointmentDurationMinutes ?? 60, workOrder.specialInstructions || "",
      workOrder.techInstructions || "", workOrder.internalNotes || "", workOrder.cancellationReason || "",
      workOrder.cancelledAt || null, JSON.stringify(workOrder.payment || {}),
      JSON.stringify(workOrder.paymentHistory || []), workOrder.publicToken || null, workOrder.paymentToken || null,
      JSON.stringify(workOrder.techPhotos || []), workOrder.active !== false, workOrder.deletedAt || null,
      workOrder.createdBy || "System", workOrder.updatedBy || "System", workOrder.updatedAt || null,
      workOrder.invoiceMode || "lump_sum", workOrder.state || null, workOrder.isChargeback || false,
    ]
  );
}

async function createFromQuote(quote, actor) {
  const contact = await resolveCustomerContact(quote);
  // Snapshotted at conversion, same pattern as invoiceMode/workOrderType — the customer's
  // state (captured via Google Places at intake) is the only reliable source, since work
  // orders themselves have no address-parsing logic of their own.
  const customer = quote.customerId ? await customersStore.get(quote.customerId) : null;
  const jobType = quote.lineItems?.[0]?.jobType || "";
  const laborCost = quote.totals?.laborTotal ?? 0;
  const glassCost = quote.glassCost ?? 0;
  const totalSale = quote.totals?.totalAmount ?? 0;
  const num = await nextWorkOrderNumber();

  const workOrder = {
    id: crypto.randomUUID(),
    workOrderNo: `Wo-${pad(num)}`,
    quoteId: quote.id,
    quoteNo: quote.quoteNo,
    customerId: quote.customerId,
    customerName: quote.customerName,
    workOrderType: quote.paymentType === "Insurance" ? "Insurance" : "Personal",
    invoiceMode: quote.invoiceMode || "lump_sum",
    state: customer?.state || null,
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
    commission: 0,
    status: "Scheduled",
    appointmentDate: quote.appointmentDate || "",
    appointmentTime: quote.startTime || "",
    appointmentDurationMinutes: 60,
    specialInstructions: "",
    techInstructions: "",
    internalNotes: "",
    cancellationReason: "",
    cancelledAt: null,
    isChargeback: false,
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
  await writeWorkOrderToSql(workOrder);
  return workOrder;
}

const PAYMENT_TRACKED_FIELDS = ["method", "amount", "paid", "cashComeback", "authorizationId"];

function paymentDidChange(before, after) {
  return PAYMENT_TRACKED_FIELDS.some((field) => (before?.[field] ?? "") !== (after?.[field] ?? ""));
}

async function update(id, data) {
  const workOrder = await get(id);
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
    commission: data.commission ?? workOrder.commission,
    status: data.status ?? workOrder.status,
    appointmentDate: data.appointmentDate ?? workOrder.appointmentDate,
    appointmentTime: data.appointmentTime ?? workOrder.appointmentTime,
    appointmentDurationMinutes: data.appointmentDurationMinutes ?? workOrder.appointmentDurationMinutes,
    specialInstructions: data.specialInstructions ?? workOrder.specialInstructions,
    techInstructions: data.techInstructions ?? workOrder.techInstructions,
    internalNotes: data.internalNotes ?? workOrder.internalNotes,
    cancellationReason: data.cancellationReason ?? workOrder.cancellationReason,
    isChargeback: data.isChargeback ?? workOrder.isChargeback,
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

  const becamePaid = !paymentBefore.paid && workOrder.payment.paid;

  await writeWorkOrderToSql(workOrder);

  // Fires after the write so a distribution-generation failure never blocks the payment update
  // itself (the WO is already correctly marked paid regardless). Only the false->true edge —
  // editing any other field on an already-paid WO must not re-generate distributions.
  if (becamePaid) {
    await partnerDistributionsStore.generateForWorkOrder(workOrder).catch((err) => {
      console.error(`[workorders] Failed to generate partner distributions for ${workOrder.workOrderNo}:`, err.message);
    });
  }

  return workOrder;
}

async function assignTech(id, technicianId, technicianName) {
  const workOrder = await get(id);
  if (!workOrder) return null;
  workOrder.technicianId = technicianId;
  workOrder.tech = technicianName || "";
  workOrder.techAssignedAt = new Date().toISOString();
  workOrder.updatedAt = new Date().toISOString();
  if (!workOrder.publicToken) workOrder.publicToken = genToken();
  await writeWorkOrderToSql(workOrder);
  return workOrder;
}

async function remove(id) {
  const workOrder = await get(id);
  if (!workOrder) return false;
  const deletedAt = new Date().toISOString();
  await pool.query("UPDATE work_orders SET active = false, deleted_at = $2 WHERE id = $1", [id, deletedAt]);
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
  // Exposed for one-off bulk-import scripts that need an exact, pre-assigned work_order_no —
  // createFromQuote always auto-numbers via nextWorkOrderNumber() and can't be used for that.
  writeWorkOrderToSql,
};
