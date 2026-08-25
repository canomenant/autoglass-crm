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

// The linear flow, in order. Cancelled is deliberately absent: it is an override, not a step, so
// nothing automatic can move an order out of it or into it.
const FLOW_ORDER = ["Scheduled", "Assigned", "In Progress", "Completed", "Paid", "Closed"];

// Automatic transitions only ever move forward. Assigning a technician to an order that is already
// Paid must not drag it back to Assigned, and re-assigning a tech on a Closed job must not reopen
// it. A status outside the flow (Cancelled, or anything hand-entered) is left alone entirely —
// automation has no opinion about states it does not understand.
//
// Manual changes do not come through here at all: update() takes data.status as given, so a person
// can always override in either direction, including undoing something this decided.
function advanceStatus(current, target) {
  const from = FLOW_ORDER.indexOf(current);
  const to = FLOW_ORDER.indexOf(target);
  if (from === -1 || to === -1) return current;
  return to > from ? target : current;
}

// "Paid" means the balance reached zero, not that some money arrived. A deposit on a $500 job
// leaves it where it was.
function isFullyPaid(workOrder) {
  const total = Number(workOrder.totalSale || 0);
  const paid = Number(workOrder.payment?.amount || 0);
  if (total <= 0) return false;
  return roundMoney(paid) >= roundMoney(total);
}

function roundMoney(n) {
  return Math.round(Number(n || 0) * 100) / 100;
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
// Un numero que llega como texto libre desde una linea de presupuesto tecleada a mano. Sumar sin
// filtrar reventaba la consulta entera con "invalid input syntax for type numeric" por una sola
// linea con un guion o un signo de dolar; lo que no es un numero no suma.
const NUM = (expr) => `NULLIF(regexp_replace(${expr}, '[^0-9.-]', '', 'g'), '')::numeric`;

// Las columnas de Configure View que salen de quotes.line_items y de customers. Se agregan por
// orden de trabajo porque una orden puede tener varias lineas -dos vidrios de dos distribuidores
// distintos-, y la tabla muestra una celda por orden: por eso van unidas con coma y sin repetir.
const DETALLE_DE_LINEAS = `
  LEFT JOIN LATERAL (
    SELECT
      string_agg(DISTINCT NULLIF(btrim(x->>'distributor'), ''), ', ')      AS li_distributors,
      string_agg(DISTINCT NULLIF(btrim(x->>'orderNumber'), ''), ', ')      AS li_order_numbers,
      string_agg(DISTINCT NULLIF(btrim(x->>'priceTier'), ''), ', ')        AS li_price_tiers,
      string_agg(DISTINCT NULLIF(btrim(x->>'calibrationType'), ''), ', ')  AS li_calibration_types,
      string_agg(DISTINCT NULLIF(btrim(x->>'nagsDescription'), ''), ' | ') AS li_descriptions,
      sum(${NUM("x->>'pricePart'")})                                       AS li_part_cost,
      sum(${NUM("x->>'calibrationAmount'")})                               AS li_calibration_amount
    FROM jsonb_array_elements(COALESCE(q.line_items, '[]'::jsonb)) x
  ) li ON true`;

const CAMPOS_DERIVADOS = `
  q.agent_name, q.tax_rate,
  q.discount->>'type' AS discount_type,
  ${NUM("q.discount->>'value'")} AS discount_value,
  ${NUM("q.insurance->>'deductible'")} AS deductible,
  c.phone_alt AS customer_phone_alt, c.city AS customer_city,
  c.state AS customer_state, c.zip_code AS customer_zip_code,
  li.li_distributors, li.li_order_numbers, li.li_price_tiers, li.li_calibration_types,
  li.li_descriptions, li.li_part_cost, li.li_calibration_amount`;

async function list() {
  const r = await pool.query(
    `SELECT w.id, w.work_order_no, w.work_order_type, w.vehicle_id, w.vehicle_year, w.vehicle_make,
       w.vehicle_model, w.vehicle_body_type, w.vehicle_vin, w.distributor_id, w.distributor, w.tech,
       w.part_number, w.job_type, w.labor_cost, w.glass_cost, w.total_sale, w.status,
       w.appointment_date, w.created_at, w.quote_id, w.customer_id, w.technician_id, w.quote_no,
       w.customer_name, w.phone, w.email, w.address, w.insurance_company_id, w.claim_number,
       w.policy_number, w.priority, w.glass_type, w.nags_description, w.appointment_time,
       w.appointment_duration_minutes, w.special_instructions, w.tech_instructions, w.internal_notes,
       w.cancellation_reason, w.cancelled_at, w.payment, w.payment_history, w.public_token,
       w.payment_token, w.active, w.deleted_at, w.created_by, w.updated_by, w.updated_at,
       w.commission, w.invoice_mode, w.state, w.is_chargeback,
       ${CAMPOS_DERIVADOS}
     FROM work_orders w
     LEFT JOIN quotes q ON q.id = w.quote_id
     LEFT JOIN customers c ON c.id = w.customer_id
     ${DETALLE_DE_LINEAS}
     WHERE w.active <> false ORDER BY w.created_at`
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

// Writes arriving through the technician's mobile link. Separate from update() on purpose: that
// one is for people with a session, this one is for a bearer of an unguessable token, and the two
// must not share a code path where a field could leak from one into the other. Only status and
// techPhotos are writable, and every call is recorded.
//
// The audit exists because the caller is, by construction, anonymous. The token is issued per work
// order and sent to one technician, so recording which technician it was issued to is the closest
// thing to an identity this path can have — it says who was given the ability, not who exercised it.
// A forwarded link is exactly the case where those two differ, which is what makes the record worth
// keeping.
async function updateFromMobileLink(token, data) {
  const workOrder = await getByToken(token);
  if (!workOrder) return null;

  const changes = {};
  if (data.status !== undefined && data.status !== workOrder.status) {
    changes.status = { from: workOrder.status, to: data.status };
    workOrder.status = data.status;
  }
  if (Array.isArray(data.techPhotos) && data.techPhotos.length !== (workOrder.techPhotos || []).length) {
    changes.techPhotos = { from: (workOrder.techPhotos || []).length, to: data.techPhotos.length };
  }
  if (Array.isArray(data.techPhotos)) workOrder.techPhotos = data.techPhotos;

  if (Object.keys(changes).length) {
    if (!Array.isArray(workOrder.publicAccessLog)) workOrder.publicAccessLog = [];
    workOrder.publicAccessLog.push({
      timestamp: new Date().toISOString(),
      via: "mobile-link",
      // Who the link was issued to. Not necessarily who used it.
      issuedToTechnicianId: workOrder.technicianId ?? null,
      issuedToTechnician: workOrder.tech || "",
      changes,
    });
    workOrder.updatedAt = new Date().toISOString();
    workOrder.updatedBy = workOrder.tech ? `${workOrder.tech} (mobile link)` : "Mobile link";
    await writeWorkOrderToSql(workOrder);
  }

  return workOrder;
}

// Revocation rather than expiry: a technician may legitimately need the link days later, so it does
// not time out — but a leaked one has to be killable in a click. Issuing a new token invalidates
// the previous one immediately, since lookup is by exact token.
async function regenerateMobileToken(id, actor) {
  const workOrder = await get(id);
  if (!workOrder) return null;
  const previous = workOrder.publicToken;
  workOrder.publicToken = genToken();
  if (!Array.isArray(workOrder.publicAccessLog)) workOrder.publicAccessLog = [];
  workOrder.publicAccessLog.push({
    timestamp: new Date().toISOString(),
    via: "token-regenerated",
    actor: actor || "System",
    // The old token is not stored — only that one existed and stopped working, which is what
    // someone reading this log later needs to know.
    hadPreviousToken: !!previous,
  });
  workOrder.updatedAt = new Date().toISOString();
  await writeWorkOrderToSql(workOrder);
  return workOrder;
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
       is_chargeback, public_access_log)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,
       $25,$26,$27,$28,$29,$30,$31,$32,$33,$34,$35,$36,$37,$38,$39,$40,$41,$42,$43,$44,$45,$46,$47,$48,$49,$50,$51,
       $52,$53)
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
       is_chargeback = EXCLUDED.is_chargeback, public_access_log = EXCLUDED.public_access_log`,
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
      JSON.stringify(workOrder.publicAccessLog || []),
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
  // Technician labor is what we PAY the tech — deliberately not quote.totals.laborTotal, which is
  // insurance.totalLabor: what we BILL the insurer. Those are different numbers that used to share
  // this field, which also left every Personal work order at 0 since that branch has no labor
  // input at all. Starts at 0 (honest: the figure isn't known yet) and gets seeded from the
  // technician's defaultLaborRate on assignment, then edited by hand.
  const laborCost = 0;
  // Derived from the line items rather than quote.glassCost, which has no input anywhere in the
  // UI and is therefore always 0 for anything created in-app. This is the field the P&L report
  // reads as its parts cost, so leaving it at 0 silently zeroed the cost side of every new job.
  const glassCost = quote.totals?.partCost ?? 0;
  const totalSale = quote.totals?.finalSalePrice ?? 0;
  // Entered by hand on the work order (and a bulk import of real per-order figures is planned).
  // Historical commissions are flat per-job amounts no percentage reproduces, so nothing is
  // computed here — 0 is honest: the number isn't known until someone supplies it.
  const commission = 0;
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
    commission,
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
  const totalSaleBefore = workOrder.totalSale;
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

  // Advances to Paid on the edge where the balance reaches zero — the same false->true discipline
  // becamePaid uses below, and for the same reason: reacting to the condition instead of the
  // transition meant an order moved back to Scheduled by hand jumped to Paid again the next time
  // anyone edited a note, so the override worked once and then undid itself.
  //
  // "Status untouched" is "same value as before", not "absent". The Work Order page saves the whole
  // record, status included, so treating any present status as a deliberate choice would have kept
  // this from ever firing from the UI at all.
  const wasSettled = isFullyPaid({ totalSale: totalSaleBefore, payment: paymentBefore });
  const statusUntouched = data.status === undefined || data.status === statusBefore;
  if (statusUntouched && !wasSettled && isFullyPaid(workOrder)) {
    workOrder.status = advanceStatus(workOrder.status, "Paid");
  }

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
  // Assigning a technician is the unambiguous trigger for Assigned. Before this, 892 orders had a
  // technician and not one of them was in Assigned — the status had to be moved by hand and never
  // was, so the tracker showed a stage the business had already passed.
  workOrder.status = advanceStatus(workOrder.status, "Assigned");
  // Seed the technician's default rate as a starting suggestion, but only into an empty field —
  // reassigning a tech must never silently overwrite a labor cost someone already entered.
  //
  // Required lazily: technicians.store.js requires this module back (to compute per-tech job
  // stats), so a top-level require here resolves to an empty object at load time and crashes the
  // server on boot. Inside the function both modules are fully initialised.
  if (!Number(workOrder.laborCost || 0) && technicianId) {
    const techniciansStore = require("./technicians.store");
    const technician = await techniciansStore.get(technicianId);
    workOrder.laborCost = roundMoney(technician?.defaultLaborRate || 0);
  }
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
  FLOW_ORDER,
  advanceStatus,
  isFullyPaid,
  updateFromMobileLink,
  regenerateMobileToken,
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
