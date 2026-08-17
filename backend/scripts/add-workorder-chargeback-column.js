require("dotenv").config();
const pool = require("../src/config/db");

// Nothing in the live app can mark a work order as a chargeback today — the "Charge Back" tag
// exists in the Tags catalog but is never assigned anywhere. The only trace of the 3 historical
// chargebacks is free text in internal_notes ("Charge Back (from historical import)"), left by
// the original data migration. This adds a real, structured flag and backfills those 3 rows.
async function main() {
  await pool.query("ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS is_chargeback BOOLEAN DEFAULT false");
  console.log("work_orders.is_chargeback column ready.");

  const r = await pool.query(
    "UPDATE work_orders SET is_chargeback = true WHERE internal_notes ILIKE '%Charge Back%' RETURNING work_order_no"
  );
  console.log(`Backfilled ${r.rowCount} historical chargeback(s):`, r.rows.map((row) => row.work_order_no));

  await pool.end();
}

main().catch((e) => {
  console.error("add-workorder-chargeback-column failed:", e.message);
  process.exit(1);
});
