const crypto = require("crypto");
const { loadOrSeed, save } = require("../lib/persistence");
const pool = require("../config/db");
const { isShadowEnabled, shadowRead } = require("../lib/sqlShadow");
const { isDualWriteEnabled, syncToSql } = require("../lib/sqlSync");
const { mapCustomer } = require("../lib/sqlMappers");

const FILE = "customers.json";
let customers = loadOrSeed(FILE, () => []);

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

function sqlSourceActive() {
  return process.env.CUSTOMERS_SOURCE === "sql";
}

function runShadow(result) {
  if (!isShadowEnabled(process.env.CUSTOMERS_SOURCE)) return;
  shadowRead({
    label: "customers",
    jsonResult: result,
    sqlQueryFn: listFromSql,
    matchKeyFn: customerMatchKey,
    compareFn: compareCustomer,
  }).catch(() => {});
}

async function list() {
  const jsonResult = customers.filter((c) => c.active !== false).map(withName);
  runShadow(jsonResult);
  if (!sqlSourceActive()) return jsonResult;
  const r = await pool.query("SELECT * FROM customers WHERE active <> false ORDER BY created_at");
  return r.rows.map(mapCustomer).map(withName);
}

async function get(id) {
  if (sqlSourceActive()) {
    const r = await pool.query("SELECT * FROM customers WHERE id = $1 AND active <> false", [id]);
    if (r.rows[0]) return withName(mapCustomer(r.rows[0]));
    // Fall through to JSON in case this id only exists there (e.g. not dual-written yet).
  }
  return withName(customers.find((c) => String(c.id) === String(id) && c.active !== false));
}

function syncCustomerToSql(customer) {
  if (!isDualWriteEnabled()) return Promise.resolve();
  return syncToSql({
    entity: "customers",
    id: customer.id,
    businessKey: customer.phone || customer.email,
    sqlFn: () => writeCustomerToSql(customer),
  });
}

function writeCustomerToSql(customer) {
  return pool.query(
    `INSERT INTO customers (id, first_name, last_name, phone, phone_alt, email, address, address_type,
       unit_number, city, state, zip_code, vehicle, active, deleted_at, created_by, updated_by, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
     ON CONFLICT (id) DO UPDATE SET first_name = EXCLUDED.first_name, last_name = EXCLUDED.last_name,
       phone = EXCLUDED.phone, phone_alt = EXCLUDED.phone_alt, email = EXCLUDED.email, address = EXCLUDED.address,
       address_type = EXCLUDED.address_type, unit_number = EXCLUDED.unit_number, city = EXCLUDED.city,
       state = EXCLUDED.state, zip_code = EXCLUDED.zip_code, vehicle = EXCLUDED.vehicle, active = EXCLUDED.active,
       deleted_at = EXCLUDED.deleted_at, updated_by = EXCLUDED.updated_by, updated_at = EXCLUDED.updated_at`,
    [
      customer.id, customer.firstName, customer.lastName, customer.phone, customer.phoneAlt || "", customer.email,
      customer.address, customer.addressType || "", customer.unitNumber || "", customer.city || "",
      customer.state || "", customer.zipCode || "", JSON.stringify(customer.vehicle || {}), customer.active !== false,
      customer.deletedAt || null, customer.createdBy || "System", customer.updatedBy || "System", customer.updatedAt,
    ]
  );
}

async function create(data) {
  const customer = {
    id: crypto.randomUUID(),
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
  persist();
  if (sqlSourceActive()) {
    await writeCustomerToSql(customer);
  } else {
    syncCustomerToSql(customer).catch(() => {});
  }
  return withName(customer);
}

async function update(id, data) {
  const customer = customers.find((c) => String(c.id) === String(id) && c.active !== false);
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
  if (sqlSourceActive()) {
    await writeCustomerToSql(customer);
  } else {
    syncCustomerToSql(customer).catch(() => {});
  }
  return withName(customer);
}

async function remove(id) {
  const customer = customers.find((c) => String(c.id) === String(id) && c.active !== false);
  if (!customer) return false;
  customer.active = false;
  customer.deletedAt = new Date().toISOString();
  persist();
  if (sqlSourceActive()) {
    await pool.query("UPDATE customers SET active = false, deleted_at = $2 WHERE id = $1", [customer.id, customer.deletedAt]);
  } else if (isDualWriteEnabled()) {
    syncToSql({
      entity: "customers",
      id: customer.id,
      businessKey: customer.phone || customer.email,
      sqlFn: () => pool.query("DELETE FROM customers WHERE id = $1", [customer.id]),
    }).catch(() => {});
  }
  return true;
}

module.exports = { list, get, create, update, remove, listFromSql };
