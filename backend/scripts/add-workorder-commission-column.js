require("dotenv").config();
const pool = require("../src/config/db");

// Commission belongs to the Work Order, not the Quote: a Quote that never converts never
// generates a commission, and 2 historical work orders (Wo-3036, Wo-1312) have no linked
// quote at all, so quotes.commission could never have held their value anyway.
async function main() {
  await pool.query("ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS commission NUMERIC DEFAULT 0");
  console.log("work_orders.commission column ready.");
  await pool.end();
}

main().catch((e) => {
  console.error("add-workorder-commission-column failed:", e.message);
  process.exit(1);
});
