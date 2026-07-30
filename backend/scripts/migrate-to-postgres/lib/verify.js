require("dotenv").config();
const { loadOrSeed } = require("../../../src/lib/persistence");
const pool = require("../../../src/config/db");

// Each entry: { json: source file, table: destination table, childArrayField?: for child tables,
// the field on each JSON record whose array length should be summed instead of counting JSON records directly }
const ENTITY_TABLE_MAP = [
  { json: "jobTypes.json", table: "job_types" },
  { json: "partNumbers.json", table: "part_numbers" },
  { json: "calibrationTypes.json", table: "calibration_types" },
  { json: "priceTiers.json", table: "price_tiers" },
  { json: "vehicleTypes.json", table: "vehicle_types" },
  { json: "zipCodes.json", table: "zip_codes" },
  { json: "paymentMethods.json", table: "payment_methods" },
  { json: "paymentStatus.json", table: "payment_statuses" },
  { json: "tags.json", table: "tags" },
  { json: "expenseCategories.json", table: "expense_categories" },
  { json: "partnerCompanies.json", table: "partner_companies" },
  { json: "users.json", table: "users" },
  { json: "expenses.json", table: "expenses" },
  { json: "tableViews.json", table: "table_views" },
  { json: "attachments.json", table: "attachments" },
  { json: "workOrderNotifications.json", table: "work_order_notifications" },
  { json: "quoteIntakeNotifications.json", table: "quote_intake_notifications" },
  { json: "customers.json", table: "customers" },
  { json: "insurance.json", table: "insurance_companies" },
  { json: "distributors.json", table: "distributors" },
  { json: "agents.json", table: "agents" },
  { json: "technicians.json", table: "technicians" },
  { json: "quotes.json", table: "quotes" },
  { json: "quotes.json", table: "quote_line_items", childArrayField: "lineItems" },
  { json: "workorders.json", table: "workorders" },
  { json: "payments.json", table: "payments" },
  { json: "notes.json", table: "notes" },
  { json: "invoices.json", table: "invoices" },
  { json: "invoices.json", table: "invoice_line_items", childArrayField: "items" },
];

async function verify({ only } = {}) {
  const rows = [];
  let allOk = true;

  for (const entry of ENTITY_TABLE_MAP) {
    if (only && !only.includes(entry.table)) continue;

    const records = loadOrSeed(entry.json, () => []);
    const expected = entry.childArrayField
      ? records.reduce((sum, r) => sum + (Array.isArray(r[entry.childArrayField]) ? r[entry.childArrayField].length : 0), 0)
      : records.length;

    const { rows: countRows } = await pool.query(`SELECT COUNT(*)::int AS count FROM ${entry.table}`);
    const actual = countRows[0].count;
    const ok = expected === actual;
    if (!ok) allOk = false;

    rows.push({ table: entry.table, expected, actual, status: ok ? "OK" : "MISMATCH" });
  }

  const nameWidth = Math.max(...rows.map((r) => r.table.length), 20);
  console.log(
    `${"table".padEnd(nameWidth)}  ${"expected".padStart(8)}  ${"actual".padStart(8)}  status`
  );
  for (const r of rows) {
    console.log(
      `${r.table.padEnd(nameWidth)}  ${String(r.expected).padStart(8)}  ${String(r.actual).padStart(8)}  ${r.status}`
    );
  }

  return allOk;
}

if (require.main === module) {
  const onlyArg = process.argv.find((a) => a.startsWith("--only="));
  const only = onlyArg ? onlyArg.slice("--only=".length).split(",") : undefined;

  verify({ only })
    .then((ok) => {
      if (!ok) {
        console.error("\nRow count verification FAILED.");
        process.exit(1);
      }
      console.log("\nRow count verification passed.");
      return pool.end();
    })
    .catch((err) => {
      console.error("Verification error:", err.message);
      process.exit(1);
    });
}

module.exports = { verify, ENTITY_TABLE_MAP };
