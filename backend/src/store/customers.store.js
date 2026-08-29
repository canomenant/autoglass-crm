const crypto = require("crypto");
const pool = require("../config/db");
const { mapCustomer } = require("../lib/sqlMappers");
const listCache = require("../lib/listCache");

function withName(customer) {
  if (!customer) return customer;
  return { ...customer, name: `${customer.firstName} ${customer.lastName}`.trim() };
}

async function list() {
  const r = await pool.query("SELECT * FROM customers WHERE active <> false ORDER BY created_at");
  return r.rows.map(mapCustomer).map(withName);
}

async function get(id) {
  const r = await pool.query("SELECT * FROM customers WHERE id = $1 AND active <> false", [id]);
  if (!r.rows[0]) return null;
  return withName(mapCustomer(r.rows[0]));
}

async function writeCustomerToSql(customer) {
  // La lista de órdenes deriva columnas del cliente (teléfono alterno, ciudad, estado...), así
  // que editarlo invalida esa caché también.
  const result = await pool.query(
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
  listCache.invalidate("workorders");
  return result;
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
  await writeCustomerToSql(customer);
  return withName(customer);
}

async function update(id, data) {
  const existing = await get(id);
  if (!existing) return null;
  const customer = {
    ...existing,
    firstName: data.firstName ?? existing.firstName,
    lastName: data.lastName ?? existing.lastName,
    phone: data.phone ?? existing.phone,
    phoneAlt: data.phoneAlt ?? existing.phoneAlt,
    email: data.email ?? existing.email,
    address: data.address ?? existing.address,
    addressType: data.addressType ?? existing.addressType,
    unitNumber: data.unitNumber ?? existing.unitNumber,
    city: data.city ?? existing.city,
    state: data.state ?? existing.state,
    zipCode: data.zipCode ?? existing.zipCode,
    vehicle: { ...existing.vehicle, ...data.vehicle },
    updatedBy: data.updatedBy || existing.updatedBy,
    updatedAt: new Date().toISOString(),
  };
  await writeCustomerToSql(customer);
  return withName(customer);
}

async function remove(id) {
  const existing = await get(id);
  if (!existing) return false;
  await pool.query("UPDATE customers SET active = false, deleted_at = $2 WHERE id = $1", [id, new Date().toISOString()]);
  listCache.invalidate("workorders");
  return true;
}

module.exports = { list, get, create, update, remove };
