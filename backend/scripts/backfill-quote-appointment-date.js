require("dotenv").config();
const pool = require("../src/config/db");

// quotes.appointment_date is NULL for all 3866 quotes — never populated during the historical
// import, even though the linked work_orders.appointment_date is (3864/3866). The edit form
// (QuoteForm via initialData={quote}) reads from quotes, so it showed blank while the work
// orders list (reading from work_orders directly) showed the date correctly. One-time backfill
// via the work_orders.quote_id -> quotes.id link, mirroring the customer_name backfill.
async function main() {
  const before = await pool.query(
    "SELECT COUNT(*) AS count FROM quotes q JOIN work_orders w ON w.quote_id = q.id WHERE q.appointment_date IS NULL AND w.appointment_date IS NOT NULL"
  );
  console.log(`Rows to backfill: ${before.rows[0].count}`);

  const result = await pool.query(`
    UPDATE quotes
    SET appointment_date = w.appointment_date, updated_at = now()
    FROM work_orders w
    WHERE w.quote_id = quotes.id
      AND quotes.appointment_date IS NULL
      AND w.appointment_date IS NOT NULL
  `);
  console.log(`Rows updated: ${result.rowCount}`);

  const after = await pool.query(
    "SELECT COUNT(*) AS count FROM quotes q JOIN work_orders w ON w.quote_id = q.id WHERE q.appointment_date IS NULL AND w.appointment_date IS NOT NULL"
  );
  console.log(`Rows still unresolved: ${after.rows[0].count}`);

  await pool.end();
}

main().catch((e) => {
  console.error("backfill-quote-appointment-date failed:", e.message);
  process.exit(1);
});
