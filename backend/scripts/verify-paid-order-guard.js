// Offline check of the paid-work-order guard in quotes.store.js.
//
// Every pool.query() is stubbed, so this touches no database and is safe to run anywhere:
//   cd backend && node scripts/verify-paid-order-guard.js
//
// Covers the behaviours that protect money already collected — refuse a reprice of a Paid/Closed
// order and write nothing, let a confirmed one through and record it, and stay out of the way for
// unchanged prices, open orders, and quotes with no work order at all. Verifies the three behaviours that matter — refuse + write nothing, allow when
// confirmed + write an audit row, and stay silent when the price didn't move.
process.env.DATABASE_URL = "postgres://stub";
const ROOT = require("path").join(__dirname, "..");
const pool = require(ROOT + "/src/config/db");

let queries = [];
let workOrderRow = null;

const quoteRow = {
  id: "q-1", quote_no: "Q-0042", status: "Converted", payment_type: "Personal",
  line_items: [{ id: "li-1", jobType: "Windshield", pricePart: 300, priceTier: 0, qty: 1 }],
  tax_rate: 0, upsell: 0, paid_amount: 0, active: true,
};

pool.query = async (sql, params) => {
  queries.push({ sql: String(sql).trim().split("\n")[0].trim(), params });
  if (/^SELECT \* FROM quotes/.test(sql.trim())) return { rows: [quoteRow] };
  if (/FROM work_orders/.test(sql)) return { rows: workOrderRow ? [workOrderRow] : [] };
  return { rows: [] };
};

const store = require(ROOT + "/src/store/quotes.store");

function writes() {
  return queries.filter((q) => /^(INSERT|UPDATE)/i.test(q.sql));
}

let failures = 0;
function check(label, ok, detail) {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}`);
  if (!ok) { failures++; if (detail) console.log("        " + detail); }
}

(async () => {
  // 1. Paid work order, price moves 300 -> 450: refused, nothing written.
  workOrderRow = { id: "wo-1", work_order_no: "Wo-3901", status: "Paid", total_sale: 300 };
  queries = [];
  let thrown = null;
  try {
    await store.update("q-1", { lineItems: [{ id: "li-1", jobType: "Windshield", pricePart: 450, qty: 1 }] });
  } catch (e) { thrown = e; }
  check("Paid order + price change is refused", thrown?.code === "PAID_WORK_ORDER_PRICE_CHANGE", `got ${thrown && thrown.message}`);
  check("  details carry the work order number", thrown?.details?.workOrderNo === "Wo-3901", JSON.stringify(thrown?.details));
  check("  details carry old and new price", thrown?.details?.oldPrice === 300 && thrown?.details?.newPrice === 450, JSON.stringify(thrown?.details));
  check("  nothing was written", writes().length === 0, JSON.stringify(writes().map((q) => q.sql)));

  // 2. Same save, confirmed: goes through and records an audit row.
  queries = [];
  await store.update("q-1", { lineItems: [{ id: "li-1", jobType: "Windshield", pricePart: 450, qty: 1 }] }, { confirmPriceChange: true, actor: "Antonio" });
  check("Confirmed save writes the quote", writes().some((q) => /^INSERT INTO quotes/i.test(q.sql)));
  check("  syncs the work order", writes().some((q) => /^UPDATE work_orders/i.test(q.sql)));
  const audit = queries.find((q) => /paid_work_order_price_changes/.test(q.sql));
  check("  records an audit row", !!audit, JSON.stringify(queries.map((q) => q.sql)));
  check("  audit row names the actor", audit?.params?.[7] === "Antonio", JSON.stringify(audit?.params));

  // 3. Paid order, price unchanged (only notes edited): saves silently.
  queries = [];
  await store.update("q-1", { damageNotes: "chip on the passenger side" });
  check("Unchanged price on a Paid order does not prompt", writes().some((q) => /^INSERT INTO quotes/i.test(q.sql)));
  check("  and records no audit row", !queries.some((q) => /paid_work_order_price_changes/.test(q.sql)));

  // 4. Open work order: never prompts, whatever the price does.
  workOrderRow = { id: "wo-2", work_order_no: "Wo-3902", status: "Scheduled", total_sale: 300 };
  queries = [];
  await store.update("q-1", { lineItems: [{ id: "li-1", jobType: "Windshield", pricePart: 999, qty: 1 }] });
  check("Open order reprices with no prompt", writes().some((q) => /^UPDATE work_orders/i.test(q.sql)));
  check("  and records no audit row", !queries.some((q) => /paid_work_order_price_changes/.test(q.sql)));

  // 5. Closed counts as locked too.
  workOrderRow = { id: "wo-3", work_order_no: "Wo-3903", status: "Closed", total_sale: 300 };
  queries = [];
  thrown = null;
  try {
    await store.update("q-1", { lineItems: [{ id: "li-1", jobType: "Windshield", pricePart: 500, qty: 1 }] });
  } catch (e) { thrown = e; }
  check("Closed order + price change is refused", thrown?.code === "PAID_WORK_ORDER_PRICE_CHANGE");

  // 6. No linked work order at all.
  workOrderRow = null;
  queries = [];
  await store.update("q-1", { lineItems: [{ id: "li-1", jobType: "Windshield", pricePart: 777, qty: 1 }] });
  check("Quote with no work order saves normally", writes().some((q) => /^INSERT INTO quotes/i.test(q.sql)));

  console.log(failures ? `\n${failures} FAILED` : "\nall passed");
  process.exit(failures ? 1 : 0);
})();
