require("dotenv").config();
const fs = require("fs");
const path = require("path");
const pool = require("../src/config/db");

const OUT_FILE = path.join(__dirname, "migrate_uuid.sql");

async function main() {
  const appDataRes = await pool.query("SELECT value FROM app_data WHERE key = 'workorders.json'");
  const workOrders = appDataRes.rows[0] ? appDataRes.rows[0].value : [];
  const uuidMap = workOrders
    .filter((w) => w.workOrderNo && w.id)
    .map((w) => ({ workOrderNo: w.workOrderNo, id: w.id }));

  console.log(`Found ${uuidMap.length} existing app_data UUIDs to reuse for work_orders.`);

  const esc = (s) => `'${String(s).replace(/'/g, "''")}'`;
  const mapValues = uuidMap.map((m) => `(${esc(m.workOrderNo)}, ${esc(m.id)}::uuid)`).join(",\n  ");

  const sql = `-- migrate_uuid.sql
-- Converts customers, vehicles, quotes, work_orders, payments, technicians,
-- insurance_companies, users from INTEGER to UUID primary keys.
--
-- work_orders.id is REUSED from app_data.workorders.json (matched by work_order_no) so it
-- stays identical to the id the live app already uses for these 3,865 historical records.
-- Every other table has no existing app_data UUID to reuse (app_data.customers.json,
-- quotes.json, payments.json are empty; vehicleTypes.json/technicians.json use plain
-- integer ids, not UUIDs), so those get freshly generated UUIDs.
--
-- Runs in a single transaction: either the whole conversion succeeds, or none of it does.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Staging table: work_order_no -> the real UUID already used in app_data.
CREATE TABLE _work_order_uuid_map (work_order_no TEXT PRIMARY KEY, id UUID NOT NULL);
INSERT INTO _work_order_uuid_map (work_order_no, id) VALUES
  ${mapValues};

-- 1) Base tables with no FK dependency on another table in this migration: fresh UUIDs.
ALTER TABLE customers ADD COLUMN new_id UUID NOT NULL DEFAULT gen_random_uuid();
ALTER TABLE technicians ADD COLUMN new_id UUID NOT NULL DEFAULT gen_random_uuid();
ALTER TABLE vehicles ADD COLUMN new_id UUID NOT NULL DEFAULT gen_random_uuid();
ALTER TABLE insurance_companies ADD COLUMN new_id UUID NOT NULL DEFAULT gen_random_uuid();
ALTER TABLE users ADD COLUMN new_id UUID NOT NULL DEFAULT gen_random_uuid();

-- 2) quotes: fresh UUID for itself; customer_id follows customers' new UUID.
--    agent_id is left untouched — it references cat_agent(id), which stays INTEGER
--    (out of scope: cat_agent/cat_distributor are existing catalogs, not part of this migration).
ALTER TABLE quotes ADD COLUMN new_id UUID NOT NULL DEFAULT gen_random_uuid();
ALTER TABLE quotes ADD COLUMN new_customer_id UUID;
UPDATE quotes q SET new_customer_id = c.new_id FROM customers c WHERE c.id = q.customer_id;

-- 3) work_orders: id comes from the staging map (reusing app_data's real UUIDs).
--    distributor_id is left untouched (references cat_distributor, out of scope).
ALTER TABLE work_orders ADD COLUMN new_id UUID;
UPDATE work_orders w SET new_id = m.id FROM _work_order_uuid_map m WHERE m.work_order_no = w.work_order_no;
UPDATE work_orders SET new_id = gen_random_uuid() WHERE new_id IS NULL;
ALTER TABLE work_orders ALTER COLUMN new_id SET NOT NULL;

ALTER TABLE work_orders ADD COLUMN new_quote_id UUID;
UPDATE work_orders w SET new_quote_id = q.new_id FROM quotes q WHERE q.id = w.quote_id;
ALTER TABLE work_orders ADD COLUMN new_customer_id UUID;
UPDATE work_orders w SET new_customer_id = c.new_id FROM customers c WHERE c.id = w.customer_id;
ALTER TABLE work_orders ADD COLUMN new_vehicle_id UUID;
UPDATE work_orders w SET new_vehicle_id = v.new_id FROM vehicles v WHERE v.id = w.vehicle_id;
ALTER TABLE work_orders ADD COLUMN new_technician_id UUID;
UPDATE work_orders w SET new_technician_id = t.new_id FROM technicians t WHERE t.id = w.technician_id;

-- 4) payments: fresh UUID for itself; work_order_id follows work_orders' new UUID.
ALTER TABLE payments ADD COLUMN new_id UUID NOT NULL DEFAULT gen_random_uuid();
ALTER TABLE payments ADD COLUMN new_work_order_id UUID;
UPDATE payments p SET new_work_order_id = w.new_id FROM work_orders w WHERE w.id = p.work_order_id;

-- 5) Swap: drop old int PK/FK + column, rename new_* -> original name. Children first.
ALTER TABLE payments DROP CONSTRAINT payments_work_order_id_fkey;
ALTER TABLE payments DROP COLUMN work_order_id;
ALTER TABLE payments RENAME COLUMN new_work_order_id TO work_order_id;
ALTER TABLE payments DROP CONSTRAINT payments_pkey;
ALTER TABLE payments DROP COLUMN id;
ALTER TABLE payments RENAME COLUMN new_id TO id;
ALTER TABLE payments ADD PRIMARY KEY (id);

ALTER TABLE work_orders DROP CONSTRAINT work_orders_quote_id_fkey;
ALTER TABLE work_orders DROP CONSTRAINT work_orders_customer_id_fkey;
ALTER TABLE work_orders DROP CONSTRAINT work_orders_vehicle_id_fkey;
ALTER TABLE work_orders DROP CONSTRAINT work_orders_technician_id_fkey;
ALTER TABLE work_orders DROP COLUMN quote_id;
ALTER TABLE work_orders DROP COLUMN customer_id;
ALTER TABLE work_orders DROP COLUMN vehicle_id;
ALTER TABLE work_orders DROP COLUMN technician_id;
ALTER TABLE work_orders RENAME COLUMN new_quote_id TO quote_id;
ALTER TABLE work_orders RENAME COLUMN new_customer_id TO customer_id;
ALTER TABLE work_orders RENAME COLUMN new_vehicle_id TO vehicle_id;
ALTER TABLE work_orders RENAME COLUMN new_technician_id TO technician_id;
ALTER TABLE work_orders DROP CONSTRAINT work_orders_pkey;
ALTER TABLE work_orders DROP COLUMN id;
ALTER TABLE work_orders RENAME COLUMN new_id TO id;
ALTER TABLE work_orders ADD PRIMARY KEY (id);

ALTER TABLE quotes DROP CONSTRAINT quotes_customer_id_fkey;
ALTER TABLE quotes DROP COLUMN customer_id;
ALTER TABLE quotes RENAME COLUMN new_customer_id TO customer_id;
ALTER TABLE quotes DROP CONSTRAINT quotes_pkey;
ALTER TABLE quotes DROP COLUMN id;
ALTER TABLE quotes RENAME COLUMN new_id TO id;
ALTER TABLE quotes ADD PRIMARY KEY (id);

ALTER TABLE customers DROP CONSTRAINT customers_pkey;
ALTER TABLE customers DROP COLUMN id;
ALTER TABLE customers RENAME COLUMN new_id TO id;
ALTER TABLE customers ADD PRIMARY KEY (id);

ALTER TABLE technicians DROP CONSTRAINT technicians_pkey;
ALTER TABLE technicians DROP COLUMN id;
ALTER TABLE technicians RENAME COLUMN new_id TO id;
ALTER TABLE technicians ADD PRIMARY KEY (id);

ALTER TABLE vehicles DROP CONSTRAINT vehicles_pkey;
ALTER TABLE vehicles DROP COLUMN id;
ALTER TABLE vehicles RENAME COLUMN new_id TO id;
ALTER TABLE vehicles ADD PRIMARY KEY (id);

ALTER TABLE insurance_companies DROP CONSTRAINT insurance_companies_pkey;
ALTER TABLE insurance_companies DROP COLUMN id;
ALTER TABLE insurance_companies RENAME COLUMN new_id TO id;
ALTER TABLE insurance_companies ADD PRIMARY KEY (id);

ALTER TABLE users DROP CONSTRAINT users_pkey;
ALTER TABLE users DROP COLUMN id;
ALTER TABLE users RENAME COLUMN new_id TO id;
ALTER TABLE users ADD PRIMARY KEY (id);

-- 6) Re-add FK constraints on the new UUID columns.
ALTER TABLE quotes ADD CONSTRAINT quotes_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE SET NULL;
ALTER TABLE work_orders ADD CONSTRAINT work_orders_quote_id_fkey FOREIGN KEY (quote_id) REFERENCES quotes(id) ON DELETE SET NULL;
ALTER TABLE work_orders ADD CONSTRAINT work_orders_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE SET NULL;
ALTER TABLE work_orders ADD CONSTRAINT work_orders_vehicle_id_fkey FOREIGN KEY (vehicle_id) REFERENCES vehicles(id) ON DELETE SET NULL;
ALTER TABLE work_orders ADD CONSTRAINT work_orders_technician_id_fkey FOREIGN KEY (technician_id) REFERENCES technicians(id) ON DELETE SET NULL;
ALTER TABLE payments ADD CONSTRAINT payments_work_order_id_fkey FOREIGN KEY (work_order_id) REFERENCES work_orders(id) ON DELETE CASCADE;

DROP TABLE _work_order_uuid_map;

COMMIT;
`;

  fs.writeFileSync(OUT_FILE, sql, "utf-8");
  console.log(`Wrote ${OUT_FILE} (${(sql.length / 1024).toFixed(0)} KB)`);

  console.log("Applying to Railway...");
  const client = await pool.connect();
  try {
    await client.query(sql);
    console.log("Applied successfully.");
  } catch (err) {
    console.error("Migration failed (transaction rolled back automatically):", err.message);
    throw err;
  } finally {
    client.release();
  }

  console.log("\nValidating...");
  const counts = await pool.query(`
    SELECT
      (SELECT COUNT(*) FROM customers) AS customers,
      (SELECT COUNT(*) FROM vehicles) AS vehicles,
      (SELECT COUNT(*) FROM technicians) AS technicians,
      (SELECT COUNT(*) FROM insurance_companies) AS insurance_companies,
      (SELECT COUNT(*) FROM users) AS users,
      (SELECT COUNT(*) FROM quotes) AS quotes,
      (SELECT COUNT(*) FROM work_orders) AS work_orders,
      (SELECT COUNT(*) FROM payments) AS payments
  `);
  console.log("Row counts (should match pre-migration):", JSON.stringify(counts.rows[0]));

  const orphans = await pool.query(`
    SELECT
      (SELECT COUNT(*) FROM quotes WHERE customer_id IS NULL) AS quotes_null_customer,
      (SELECT COUNT(*) FROM work_orders WHERE quote_id IS NULL) AS wo_null_quote,
      (SELECT COUNT(*) FROM payments WHERE work_order_id IS NULL) AS payments_null_wo
  `);
  console.log("Null FK counts (expect 0/0/0):", JSON.stringify(orphans.rows[0]));

  const reused = await pool.query(`
    SELECT COUNT(*) AS matched
    FROM work_orders w
    JOIN app_data a ON a.key = 'workorders.json'
    JOIN jsonb_array_elements(a.value) AS wo ON (wo->>'workOrderNo') = w.work_order_no
    WHERE w.id::text = (wo->>'id')
  `);
  console.log("work_orders.id matching app_data's existing UUID:", JSON.stringify(reused.rows[0]), "/ 3865 expected");

  const sample = await pool.query(`
    SELECT c.first_name, c.last_name, q.quote_no, w.work_order_no, w.id, p.amount, p.paid
    FROM work_orders w
    JOIN quotes q ON q.id = w.quote_id
    JOIN customers c ON c.id = w.customer_id
    JOIN payments p ON p.work_order_id = w.id
    WHERE w.work_order_no = 'Wo-0001'
  `);
  console.log("Sample join (Wo-0001):", JSON.stringify(sample.rows[0], null, 2));

  await pool.end();
}

main().catch((e) => {
  console.error("migrate-to-uuid failed:", e.message);
  process.exit(1);
});
