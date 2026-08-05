const { loadOrSeed, save, nextIdFrom } = require("../lib/persistence");
const pool = require("../config/db");
const { isShadowEnabled, shadowRead } = require("../lib/sqlShadow");

const FILE = "insurance.json";
let companies = loadOrSeed(FILE, () => []);
let nextId = nextIdFrom(companies);

function persist() {
  save(FILE, companies);
}

async function listFromSql() {
  const r = await pool.query("SELECT id, name, phone, email, address FROM insurance_companies");
  return r.rows;
}

function compareInsurance(json, sql) {
  const diffs = [];
  if ((json.phone || "") !== (sql.phone || "")) diffs.push(`phone: '${json.phone}' vs '${sql.phone}'`);
  if ((json.email || "") !== (sql.email || "")) diffs.push(`email: '${json.email}' vs '${sql.email}'`);
  return diffs.length ? diffs : null;
}

function list() {
  const result = companies.filter((c) => c.active !== false);
  // Both sides are currently empty (no source data exists for either) — included for
  // completeness; will just report "0 aligned" until either side gets real data.
  if (isShadowEnabled()) {
    shadowRead({
      label: "insurance",
      jsonResult: result,
      sqlQueryFn: listFromSql,
      matchKeyFn: (c) => (c.name || "").trim().toLowerCase(),
      compareFn: compareInsurance,
    }).catch(() => {});
  }
  return result;
}

function get(id) {
  return companies.find((c) => c.id === Number(id) && c.active !== false);
}

function create(data) {
  const company = {
    id: nextId,
    name: data.name || "",
    phone: data.phone || "",
    email: data.email || "",
    address: data.address || "",
    notes: data.notes || "",
    active: true,
    deletedAt: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  companies.push(company);
  nextId += 1;
  persist();
  return company;
}

function update(id, data) {
  const company = get(id);
  if (!company) return null;
  Object.assign(company, {
    name: data.name ?? company.name,
    phone: data.phone ?? company.phone,
    email: data.email ?? company.email,
    address: data.address ?? company.address,
    notes: data.notes ?? company.notes,
    updatedAt: new Date().toISOString(),
  });
  persist();
  return company;
}

function remove(id) {
  const company = get(id);
  if (!company) return false;
  company.active = false;
  company.deletedAt = new Date().toISOString();
  persist();
  return true;
}

module.exports = { list, get, create, update, remove, listFromSql };
