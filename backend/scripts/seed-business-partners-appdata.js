require("dotenv").config();
const pool = require("../src/config/db");

// Brand-new stores for the partner profit-sharing feature — seeded directly with their empty
// defaults (no pre-existing local data to carry over, unlike seed-remaining-appdata.js) so
// persistence.js's save() fix covers them from the very first real write.
async function upsertAppData(key, value) {
  await pool.query(
    `INSERT INTO app_data (key, value, updated_at) VALUES ($1, $2, now())
     ON CONFLICT (key) DO NOTHING`,
    [key, JSON.stringify(value)]
  );
  console.log(`  ${key}: seeded (or already present, left untouched)`);
}

async function main() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS app_data (
      key TEXT PRIMARY KEY,
      value JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  await upsertAppData("businessPartners.json", []);
  await upsertAppData("partnerDistributionSettings.json", { startDate: null });

  await pool.end();
}

main().catch((e) => {
  console.error("seed-business-partners-appdata failed:", e.message);
  process.exit(1);
});
