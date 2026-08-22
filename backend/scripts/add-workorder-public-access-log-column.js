require("dotenv").config();
const pool = require("../src/config/db");

// Audit trail for writes arriving through the technician's mobile link. That path is anonymous by
// construction — the token is the credential — so without a record there is no way to tell, after
// the fact, that a status was changed through a link rather than by a person with a session.
//
// A column rather than a corner of payment_history: these are different events with different
// fields, and conflating them would make both harder to read.
async function main() {
  await pool.query("ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS public_access_log JSONB DEFAULT '[]'::jsonb");
  console.log("work_orders.public_access_log column ready.");
  await pool.end();
}

main().catch((e) => {
  console.error("add-workorder-public-access-log-column failed:", e.message);
  process.exit(1);
});
