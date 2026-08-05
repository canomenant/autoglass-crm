const { loadOrSeed, save, nextIdFrom } = require("../lib/persistence");
const pool = require("../config/db");
const { isShadowEnabled, shadowRead } = require("../lib/sqlShadow");

const FILE = "customers.json";
let customers = loadOrSeed(FILE, () => []);
let nextId = nextIdFrom(customers);

function persist() {
  save(FILE, customers);
}

function withName(customer) {
  if (!customer) return customer;
  return { ...customer, name: `${customer.firstName} ${customer.lastName}`.trim() };
}

function customerMatchKey(c) {
  const phone = (c.phone || "").trim();
  if (phone) return `p:${phone}`;
  const email = (c.email || "").trim().toLowerCase();
  return email ? `e:${email}` : null;
}

async function listFromSql() {
  const r = await pool.query("SELECT id, first_name, last_name, phone, email, address FROM customers");
  return r.rows;
}

function compareCustomer(json, sql) {
  const diffs = [];
  if ((json.firstName || "") !== (sql.first_name || "")) diffs.push(`firstName: '${json.firstName}' vs '${sql.first_name}'`);
  if ((json.lastName || "") !== (sql.last_name || "")) diffs.push(`lastName: '${json.lastName}' vs '${sql.last_name}'`);
  if ((json.address || "") !== (sql.address || "")) diffs.push(`address: '${json.address}' vs '${sql.address}'`);
  return diffs.length ? diffs : null;
}

function list() {
  const result = customers.filter((c) => c.active !== false).map(withName);
  if (isShadowEnabled(process.env.CUSTOMERS_SOURCE)) {
    shadowRead({
      label: "customers",
      jsonResult: result,
      sqlQueryFn: listFromSql,
      matchKeyFn: customerMatchKey,
      compareFn: compareCustomer,
    }).catch(() => {});
  }
  return result;
}

function get(id) {
  return withName(customers.find((c) => c.id === Number(id) && c.active !== false));
}

function create(data) {
  const customer = {
    id: nextId,
    firstName: data.firstName || "",
    lastName: data.lastName || "",
    phone: data.phone || "",
    phoneAlt: data.phoneAlt || "",
    email: data.email || "",
    address: data.address || "",
    addressType: data.addressType || "",
    unitNumber: data.unitNumber || "",
    city: data.city || "",
    state: data.state || "",
    zipCode: data.zipCode || "",
    vehicle: {
      year: data.vehicle?.year || "",
      make: data.vehicle?.make || "",
      model: data.vehicle?.model || "",
      bodyType: data.vehicle?.bodyType || "",
      vin: data.vehicle?.vin || "",
      plate: data.vehicle?.plate || "",
    },
    active: true,
    deletedAt: null,
    createdBy: data.createdBy || "System",
    updatedBy: data.createdBy || "System",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  customers.push(customer);
  nextId += 1;
  persist();
  return withName(customer);
}

function update(id, data) {
  const customer = customers.find((c) => c.id === Number(id) && c.active !== false);
  if (!customer) return null;
  Object.assign(customer, {
    firstName: data.firstName ?? customer.firstName,
    lastName: data.lastName ?? customer.lastName,
    phone: data.phone ?? customer.phone,
    phoneAlt: data.phoneAlt ?? customer.phoneAlt,
    email: data.email ?? customer.email,
    address: data.address ?? customer.address,
    addressType: data.addressType ?? customer.addressType,
    unitNumber: data.unitNumber ?? customer.unitNumber,
    city: data.city ?? customer.city,
    state: data.state ?? customer.state,
    zipCode: data.zipCode ?? customer.zipCode,
    vehicle: { ...customer.vehicle, ...data.vehicle },
    updatedBy: data.updatedBy || customer.updatedBy,
    updatedAt: new Date().toISOString(),
  });
  persist();
  return withName(customer);
}

function remove(id) {
  const customer = customers.find((c) => c.id === Number(id) && c.active !== false);
  if (!customer) return false;
  customer.active = false;
  customer.deletedAt = new Date().toISOString();
  persist();
  return true;
}

module.exports = { list, get, create, update, remove, listFromSql };
