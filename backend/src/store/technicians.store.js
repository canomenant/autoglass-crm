const crypto = require("crypto");
const workordersStore = require("./workorders.store");
const pool = require("../config/db");
const { mapTechnician } = require("../lib/sqlMappers");
const { hashPassword } = require("../lib/password");

const STATUSES = ["Active", "Inactive"];

async function computeStats(id) {
  const jobs = (await workordersStore.list()).filter((w) => w.technicianId === id);
  const completed = jobs.filter((w) => workordersStore.COMPLETED_STATUSES.includes(w.status));
  const open = jobs.filter(
    (w) => !workordersStore.COMPLETED_STATUSES.includes(w.status) && !workordersStore.CLOSED_STATUSES.includes(w.status)
  );
  const revenueGenerated = completed.reduce((sum, w) => sum + Number(w.totalSale || 0), 0);
  const averageTicket = completed.length ? revenueGenerated / completed.length : 0;
  const lastJob = jobs
    .slice()
    .sort((a, b) => new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt))[0];

  return {
    completedJobs: completed.length,
    openJobs: open.length,
    revenueGenerated,
    averageTicket,
    lastWorkOrder: lastJob ? lastJob.workOrderNo : "",
  };
}

function sanitize(item) {
  if (!item) return item;
  const { password, ...rest } = item;
  return rest;
}

async function withStats(item) {
  if (!item) return item;
  return { ...sanitize(item), stats: await computeStats(item.id) };
}

async function list() {
  const r = await pool.query("SELECT * FROM technicians WHERE active <> false ORDER BY created_at");
  return Promise.all(r.rows.map(mapTechnician).map(withStats));
}

async function get(id) {
  const r = await pool.query("SELECT * FROM technicians WHERE id = $1 AND active <> false", [id]);
  if (!r.rows[0]) return null;
  return withStats(mapTechnician(r.rows[0]));
}

async function findByEmail(email) {
  const r = await pool.query("SELECT * FROM technicians WHERE active <> false AND lower(email) = lower($1)", [email]);
  if (!r.rows[0]) return null;
  return mapTechnician(r.rows[0]);
}

// taxId/driverLicense/insuranceExpiration/notes/photo/serviceAreas/languages/canReceiveSms/
// canReceiveLinks/calendarColor have no SQL column (Fase 4 step 1 gap, never revisited) —
// accepted on create()/update() and returned in the response shape for API compatibility,
// but they don't actually persist across restarts.
function writeTechnicianToSql(item) {
  return pool.query(
    `INSERT INTO technicians (id, name, company_name, phone, mobile, email, password, must_change_password,
       address, city, state, zip_code, status, default_labor_rate, default_commission, active)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
     ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, company_name = EXCLUDED.company_name,
       phone = EXCLUDED.phone, mobile = EXCLUDED.mobile, email = EXCLUDED.email, password = EXCLUDED.password,
       must_change_password = EXCLUDED.must_change_password,
       address = EXCLUDED.address, city = EXCLUDED.city, state = EXCLUDED.state, zip_code = EXCLUDED.zip_code,
       status = EXCLUDED.status, default_labor_rate = EXCLUDED.default_labor_rate,
       default_commission = EXCLUDED.default_commission, active = EXCLUDED.active`,
    [
      item.id, item.name || "", item.companyName || "", item.phone || "", item.mobile || "", item.email || "",
      item.password || "", item.mustChangePassword || false, item.address || "", item.city || "", item.state || "",
      item.zipCode || "", item.status || "Active", item.defaultLaborRate || 0, item.defaultCommission || 0,
      item.active !== false,
    ]
  );
}

async function create(data) {
  const item = {
    id: crypto.randomUUID(),
    name: data.name || "",
    companyName: data.companyName || "",
    phone: data.phone || "",
    mobile: data.mobile || "",
    email: data.email || "",
    password: data.password ? await hashPassword(data.password) : "",
    mustChangePassword: !!data.password,
    address: data.address || "",
    city: data.city || "",
    state: data.state || "",
    zipCode: data.zipCode || "",
    taxId: data.taxId || "",
    driverLicense: data.driverLicense || "",
    insuranceExpiration: data.insuranceExpiration || "",
    notes: data.notes || "",
    photo: data.photo || null,
    status: STATUSES.includes(data.status) ? data.status : "Active",
    defaultLaborRate: data.defaultLaborRate ?? 0,
    defaultCommission: data.defaultCommission ?? 0,
    serviceAreas: Array.isArray(data.serviceAreas) ? data.serviceAreas : [],
    languages: Array.isArray(data.languages) ? data.languages : [],
    canReceiveSms: data.canReceiveSms ?? true,
    canReceiveLinks: data.canReceiveLinks ?? true,
    calendarColor: data.calendarColor || "#2563eb",
    active: true,
    deletedAt: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  await writeTechnicianToSql(item);
  return withStats(item);
}

async function update(id, data) {
  const existing = await pool.query("SELECT * FROM technicians WHERE id = $1 AND active <> false", [id]);
  if (!existing.rows[0]) return null;
  const item = { ...mapTechnician(existing.rows[0]) };
  Object.assign(item, {
    name: data.name ?? item.name,
    companyName: data.companyName ?? item.companyName,
    phone: data.phone ?? item.phone,
    mobile: data.mobile ?? item.mobile,
    email: data.email ?? item.email,
    password: data.password ? await hashPassword(data.password) : item.password,
    mustChangePassword: data.mustChangePassword ?? item.mustChangePassword,
    address: data.address ?? item.address,
    city: data.city ?? item.city,
    state: data.state ?? item.state,
    zipCode: data.zipCode ?? item.zipCode,
    taxId: data.taxId ?? item.taxId,
    driverLicense: data.driverLicense ?? item.driverLicense,
    insuranceExpiration: data.insuranceExpiration ?? item.insuranceExpiration,
    notes: data.notes ?? item.notes,
    photo: data.photo !== undefined ? data.photo : item.photo,
    status: data.status && STATUSES.includes(data.status) ? data.status : item.status,
    defaultLaborRate: data.defaultLaborRate ?? item.defaultLaborRate,
    defaultCommission: data.defaultCommission ?? item.defaultCommission,
    serviceAreas: Array.isArray(data.serviceAreas) ? data.serviceAreas : item.serviceAreas,
    languages: Array.isArray(data.languages) ? data.languages : item.languages,
    canReceiveSms: data.canReceiveSms !== undefined ? data.canReceiveSms : item.canReceiveSms,
    canReceiveLinks: data.canReceiveLinks !== undefined ? data.canReceiveLinks : item.canReceiveLinks,
    calendarColor: data.calendarColor ?? item.calendarColor,
    updatedAt: new Date().toISOString(),
  });
  await writeTechnicianToSql(item);
  return withStats(item);
}

async function remove(id) {
  const r = await pool.query("UPDATE technicians SET active = false WHERE id = $1 AND active <> false", [id]);
  return r.rowCount > 0;
}

module.exports = { STATUSES, list, get, create, update, remove, findByEmail };
