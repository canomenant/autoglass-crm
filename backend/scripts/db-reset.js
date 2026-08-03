require("dotenv").config();
const pool = require("../src/config/db");

const CORE_TABLES = [
  "quote_line_items",
  "invoice_line_items",
  "invoices",
  "work_order_notifications",
  "quote_intake_notifications",
  "payments",
  "notes",
  "workorders",
  "quotes",
  "customers",
];
const ATTACHMENT_RELATED_TYPES = ["quotes", "workorders", "customers", "payments", "notes", "invoices"];

async function run() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`TRUNCATE ${CORE_TABLES.join(", ")} RESTART IDENTITY CASCADE`);
    console.log(`Truncated: ${CORE_TABLES.join(", ")}`);
    const attRes = await client.query(
      "DELETE FROM attachments WHERE related_type = ANY($1::text[])",
      [ATTACHMENT_RELATED_TYPES]
    );
    console.log(`Removed ${attRes.rowCount} orphaned attachment(s)`);
    await client.query("COMMIT");
    console.log("db:reset complete.");
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("db:reset failed:", err.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

run();
