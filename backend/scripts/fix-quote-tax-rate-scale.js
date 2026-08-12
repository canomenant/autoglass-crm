require("dotenv").config();
const pool = require("../src/config/db");

// 3,844 of 3,866 quotes (99.4%) have tax_rate stored as a raw decimal fraction (e.g. 0.0825)
// instead of the percentage number the rest of the system expects (8.25) — computeTotals()
// divides by 100 (taxAmount = subtotal * (taxRate/100)), and the live create-quote flow
// (handleZipCodeChange) already multiplies by 100 when setting it, so this is a one-time gap
// from however the historical data was originally populated, not an active code bug.
//
// Verified safe before running: quotes.totals (subtotal/taxAmount/totalAmount) are never
// persisted — always recomputed live, and none of these 3,844 have any line_items or a
// long trip fee, so their taxable subtotal is $0 regardless of tax_rate; nothing in
// reports.routes.js reads quote.taxRate or computeTotals() (revenue comes entirely from
// work_orders.payment.amount, a separate stored field). This backfill only corrects the
// displayed tax rate percentage — it changes no dollar figure anywhere.
async function main() {
  const before = await pool.query("SELECT COUNT(*) AS count FROM quotes WHERE tax_rate > 0 AND tax_rate < 1");
  console.log(`Rows to fix: ${before.rows[0].count}`);

  const result = await pool.query("UPDATE quotes SET tax_rate = tax_rate * 100 WHERE tax_rate > 0 AND tax_rate < 1");
  console.log(`Rows updated: ${result.rowCount}`);

  const after = await pool.query("SELECT COUNT(*) AS count FROM quotes WHERE tax_rate > 0 AND tax_rate < 1");
  console.log(`Rows still in fraction scale after fix: ${after.rows[0].count}`);

  const stillBad = await pool.query("SELECT COUNT(*) AS count FROM quotes WHERE tax_rate >= 100");
  console.log(`Sanity check — rows with an implausible tax_rate >= 100 after fix: ${stillBad.rows[0].count}`);

  await pool.end();
}

main().catch((e) => {
  console.error("fix-quote-tax-rate-scale failed:", e.message);
  process.exit(1);
});
