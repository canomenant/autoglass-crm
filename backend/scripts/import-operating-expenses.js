require("dotenv").config();
const path = require("path");
const xlsx = require("xlsx");
const pool = require("../src/config/db");
const { initPostgres } = require("../src/lib/initPostgres");

// Historical operating expenses (expenses_reyes_2025_and_2025.xlsx, 1,256 rows, Jan 2025-Aug 2026).
// Only 5 of the source categories are real, unrecorded operating expenses; everything else is
// either a credit-card payment/reward, or already recorded elsewhere in the system:
// Parts And Materials -> glass_cost, Subcontracted Service -> labor_cost, CALL CENTER -> agent
// commissions (work_orders.commission) — confirmed with the user before running this import.
const FILE_PATH = path.join(__dirname, "..", "imports", "expenses_reyes_2025_and_2025.xlsx");

const CATEGORY_MAP = {
  advertising: "Publicidad",
  "bank service charges": "Comisiones bancarias",
  telephone: "Teléfono",
  software: "Software",
  "accounting fees": "Honorarios de contabilidad",
};

const EXPECTED_TOTAL = 370404.27;

function normalizeCategory(cat) {
  return String(cat || "").trim().toLowerCase().replace(/\s+/g, " ");
}

function parseAmount(raw) {
  let s = String(raw || "").trim();
  s = s.replace(/USD/i, "").replace(/\$/g, "").trim();
  s = s.replace(/[(),]/g, "").replace(/^-/, "");
  const n = parseFloat(s);
  return isNaN(n) ? 0 : Math.abs(n);
}

function parseDate(raw) {
  const [m, d, y] = String(raw || "").trim().split("/").map(Number);
  const year = y < 100 ? 2000 + y : y;
  return `${year}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

async function main() {
  // Must happen before requiring the store: expenses.store.js reads/caches its data at
  // require-time via loadOrSeed(), which prefers app_data over the local JSON file once
  // Postgres owns the key — without this, save() silently skips the app_data sync too.
  await initPostgres();
  const expensesStore = require("../src/store/expenses.store");

  const existing = expensesStore.list();
  if (existing.length > 0) {
    throw new Error(`expenses store is not empty (${existing.length} records) — aborting to avoid double-import`);
  }

  const wb = xlsx.readFile(FILE_PATH, { cellDates: true });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = xlsx.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: "" });
  const data = rows.slice(1).filter((r) => r[0] || r[1] || r[3]);

  const totalsByCategory = {};
  const records = [];
  let nextId = 1;

  for (const row of data) {
    const sourceCat = normalizeCategory(row[1]);
    const destCat = CATEGORY_MAP[sourceCat];
    if (!destCat) continue;

    const date = parseDate(row[0]);
    const amount = parseAmount(row[3]);
    const description = String(row[2] || "").trim();
    const paymentMethod = String(row[4] || "").trim();
    const notes = paymentMethod ? `${description} — ${paymentMethod}` : description;

    records.push({
      id: nextId++,
      category: destCat,
      date,
      amount,
      notes,
      attachments: [],
      createdAt: new Date().toISOString(),
    });
    totalsByCategory[destCat] = (totalsByCategory[destCat] || 0) + amount;
  }

  const grandTotal = records.reduce((sum, e) => sum + e.amount, 0);

  console.log("=== Import results ===");
  console.log(`Records imported: ${records.length}`);
  for (const [cat, sum] of Object.entries(totalsByCategory).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${cat.padEnd(28)} $${sum.toFixed(2)}`);
  }
  console.log(`Grand total: $${grandTotal.toFixed(2)} (expected $${EXPECTED_TOTAL.toFixed(2)})`);
  if (Math.abs(grandTotal - EXPECTED_TOTAL) > 0.01) {
    throw new Error("MISMATCH between imported total and expected total — aborting before write");
  }

  // Single write (not one per record): calling the store's create() in a loop fires one
  // fire-and-forget app_data sync per record, and those races can let an earlier, smaller
  // snapshot land in Postgres after a later, fuller one — corrupting the persisted array.
  // persist() is not exported, so we go through the same lib/persistence.save() it uses,
  // once, with the complete array.
  const { save } = require("../src/lib/persistence");
  save("expenses.json", records);

  // save()'s app_data sync is itself fire-and-forget; give it time to land before verifying.
  await new Promise((r) => setTimeout(r, 2000));

  const verify = await pool.query("SELECT value FROM app_data WHERE key = 'expenses.json'");
  const persisted = verify.rows[0] ? verify.rows[0].value : [];
  const persistedSum = persisted.reduce((sum, e) => sum + Number(e.amount || 0), 0);
  console.log("\n=== Verification against app_data (Postgres) ===");
  console.log(`Records in app_data: ${persisted.length}`);
  console.log(`Sum in app_data: $${persistedSum.toFixed(2)}`);
  if (persisted.length !== records.length || Math.abs(persistedSum - grandTotal) > 0.01) {
    throw new Error("Verification failed: app_data does not match what was imported");
  }

  await pool.end();
}

main().catch((e) => {
  console.error("import-operating-expenses failed:", e.message);
  process.exit(1);
});
