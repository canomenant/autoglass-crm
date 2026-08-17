require("dotenv").config();
const pool = require("../src/config/db");

// invoice_mode ('lump_sum' | 'itemized') drives whether sales tax applies to the whole
// subtotal or only to line items flagged is_taxable. Quotes carry the live, editable value;
// work_orders get a one-time snapshot copied at conversion (same pattern as work_order_type).
async function main() {
  await pool.query("ALTER TABLE quotes ADD COLUMN IF NOT EXISTS invoice_mode TEXT DEFAULT 'lump_sum'");
  await pool.query("ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS invoice_mode TEXT DEFAULT 'lump_sum'");
  console.log("quotes.invoice_mode and work_orders.invoice_mode columns ready.");
  await pool.end();
}

main().catch((e) => {
  console.error("add-invoice-mode-columns failed:", e.message);
  process.exit(1);
});
