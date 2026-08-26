// xlsx arrastra un prototype pollution sin parche publicado en npm (GHSA-4r6h-8v6p-xvw6).
// Congelar el prototipo hace que la escritura falle en vez de contaminar el proceso, que es lo
// que convertiria una hoja de calculo manipulada en control sobre las comprobaciones del resto
// del programa. Va en la PRIMERA linea, antes de que se cargue xlsx.
Object.freeze(Object.prototype);

require("dotenv").config();
const path = require("path");
const xlsx = require("xlsx");
const pool = require("../src/config/db");

// Real historical agent commissions (COMMISSION_AGENTS.xlsx, 3,865 rows, $52,196.47 total) —
// flat amounts that vary per job, not a percentage of any total. Verified before running:
// 100% of Work order # values match work_orders.work_order_no, and agent names match the
// agents catalog exactly (including "Golbal Office Works", which is spelled that way in the
// catalog itself, not a typo introduced by this file).
const FILE_PATH = path.join(__dirname, "..", "imports", "COMMISSION_AGENTS.xlsx");

async function main() {
  const wb = xlsx.readFile(FILE_PATH);
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = xlsx.utils.sheet_to_json(sheet, { defval: null }).filter((r) => r["Work order #"]);
  console.log(`Rows in file: ${rows.length}`);

  const dbRows = await pool.query("SELECT work_order_no FROM work_orders");
  const dbSet = new Set(dbRows.rows.map((r) => r.work_order_no));

  let matched = 0;
  let unmatched = 0;
  let totalImported = 0;
  const unmatchedList = [];

  for (const row of rows) {
    const woNo = row["Work order #"];
    const amount = Number(row["COMISSION AGENT"] || 0);
    if (!dbSet.has(woNo)) {
      unmatched++;
      unmatchedList.push(woNo);
      continue;
    }
    await pool.query("UPDATE work_orders SET commission = $1, updated_at = now() WHERE work_order_no = $2", [
      amount,
      woNo,
    ]);
    matched++;
    totalImported += amount;
  }

  console.log("\n=== Results ===");
  console.log(`Matched and imported: ${matched}`);
  console.log(`Unmatched (no such work_order_no): ${unmatched}`);
  if (unmatchedList.length) console.log("Unmatched WO numbers:", JSON.stringify(unmatchedList));
  console.log(`Total commission imported: ${totalImported.toFixed(2)}`);

  const verify = await pool.query("SELECT COUNT(*) AS count, SUM(commission) AS sum FROM work_orders WHERE commission != 0");
  console.log(`Verification — work_orders with commission != 0: ${verify.rows[0].count}, sum: ${verify.rows[0].sum}`);

  await pool.end();
}

main().catch((e) => {
  console.error("import-agent-commissions failed:", e.message);
  process.exit(1);
});
