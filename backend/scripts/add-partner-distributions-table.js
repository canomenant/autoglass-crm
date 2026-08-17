require("dotenv").config();
const pool = require("../src/config/db");

// Ledger of business-partner profit-sharing distributions, one row per active partner per
// paid work order. Lives in SQL (not the JSON persistence.js layer) because it's transactional
// data that grows with every paid work order, same reasoning as the `payouts` table — not a
// small, slow-changing catalog. partner_id has no real FK: partners live in businessPartners.json
// (app_data-backed), not a SQL table, so partner_name/job_type/amount are snapshotted here to
// stay accurate even if the partner record or their rates change later.
async function main() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS partner_distributions (
      id UUID PRIMARY KEY,
      work_order_id UUID REFERENCES work_orders(id) ON DELETE SET NULL,
      work_order_no TEXT NOT NULL,
      partner_id INTEGER NOT NULL,
      partner_name TEXT NOT NULL,
      job_type TEXT NOT NULL,
      amount NUMERIC(12,2) NOT NULL,
      paid_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS partner_distributions_work_order_id_idx ON partner_distributions (work_order_id)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS partner_distributions_paid_at_idx ON partner_distributions (paid_at)`);
  console.log("partner_distributions table ready.");
  await pool.end();
}

main().catch((e) => {
  console.error("add-partner-distributions-table failed:", e.message);
  process.exit(1);
});
