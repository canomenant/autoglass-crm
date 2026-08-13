require("dotenv").config();
const pool = require("../src/config/db");

// The original historical import mapped work_orders_history.status ("Job Done") to
// work_orders.status ("Paid") but never touched payment.paid/payment.amount, which stayed at
// their JS defaults (false/0). payment.method WAS backfilled separately from history.payment_type
// in an earlier round, so these work orders show a payment method but no amount/paid flag —
// same root bug class as the tax-rate and NAGS-description gaps: only part of a record backfilled.
// total_sale is confirmed correct (0 mismatches vs work_orders_history.total), so it's the safe
// source for payment.amount. Wo-1312 is excluded — the only work order with payment.paid=true
// today, edited manually through the app after the migration; must not be overwritten with
// historical data.
const EXCLUDED = ["Wo-1312"];

// Charge Back (3 rows) map to status=Cancelled, same as real cancellations — money was collected
// then reversed, so paid=false is semantically correct, but the nuance is worth keeping visible.
const CHARGE_BACK_NOTE = "Charge Back (from historical import)";
const CHARGE_BACK_WOS = ["Wo-0472", "Wo-0581", "Wo-1442"];

async function main() {
  const before = await pool.query(
    "SELECT COUNT(*) AS count, SUM(total_sale) AS sum FROM work_orders WHERE status = 'Paid' AND work_order_no != ALL($1)",
    [EXCLUDED]
  );
  console.log(`Rows to backfill: ${before.rows[0].count}, total_sale sum: ${before.rows[0].sum}`);

  const result = await pool.query(
    `UPDATE work_orders
     SET payment = payment || jsonb_build_object('paid', true, 'amount', total_sale),
         updated_at = now()
     WHERE status = 'Paid' AND work_order_no != ALL($1)`,
    [EXCLUDED]
  );
  console.log(`Rows updated (paid/amount): ${result.rowCount}`);

  for (const wo of CHARGE_BACK_WOS) {
    await pool.query(
      `UPDATE work_orders
       SET internal_notes = CASE
             WHEN internal_notes IS NULL OR internal_notes = '' THEN $2
             ELSE internal_notes || ' | ' || $2
           END,
           updated_at = now()
       WHERE work_order_no = $1`,
      [wo, CHARGE_BACK_NOTE]
    );
  }
  console.log(`Charge Back notes appended: ${CHARGE_BACK_WOS.length}`);

  const after = await pool.query(
    "SELECT COUNT(*) AS count, SUM((payment->>'amount')::numeric) AS sum FROM work_orders WHERE (payment->>'paid')::boolean IS TRUE"
  );
  console.log(`Final: work_orders with payment.paid=true: ${after.rows[0].count}, total payment.amount: ${after.rows[0].sum}`);

  const excludedCheck = await pool.query(
    "SELECT work_order_no, payment FROM work_orders WHERE work_order_no = ANY($1)",
    [EXCLUDED]
  );
  console.log(`Excluded row(s) unchanged check:`, JSON.stringify(excludedCheck.rows));

  const cbCheck = await pool.query(
    "SELECT work_order_no, internal_notes FROM work_orders WHERE work_order_no = ANY($1)",
    [CHARGE_BACK_WOS]
  );
  console.log(`Charge Back notes:`, JSON.stringify(cbCheck.rows, null, 2));

  await pool.end();
}

main().catch((e) => {
  console.error("backfill-payment-paid-amount failed:", e.message);
  process.exit(1);
});
