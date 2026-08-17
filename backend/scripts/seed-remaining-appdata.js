require("dotenv").config();
const fs = require("fs");
const path = require("path");
const pool = require("../src/config/db");

// Closes the last 5 stores left out of populate-appdata.js's original seed — confirmed each has
// no competing SQL table (insurance_companies exists but is empty/unqueried; table_views,
// partner_companies, expense_categories don't exist at all; users exists with one dead,
// never-queried row), so the local JSON file is the real, live source of truth for all 5.
// Reads the current local file (not a hardcoded array, unlike populate-appdata.js) since these
// stores may hold real accumulated edits beyond whatever they were originally seeded with.
const KEYS = ["insurance.json", "tableViews.json", "users.json", "partnerCompanies.json", "expenseCategories.json"];

async function upsertAppData(key, value) {
  await pool.query(
    `INSERT INTO app_data (key, value, updated_at) VALUES ($1, $2, now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [key, JSON.stringify(value)]
  );
  console.log(`  ${key}: ${Array.isArray(value) ? value.length : 1} registros`);
}

async function main() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS app_data (
      key TEXT PRIMARY KEY,
      value JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  for (const key of KEYS) {
    const filePath = path.join(__dirname, "..", "data", key);
    if (!fs.existsSync(filePath)) {
      console.log(`  ${key}: archivo local no existe, omitido`);
      continue;
    }
    const value = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    await upsertAppData(key, value);
  }

  await pool.end();
}

main().catch((e) => {
  console.error("seed-remaining-appdata failed:", e.message);
  process.exit(1);
});
