require("dotenv").config();
const fs = require("fs");
const path = require("path");
const pool = require("../src/config/db");

const OUT_FILE = path.join(__dirname, "autoglass_crm_full.sql");
const BATCH = 500;

const STATUS_MAP = {
  "Job Done": "Paid",
  "Cancelled": "Cancelled",
  "Charge Back": "Cancelled",
};

function esc(v) {
  if (v === null || v === undefined) return "NULL";
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "0";
  if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
  return `'${String(v).replace(/'/g, "''")}'`;
}

function escDate(v) {
  if (!v) return "NULL";
  const d = v instanceof Date ? v : new Date(v);
  if (Number.isNaN(d.getTime())) return "NULL";
  return `'${d.toISOString().slice(0, 10)}'`;
}

function insertBatches(lines, table, columns, rows, batch = BATCH) {
  if (rows.length === 0) return;
  for (let i = 0; i < rows.length; i += batch) {
    const chunk = rows.slice(i, i + batch);
    const values = chunk.map((r) => `(${columns.map((c) => r[c]).join(",")})`).join(",\n  ");
    lines.push(`INSERT INTO ${table} (${columns.join(", ")}) VALUES\n  ${values};`);
  }
}

function customerKey(row) {
  const phone = (row.phone || "").trim();
  const email = (row.email || "").trim().toLowerCase();
  if (phone) return `p:${phone}`;
  if (email) return `e:${email}`;
  return `n:${(row.customer_name || "").trim().toLowerCase()}`;
}

async function main() {
  const [technicians, agents, distributors, vehicleTypesRow, history] = await Promise.all([
    pool.query("SELECT id, extra FROM cat_technician ORDER BY id"),
    pool.query("SELECT id, name FROM cat_agent ORDER BY id"),
    pool.query("SELECT id, name FROM cat_distributor ORDER BY id"),
    pool.query("SELECT value FROM app_data WHERE key = 'vehicleTypes.json'"),
    pool.query("SELECT * FROM work_orders_history ORDER BY wo_number"),
  ]);

  const vehicles = vehicleTypesRow.rows[0] ? vehicleTypesRow.rows[0].value : [];

  // Catalog names are sometimes short/nickname forms of the full names used in the historical
  // data ("Joel Alexander" vs "Joel Alexander Lopez Castillo") — match on the first two
  // whitespace-separated tokens as a fallback when the full string doesn't match exactly.
  function firstTwoTokens(name) {
    return (name || "").trim().toLowerCase().split(/\s+/).slice(0, 2).join(" ");
  }
  function buildNameMaps(rows, getName) {
    const exact = new Map();
    const byPrefix = new Map();
    for (const r of rows) {
      const name = (getName(r) || "").trim().toLowerCase();
      if (!name) continue;
      exact.set(name, r.id);
      const prefix = firstTwoTokens(name);
      if (prefix && !byPrefix.has(prefix)) byPrefix.set(prefix, r.id);
    }
    return { exact, byPrefix };
  }
  function matchName(maps, rawName) {
    const name = (rawName || "").trim().toLowerCase();
    if (!name) return null;
    if (maps.exact.has(name)) return maps.exact.get(name);
    const prefix = firstTwoTokens(name);
    if (maps.byPrefix.has(prefix)) return maps.byPrefix.get(prefix);
    return null;
  }

  const agentMaps = buildNameMaps(agents.rows, (a) => a.name);
  const distributorMaps = buildNameMaps(distributors.rows, (d) => d.name);
  const technicianMaps = buildNameMaps(technicians.rows, (t) => t.extra?.name);
  const vehicleByYMM = new Map();
  for (const v of vehicles) {
    const key = `${v.year}|${(v.make || "").toLowerCase()}|${(v.model || "").toLowerCase()}`;
    if (!vehicleByYMM.has(key)) vehicleByYMM.set(key, v.id);
  }

  // Dedup customers across the 3,865 historical rows (by phone, falling back to email, then name).
  const customerMap = new Map();
  let nextCustomerId = 1;
  for (const row of history.rows) {
    const key = customerKey(row);
    if (customerMap.has(key)) continue;
    const [firstName, ...rest] = (row.customer_name || "").trim().split(/\s+/);
    customerMap.set(key, {
      id: nextCustomerId++,
      first_name: firstName || "",
      last_name: rest.join(" "),
      phone: row.phone || "",
      email: row.email || "",
      address: row.address || "",
    });
  }

  const quoteRows = [];
  const workOrderRows = [];
  const paymentRows = [];
  let nextQuoteId = 1;
  let nextWorkOrderId = 1;
  let nextPaymentId = 1;

  for (const row of history.rows) {
    const customer = customerMap.get(customerKey(row));
    const status = STATUS_MAP[row.status] || row.status || "";
    const paid = status === "Paid";
    const quoteNo = (row.wo_number || "").replace(/^Wo-/i, "Q-") || `Q-${nextQuoteId}`;
    const agentId = matchName(agentMaps, row.agent);
    const distributorId = matchName(distributorMaps, row.distributor);
    const technicianId = matchName(technicianMaps, row.tech);
    const vehicleId = vehicleByYMM.get(`${row.year}|${(row.make || "").toLowerCase()}|${(row.model || "").toLowerCase()}`) ?? null;

    const quoteId = nextQuoteId++;
    quoteRows.push({
      id: esc(quoteId),
      quote_no: esc(quoteNo),
      status: esc("Converted"),
      payment_type: esc(row.personal_or_insurance === "Insurance" ? "Insurance" : "Personal"),
      customer_id: esc(customer.id),
      agent_id: esc(agentId),
      agent_name: esc(row.agent || ""),
      vehicle_year: esc(row.year || ""),
      vehicle_make: esc(row.make || ""),
      vehicle_model: esc(row.model || ""),
      vehicle_body_type: esc(row.body || ""),
      vehicle_vin: esc(row.vin || ""),
      job_type: esc(row.job_type || ""),
      part_number: esc(row.part_number || ""),
      nags_description: esc(""),
      glass_cost: esc(Number(row.subtotal_part) || 0),
      tax_rate: esc(Number(row.tax_pct) || 0),
      date: escDate(row.appointment_date),
    });

    const workOrderId = nextWorkOrderId++;
    workOrderRows.push({
      id: esc(workOrderId),
      work_order_no: esc(row.wo_number || ""),
      quote_id: esc(quoteId),
      customer_id: esc(customer.id),
      work_order_type: esc(row.personal_or_insurance === "Insurance" ? "Insurance" : "Personal"),
      vehicle_id: esc(vehicleId),
      vehicle_year: esc(row.year || ""),
      vehicle_make: esc(row.make || ""),
      vehicle_model: esc(row.model || ""),
      vehicle_body_type: esc(row.body || ""),
      vehicle_vin: esc(row.vin || ""),
      distributor_id: esc(distributorId),
      distributor: esc(row.distributor || ""),
      technician_id: esc(technicianId),
      tech: esc(row.tech || ""),
      part_number: esc(row.part_number || ""),
      job_type: esc(row.job_type || ""),
      labor_cost: esc(Number(row.labor) || 0),
      glass_cost: esc(Number(row.subtotal_part) || 0),
      total_sale: esc(Number(row.total) || 0),
      status: esc(status),
      appointment_date: escDate(row.appointment_date),
    });

    paymentRows.push({
      id: esc(nextPaymentId++),
      work_order_id: esc(workOrderId),
      payment_type: esc(row.payment_type || ""),
      amount: esc(Number(row.total) || 0),
      paid: esc(paid),
      authorization_id: esc(row.id_authorization || ""),
    });
  }

  const technicianRows = technicians.rows.map((t) => {
    const x = t.extra || {};
    return {
      id: esc(t.id),
      name: esc(x.name || ""),
      company_name: esc(x.companyName || ""),
      phone: esc(x.phone || ""),
      mobile: esc(x.mobile || ""),
      email: x.email ? esc(x.email) : "NULL",
      address: esc(x.address || ""),
      city: esc(x.city || ""),
      state: esc(x.state || ""),
      zip_code: esc(x.zipCode || ""),
      status: esc(x.status || "Active"),
      default_labor_rate: esc(Number(x.defaultLaborRate) || 0),
      default_commission: esc(Number(x.defaultCommission) || 0),
      active: esc(x.active !== false),
    };
  });

  const vehicleRows = vehicles.map((v) => ({
    id: esc(v.id),
    year: esc(Number(v.year)),
    make: esc(v.make || ""),
    model: esc(v.model || ""),
    body_type: esc(v.bodyType || ""),
  }));

  const customerRows = [...customerMap.values()].map((c) => ({
    id: esc(c.id),
    first_name: esc(c.first_name),
    last_name: esc(c.last_name),
    phone: esc(c.phone),
    email: esc(c.email),
    address: esc(c.address),
  }));

  const userRows = [{ id: esc(1), name: esc("Demo Admin"), email: esc("demo@llamara.com"), role: esc("Admin") }];

  const lines = [];
  lines.push("-- autoglass_crm_full.sql");
  lines.push("-- Generated relational schema, derived/synthesized from Railway's existing catalogs");
  lines.push("-- (cat_agent, cat_distributor, cat_technician, cat_vehicle via app_data.vehicleTypes.json)");
  lines.push("-- and work_orders_history. Additive only: does not touch app_data or work_orders_history.");
  lines.push("");

  lines.push(`CREATE TABLE IF NOT EXISTS customers (
  id INTEGER PRIMARY KEY,
  first_name TEXT NOT NULL DEFAULT '',
  last_name TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  address TEXT NOT NULL DEFAULT '',
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);`);

  lines.push(`CREATE TABLE IF NOT EXISTS technicians (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL DEFAULT '',
  company_name TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  mobile TEXT NOT NULL DEFAULT '',
  email TEXT,
  address TEXT NOT NULL DEFAULT '',
  city TEXT NOT NULL DEFAULT '',
  state TEXT NOT NULL DEFAULT '',
  zip_code TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'Active',
  default_labor_rate NUMERIC(12,2) NOT NULL DEFAULT 0,
  default_commission NUMERIC(12,2) NOT NULL DEFAULT 0,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);`);

  lines.push(`CREATE TABLE IF NOT EXISTS vehicles (
  id INTEGER PRIMARY KEY,
  year INTEGER NOT NULL,
  make TEXT NOT NULL DEFAULT '',
  model TEXT NOT NULL DEFAULT '',
  body_type TEXT NOT NULL DEFAULT ''
);`);

  lines.push(`CREATE TABLE IF NOT EXISTS insurance_companies (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  address TEXT NOT NULL DEFAULT '',
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);`);

  lines.push(`CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL DEFAULT '',
  email TEXT UNIQUE,
  role TEXT NOT NULL DEFAULT 'Admin',
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);`);

  lines.push(`CREATE TABLE IF NOT EXISTS quotes (
  id INTEGER PRIMARY KEY,
  quote_no TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'Draft',
  payment_type TEXT NOT NULL DEFAULT 'Personal',
  customer_id INTEGER REFERENCES customers(id) ON DELETE SET NULL,
  agent_id INTEGER REFERENCES cat_agent(id) ON DELETE SET NULL,
  agent_name TEXT NOT NULL DEFAULT '',
  vehicle_year TEXT NOT NULL DEFAULT '',
  vehicle_make TEXT NOT NULL DEFAULT '',
  vehicle_model TEXT NOT NULL DEFAULT '',
  vehicle_body_type TEXT NOT NULL DEFAULT '',
  vehicle_vin TEXT NOT NULL DEFAULT '',
  job_type TEXT NOT NULL DEFAULT '',
  part_number TEXT NOT NULL DEFAULT '',
  nags_description TEXT NOT NULL DEFAULT '',
  glass_cost NUMERIC(12,2) NOT NULL DEFAULT 0,
  tax_rate NUMERIC(6,4) NOT NULL DEFAULT 0,
  date DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);`);

  lines.push(`CREATE TABLE IF NOT EXISTS work_orders (
  id INTEGER PRIMARY KEY,
  work_order_no TEXT NOT NULL UNIQUE,
  quote_id INTEGER REFERENCES quotes(id) ON DELETE SET NULL,
  customer_id INTEGER REFERENCES customers(id) ON DELETE SET NULL,
  work_order_type TEXT NOT NULL DEFAULT 'Personal',
  vehicle_id INTEGER REFERENCES vehicles(id) ON DELETE SET NULL,
  vehicle_year TEXT NOT NULL DEFAULT '',
  vehicle_make TEXT NOT NULL DEFAULT '',
  vehicle_model TEXT NOT NULL DEFAULT '',
  vehicle_body_type TEXT NOT NULL DEFAULT '',
  vehicle_vin TEXT NOT NULL DEFAULT '',
  distributor_id INTEGER REFERENCES cat_distributor(id) ON DELETE SET NULL,
  distributor TEXT NOT NULL DEFAULT '',
  technician_id INTEGER REFERENCES technicians(id) ON DELETE SET NULL,
  tech TEXT NOT NULL DEFAULT '',
  part_number TEXT NOT NULL DEFAULT '',
  job_type TEXT NOT NULL DEFAULT '',
  labor_cost NUMERIC(12,2) NOT NULL DEFAULT 0,
  glass_cost NUMERIC(12,2) NOT NULL DEFAULT 0,
  total_sale NUMERIC(12,2) NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'Scheduled',
  appointment_date DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);`);

  lines.push(`CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY,
  work_order_id INTEGER REFERENCES work_orders(id) ON DELETE CASCADE,
  payment_type TEXT NOT NULL DEFAULT '',
  amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  paid BOOLEAN NOT NULL DEFAULT false,
  authorization_id TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);`);

  insertBatches(lines, "technicians", ["id", "name", "company_name", "phone", "mobile", "email", "address", "city", "state", "zip_code", "status", "default_labor_rate", "default_commission", "active"], technicianRows);
  insertBatches(lines, "vehicles", ["id", "year", "make", "model", "body_type"], vehicleRows);
  insertBatches(lines, "customers", ["id", "first_name", "last_name", "phone", "email", "address"], customerRows);
  insertBatches(lines, "users", ["id", "name", "email", "role"], userRows);
  insertBatches(lines, "quotes", ["id", "quote_no", "status", "payment_type", "customer_id", "agent_id", "agent_name", "vehicle_year", "vehicle_make", "vehicle_model", "vehicle_body_type", "vehicle_vin", "job_type", "part_number", "nags_description", "glass_cost", "tax_rate", "date"], quoteRows);
  insertBatches(lines, "work_orders", ["id", "work_order_no", "quote_id", "customer_id", "work_order_type", "vehicle_id", "vehicle_year", "vehicle_make", "vehicle_model", "vehicle_body_type", "vehicle_vin", "distributor_id", "distributor", "technician_id", "tech", "part_number", "job_type", "labor_cost", "glass_cost", "total_sale", "status", "appointment_date"], workOrderRows);
  insertBatches(lines, "payments", ["id", "work_order_id", "payment_type", "amount", "paid", "authorization_id"], paymentRows);

  const sql = lines.join("\n\n") + "\n";
  fs.writeFileSync(OUT_FILE, sql, "utf-8");
  console.log(`Wrote ${OUT_FILE} (${(sql.length / 1024 / 1024).toFixed(1)} MB)`);

  console.log("Applying to Railway...");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // Safe to re-run: these 8 tables are wholly owned by this script (nothing else reads them
    // yet), so clear them before re-inserting rather than fail on duplicate primary keys.
    await client.query(`
      TRUNCATE payments, work_orders, quotes, customers, technicians, vehicles, users, insurance_companies
      RESTART IDENTITY CASCADE
    `);
    await client.query(sql);
    await client.query("COMMIT");
    console.log("Applied successfully.");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }

  console.log("Summary:");
  console.log("  technicians:", technicianRows.length);
  console.log("  vehicles:", vehicleRows.length);
  console.log("  customers:", customerRows.length);
  console.log("  users:", userRows.length);
  console.log("  quotes:", quoteRows.length);
  console.log("  work_orders:", workOrderRows.length);
  console.log("  payments:", paymentRows.length);

  await pool.end();
}

main().catch((e) => {
  console.error("build-full-schema failed:", e.message);
  process.exit(1);
});
