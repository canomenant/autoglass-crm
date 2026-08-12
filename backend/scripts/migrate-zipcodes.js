require("dotenv").config();
const crypto = require("crypto");
const pool = require("../src/config/db");

const CREATE_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS zip_codes (
    id UUID PRIMARY KEY,
    zipcode TEXT NOT NULL,
    city TEXT,
    county TEXT,
    state TEXT,
    tax NUMERIC DEFAULT 0,
    service_area BOOLEAN DEFAULT true,
    long_trip_required BOOLEAN DEFAULT false,
    long_trip_fee NUMERIC DEFAULT 0,
    distance_from_base NUMERIC DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
  )
`;

// app_data['zipCodes.json'] has no unique constraint on zipcode (~49 duplicate zip values,
// inherited as-is from cat_zipcode) — this migrates every row 1:1, minus the phantom CSV
// header row, rather than deduping. Re-running would double everything, so it refuses to
// proceed if the table already has rows.
async function main() {
  await pool.query(CREATE_TABLE_SQL);
  console.log("Ensured zip_codes table exists.");

  const existing = await pool.query("SELECT COUNT(*) AS count FROM zip_codes");
  if (Number(existing.rows[0].count) > 0) {
    console.log(`zip_codes already has ${existing.rows[0].count} rows — migration already ran. Truncate manually first if you need to redo it.`);
    await pool.end();
    return;
  }

  const appData = await pool.query("SELECT value FROM app_data WHERE key = 'zipCodes.json'");
  if (!appData.rows[0]) throw new Error("app_data['zipCodes.json'] not found — nothing to migrate.");
  const records = appData.rows[0].value;
  console.log(`Read ${records.length} records from app_data['zipCodes.json'].`);

  const filtered = records.filter((z) => z.zipcode !== "ZIPCODE_ZIPCODE");
  console.log(`Excluded ${records.length - filtered.length} phantom header row(s). ${filtered.length} remain to migrate.`);

  let inserted = 0;
  for (const z of filtered) {
    await pool.query(
      `INSERT INTO zip_codes (id, zipcode, city, county, state, tax, service_area, long_trip_required, long_trip_fee, distance_from_base)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        crypto.randomUUID(), z.zipcode, z.city || "", z.county || "", z.state || "",
        Number(z.tax) || 0, z.serviceArea !== false, !!z.longTripRequired,
        Number(z.longTripFee) || 0, Number(z.distanceFromBase) || 0,
      ]
    );
    inserted++;
  }
  console.log(`Inserted ${inserted} rows into zip_codes.`);

  const check = await pool.query("SELECT COUNT(*) AS count FROM zip_codes");
  console.log("Final zip_codes row count:", check.rows[0].count);

  await pool.end();
}

main().catch((e) => {
  console.error("migrate-zipcodes failed:", e.message);
  process.exit(1);
});
