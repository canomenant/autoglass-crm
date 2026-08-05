const workordersStore = require("./workorders.store");
const { loadOrSeed, save, nextIdFrom } = require("../lib/persistence");
const pool = require("../config/db");
const { isShadowEnabled, shadowRead } = require("../lib/sqlShadow");

const FILE = "technicians.json";
let items = loadOrSeed(FILE, () => []);
let nextId = nextIdFrom(items);

function persist() {
  save(FILE, items);
}

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

async function listFromSql() {
  const r = await pool.query("SELECT id, name, phone, email, status, default_labor_rate FROM technicians");
  return r.rows;
}

function compareTechnician(json, sql) {
  const diffs = [];
  if ((json.phone || "") !== (sql.phone || "")) diffs.push(`phone: '${json.phone}' vs '${sql.phone}'`);
  if ((json.status || "") !== (sql.status || "")) diffs.push(`status: '${json.status}' vs '${sql.status}'`);
  return diffs.length ? diffs : null;
}

async function list() {
  const result = await Promise.all(items.filter((i) => i.active !== false).map(withStats));
  // Read-only shadow only — findByEmail()/login below is never touched, still JSON-only,
  // since the SQL technicians table has no password column (known gap from earlier this session).
  if (isShadowEnabled()) {
    shadowRead({
      label: "technicians",
      jsonResult: result,
      sqlQueryFn: listFromSql,
      matchKeyFn: (t) => (t.name || "").trim().toLowerCase(),
      compareFn: compareTechnician,
    }).catch(() => {});
  }
  return result;
}

async function get(id) {
  return withStats(items.find((i) => i.id === Number(id) && i.active !== false));
}

function findByEmail(email) {
  return items.find((i) => i.active !== false && i.email && i.email.toLowerCase() === String(email).toLowerCase());
}

function create(data) {
  const item = {
    id: nextId,
    name: data.name || "",
    companyName: data.companyName || "",
    phone: data.phone || "",
    mobile: data.mobile || "",
    email: data.email || "",
    password: data.password || "",
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
  items.push(item);
  nextId += 1;
  persist();
  return withStats(item);
}

function update(id, data) {
  const item = items.find((i) => i.id === Number(id) && i.active !== false);
  if (!item) return null;
  Object.assign(item, {
    name: data.name ?? item.name,
    companyName: data.companyName ?? item.companyName,
    phone: data.phone ?? item.phone,
    mobile: data.mobile ?? item.mobile,
    email: data.email ?? item.email,
    password: data.password ?? item.password,
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
  persist();
  return withStats(item);
}

function remove(id) {
  const item = items.find((i) => i.id === Number(id) && i.active !== false);
  if (!item) return false;
  item.active = false;
  item.deletedAt = new Date().toISOString();
  persist();
  return true;
}

module.exports = { STATUSES, list, get, create, update, remove, findByEmail, listFromSql };
