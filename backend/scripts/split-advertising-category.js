require("dotenv").config();
const pool = require("../src/config/db");
const { initPostgres } = require("../src/lib/initPostgres");

// Splits the "Publicidad" expenses imported by import-operating-expenses.js into the
// subcategories the user's accountant already uses, based on the payee embedded in each
// record's `notes` field. Confirmed with the user before running:
// - Marketing - Lead Vendors: LL MEDIA, ACTEER JR (PayPal), GLASS.COM = $335,605.00 / 127 rows
// - Advertising / WEB: the one remaining row ("purchase / Media", $2,892.00, no identifiable payee)
// - Callrail Inc ($62.21) moves to Software — it's call tracking, not advertising.
const LEAD_VENDOR_PATTERN = /LL MEDIA|ACTEER ?JR|GLASS\.COM/i;
const CALLRAIL_PATTERN = /Callrail/i;

const LEAD_VENDORS_CATEGORY = "Marketing - Lead Vendors";
const ADVERTISING_WEB_CATEGORY = "Advertising / WEB";
const SOFTWARE_CATEGORY = "Software";
const OLD_CATEGORY = "Publicidad";

async function main() {
  await initPostgres();
  const expenseCategoriesStore = require("../src/store/expenseCategories.store");
  const { save } = require("../src/lib/persistence");

  // 1) Ensure the two new categories exist.
  const categories = expenseCategoriesStore.list();
  let nextCategoryId = categories.reduce((max, c) => Math.max(max, Number(c.id) || 0), 0) + 1;
  const categoryNames = new Set(categories.map((c) => c.name));
  const newCategories = [];
  for (const name of [LEAD_VENDORS_CATEGORY, ADVERTISING_WEB_CATEGORY]) {
    if (!categoryNames.has(name)) {
      newCategories.push({ id: nextCategoryId++, name });
    }
  }
  if (newCategories.length) {
    save("expenseCategories.json", [...categories, ...newCategories]);
    console.log(`Created categories: ${newCategories.map((c) => c.name).join(", ")}`);
  } else {
    console.log("Both target categories already exist, no new category created.");
  }

  // 2) Reclassify the "Publicidad" expense records.
  const expensesStore = require("../src/store/expenses.store");
  const expenses = expensesStore.list();

  const moves = { [LEAD_VENDORS_CATEGORY]: [], [ADVERTISING_WEB_CATEGORY]: [], [SOFTWARE_CATEGORY]: [] };
  for (const e of expenses) {
    if (e.category !== OLD_CATEGORY) continue;
    if (LEAD_VENDOR_PATTERN.test(e.notes)) {
      e.category = LEAD_VENDORS_CATEGORY;
      moves[LEAD_VENDORS_CATEGORY].push(e);
    } else if (CALLRAIL_PATTERN.test(e.notes)) {
      e.category = SOFTWARE_CATEGORY;
      moves[SOFTWARE_CATEGORY].push(e);
    } else {
      e.category = ADVERTISING_WEB_CATEGORY;
      moves[ADVERTISING_WEB_CATEGORY].push(e);
    }
  }

  console.log("\n=== Reclassification ===");
  for (const [cat, list] of Object.entries(moves)) {
    const sum = list.reduce((s, e) => s + Number(e.amount || 0), 0);
    console.log(`  -> ${cat.padEnd(28)} ${String(list.length).padStart(3)} rows  $${sum.toFixed(2)}`);
  }
  const remainingAdvertising = expenses.filter((e) => e.category === OLD_CATEGORY).length;
  console.log(`  Remaining under "${OLD_CATEGORY}": ${remainingAdvertising}`);

  // Single write, same reasoning as import-operating-expenses.js: avoid racing fire-and-forget syncs.
  save("expenses.json", expenses);

  await new Promise((r) => setTimeout(r, 2000));

  const verify = await pool.query("SELECT value FROM app_data WHERE key = 'expenses.json'");
  const persisted = verify.rows[0].value;
  const byCat = {};
  for (const e of persisted) byCat[e.category] = (byCat[e.category] || 0) + Number(e.amount || 0);
  console.log("\n=== Verification against app_data ===");
  console.log(byCat);
  const grandTotal = persisted.reduce((s, e) => s + Number(e.amount || 0), 0);
  console.log(`Total records: ${persisted.length}, grand total: $${grandTotal.toFixed(2)}`);
  if (Math.abs(grandTotal - 370404.27) > 0.01) {
    throw new Error("Grand total changed after reclassification — should be unchanged!");
  }

  await pool.end();
}

main().catch((e) => {
  console.error("split-advertising-category failed:", e.message);
  process.exit(1);
});
