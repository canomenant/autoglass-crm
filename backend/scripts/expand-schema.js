require("dotenv").config();
const fs = require("fs");
const path = require("path");
const pool = require("../src/config/db");

const OUT_FILE = path.join(__dirname, "expand_schema.sql");

const sql = `-- expand_schema.sql
-- Adds the operational fields work_orders/quotes/customers were missing — the SQL schema
-- built during the Fase 2 migration only carried reference/relational fields, not the
-- full JS object shape the live app actually reads/writes. Purely additive: ADD COLUMN
-- only, all nullable or defaulted, nothing existing is touched or dropped. Compound/nested
-- fields use JSONB to mirror the real JS object shape 1:1 (payment, lineItems, vehicle, etc.)
-- so list()/get() can map them directly in the next step.

BEGIN;

ALTER TABLE work_orders
  ADD COLUMN IF NOT EXISTS quote_no TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS customer_name TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS phone TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS email TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS address TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS insurance_company_id UUID REFERENCES insurance_companies(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS claim_number TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS policy_number TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS priority TEXT NOT NULL DEFAULT 'Normal',
  ADD COLUMN IF NOT EXISTS glass_type TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS nags_description TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS appointment_time TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS appointment_duration_minutes INTEGER NOT NULL DEFAULT 60,
  ADD COLUMN IF NOT EXISTS special_instructions TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS tech_instructions TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS internal_notes TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS cancellation_reason TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS payment JSONB NOT NULL DEFAULT '{"method":"","amount":0,"paid":false,"cashComeback":0,"authorizationId":""}',
  ADD COLUMN IF NOT EXISTS payment_history JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS public_token TEXT UNIQUE,
  ADD COLUMN IF NOT EXISTS payment_token TEXT UNIQUE,
  ADD COLUMN IF NOT EXISTS tech_photos JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS created_by TEXT NOT NULL DEFAULT 'System',
  ADD COLUMN IF NOT EXISTS updated_by TEXT NOT NULL DEFAULT 'System',
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

ALTER TABLE quotes
  ADD COLUMN IF NOT EXISTS document_type TEXT NOT NULL DEFAULT 'WorkOrder',
  ADD COLUMN IF NOT EXISTS call_direction TEXT NOT NULL DEFAULT 'In',
  ADD COLUMN IF NOT EXISTS name TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS zip_code TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS long_trip_fee NUMERIC(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS service_area BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS long_trip_required BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS distance_from_base NUMERIC(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS customer_type TEXT NOT NULL DEFAULT 'Existing',
  ADD COLUMN IF NOT EXISTS customer_name TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS new_customer JSONB NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS insurance_company_id UUID REFERENCES insurance_companies(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS policy_number TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS claim_number TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS appointment_date DATE,
  ADD COLUMN IF NOT EXISTS start_time TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS end_time TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS glass_type TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS calibration_type TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS damage_notes TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS insurance JSONB NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS discount JSONB NOT NULL DEFAULT '{"type":"Percentage","value":0,"reason":""}',
  ADD COLUMN IF NOT EXISTS insurance_adjustment JSONB NOT NULL DEFAULT '{"amount":0,"notes":""}',
  ADD COLUMN IF NOT EXISTS line_items JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS crm_photos JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS customer_photos JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS upsell NUMERIC(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS commission NUMERIC(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS paid_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cash_comeback NUMERIC(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS customer_suggested_price NUMERIC(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS payment JSONB NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS lost_info JSONB NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS intake_token TEXT UNIQUE,
  ADD COLUMN IF NOT EXISTS intake_token_expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS intake_sent_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS intake_opened_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS intake_completed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS intake_photos JSONB NOT NULL DEFAULT '{"driverSide":[],"passengerSide":[],"front":[],"rear":[],"damageArea":[],"insuranceCard":[]}',
  ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS created_by TEXT NOT NULL DEFAULT 'System',
  ADD COLUMN IF NOT EXISTS updated_by TEXT NOT NULL DEFAULT 'System',
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS phone_alt TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS address_type TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS unit_number TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS city TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS state TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS zip_code TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS vehicle JSONB NOT NULL DEFAULT '{"year":"","make":"","model":"","bodyType":"","vin":"","plate":""}',
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS created_by TEXT NOT NULL DEFAULT 'System',
  ADD COLUMN IF NOT EXISTS updated_by TEXT NOT NULL DEFAULT 'System',
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

COMMIT;
`;

async function main() {
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
  for (const t of ["work_orders", "quotes", "customers"]) {
    const r = await pool.query(
      "SELECT column_name FROM information_schema.columns WHERE table_name = $1 ORDER BY ordinal_position",
      [t]
    );
    console.log(`${t}: ${r.rows.length} columns`);
  }

  const counts = await pool.query(`
    SELECT (SELECT COUNT(*) FROM work_orders) AS work_orders,
           (SELECT COUNT(*) FROM quotes) AS quotes,
           (SELECT COUNT(*) FROM customers) AS customers
  `);
  console.log("Row counts (should be unchanged):", JSON.stringify(counts.rows[0]));

  await pool.end();
}

main().catch((e) => {
  console.error("expand-schema failed:", e.message);
  process.exit(1);
});
