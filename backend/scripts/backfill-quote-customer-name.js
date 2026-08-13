require("dotenv").config();
const pool = require("../src/config/db");

// quotes.customer_name is empty for the same 3863 historical records as the work_orders.
// customer_name gap (customer_id itself was always correctly linked — confirmed 0 mismatches
// between work_orders.customer_id and quotes.customer_id for linked pairs). Visible in
// QuoteForm's summary panel (displayCustomerName reads form.customerName directly for
// existing customers) and would get silently re-written as "" on any save that doesn't
// touch the customer selector. Same backfill pattern as work_orders.customer_name.
async function main() {
  const before = await pool.query(
    "SELECT COUNT(*) AS count FROM quotes WHERE customer_id IS NOT NULL AND (customer_name IS NULL OR customer_name = '')"
  );
  console.log(`Rows to backfill: ${before.rows[0].count}`);

  const result = await pool.query(`
    UPDATE quotes
    SET customer_name = TRIM(CONCAT(c.first_name, ' ', c.last_name)), updated_at = now()
    FROM customers c
    WHERE quotes.customer_id = c.id
      AND (quotes.customer_name IS NULL OR quotes.customer_name = '')
  `);
  console.log(`Rows updated: ${result.rowCount}`);

  const after = await pool.query(
    "SELECT COUNT(*) AS count FROM quotes WHERE customer_id IS NOT NULL AND (customer_name IS NULL OR customer_name = '')"
  );
  console.log(`Rows still missing after backfill: ${after.rows[0].count}`);

  await pool.end();
}

main().catch((e) => {
  console.error("backfill-quote-customer-name failed:", e.message);
  process.exit(1);
});
