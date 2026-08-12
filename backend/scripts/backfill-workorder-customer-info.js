require("dotenv").config();
const pool = require("../src/config/db");

// work_orders.customer_name/phone/email/address are denormalized copies meant to be set at
// creation time (createFromQuote pulls them from the quote/customer). ~3863 historical,
// bulk-imported rows have a real customer_id but these text columns were never backfilled
// from the linked customer — confirmed against app_data['workorders.json'] (the pre-Fase-4
// source), which has zero rows with an empty customerName. This is a one-time data backfill,
// not a code bug: mapWorkOrder()/workorders.store.js already read these columns correctly.
async function main() {
  const before = await pool.query(
    "SELECT COUNT(*) AS count FROM work_orders WHERE customer_id IS NOT NULL AND (customer_name IS NULL OR customer_name = '')"
  );
  console.log(`Rows needing backfill: ${before.rows[0].count}`);

  const result = await pool.query(`
    UPDATE work_orders
    SET
      customer_name = COALESCE(NULLIF(work_orders.customer_name, ''), TRIM(CONCAT(c.first_name, ' ', c.last_name))),
      phone = COALESCE(NULLIF(work_orders.phone, ''), c.phone),
      email = COALESCE(NULLIF(work_orders.email, ''), c.email),
      address = COALESCE(NULLIF(work_orders.address, ''), c.address)
    FROM customers c
    WHERE work_orders.customer_id = c.id
      AND (work_orders.customer_name IS NULL OR work_orders.customer_name = '')
  `);
  console.log(`Rows updated: ${result.rowCount}`);

  const after = await pool.query(
    "SELECT COUNT(*) AS count FROM work_orders WHERE customer_id IS NOT NULL AND (customer_name IS NULL OR customer_name = '')"
  );
  console.log(`Rows still missing after backfill: ${after.rows[0].count}`);
  if (Number(after.rows[0].count) > 0) {
    const orphans = await pool.query(
      "SELECT id, work_order_no, customer_id FROM work_orders WHERE customer_id IS NOT NULL AND (customer_name IS NULL OR customer_name = '') LIMIT 10"
    );
    console.log("Sample of unresolved rows (customer_id likely doesn't match any row in customers):", JSON.stringify(orphans.rows));
  }

  await pool.end();
}

main().catch((e) => {
  console.error("backfill-workorder-customer-info failed:", e.message);
  process.exit(1);
});
