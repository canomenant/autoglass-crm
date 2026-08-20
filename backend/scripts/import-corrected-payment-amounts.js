require("dotenv").config();
const fs = require("fs");
const path = require("path");
const xlsx = require("xlsx");
const workOrdersStore = require("../src/store/workorders.store");

// Source: "correciones para la web.xlsx", sheet "amount paid" — accounting's reconciled payment
// amounts against real collections, verified by the business against a handful of the largest
// discrepancies (Wo-3035, Wo-3832, Wo-2095) before this script was written. See
// backend/imports/correcciones_amount_paid_2026-08-18.xlsx for the source data.
const SOURCE_FILE = path.join(__dirname, "..", "imports", "correcciones_amount_paid_2026-08-18.xlsx");
const BACKUP_FILE = path.join(
  __dirname, "..", "backups",
  `${new Date().toISOString().replace(/[:.]/g, "-")}_payment-amount-correction-snapshot.json`
);

// Cancelled work orders the file assigns an amount to, but that never had a real payment —
// confirmed by the business and excluded entirely; left exactly as they are today.
const EXCLUDED_WOS = new Set(["Wo-1909", "Wo-0472", "Wo-0581", "Wo-1442"]);

// Manual one-off fix, not sourced from the file: a data-entry error (negative payment amount) on
// an insurance work order that never actually collected anything.
const SPECIAL_FIXES = { "Wo-3818": { amount: 0, paid: false } };

// The 43 work orders where the file says $0 but the system shows `payment.paid = true` are
// deliberately NOT touched here — pending a separate, per-row business decision. See
// pending-review-43.csv from the dry-run for that list.

const CONCURRENCY = 8;

function money(n) {
  return Number(n || 0).toFixed(2);
}

async function mapWithConcurrency(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: limit }, worker));
  return results;
}

async function main() {
  const wb = xlsx.readFile(SOURCE_FILE);
  const amountRows = xlsx.utils.sheet_to_json(wb.Sheets["amount paid"], { defval: null }).filter((r) => r["Work order #"]);
  const fileByWO = new Map(amountRows.map((r) => [r["Work order #"], Number(r["Amount Paid"] || 0)]));

  const allWO = await workOrdersStore.list();
  const woByNo = new Map(allWO.map((w) => [w.workOrderNo, w]));

  const beforeTotal = allWO.filter((w) => w.payment?.paid).reduce((s, w) => s + Number(w.payment?.amount || 0), 0);

  const plan = []; // { id, workOrderNo, oldPayment, newAmount, newPaid }
  for (const [wo, fileAmt] of fileByWO.entries()) {
    if (EXCLUDED_WOS.has(wo)) continue;
    const sys = woByNo.get(wo);
    if (!sys) continue;

    if (SPECIAL_FIXES[wo]) {
      plan.push({ id: sys.id, workOrderNo: wo, oldPayment: sys.payment, newAmount: SPECIAL_FIXES[wo].amount, newPaid: SPECIAL_FIXES[wo].paid });
      continue;
    }
    if (!sys.payment?.paid) continue; // the 4 exclusions cover every such case; guard regardless
    if (fileAmt <= 0) continue; // the 43 pending-review rows — not touched by this script
    const sysAmt = Number(sys.payment?.amount || 0);
    if (Math.abs(fileAmt - sysAmt) < 0.005) continue; // already correct, nothing to do

    plan.push({ id: sys.id, workOrderNo: wo, oldPayment: sys.payment, newAmount: fileAmt, newPaid: sys.payment.paid });
  }

  console.log(`Plan: ${plan.length} work orders to update.`);

  // Snapshot every row's current payment object before touching anything, so this is reversible.
  fs.writeFileSync(
    BACKUP_FILE,
    JSON.stringify(plan.map((p) => ({ id: p.id, workOrderNo: p.workOrderNo, payment: p.oldPayment })), null, 2),
    "utf-8"
  );
  console.log("Backup snapshot written to:", BACKUP_FILE);

  let done = 0;
  let failed = 0;
  const failures = [];
  await mapWithConcurrency(plan, CONCURRENCY, async (item) => {
    try {
      await workOrdersStore.update(item.id, {
        payment: { amount: item.newAmount, paid: item.newPaid },
        updatedBy: "System - Payment Correction Import 2026-08-18",
      });
    } catch (e) {
      failed++;
      failures.push({ workOrderNo: item.workOrderNo, error: e.message });
    }
    done++;
    if (done % 250 === 0 || done === plan.length) {
      console.log(`  ${done}/${plan.length} processed (${failed} failed)`);
    }
  });

  if (failures.length) {
    console.error("\nFAILURES:", JSON.stringify(failures, null, 2));
  }

  const afterWO = await workOrdersStore.list();
  const afterTotal = afterWO.filter((w) => w.payment?.paid).reduce((s, w) => s + Number(w.payment?.amount || 0), 0);

  console.log("\n=== RESULT ===");
  console.log("Before total (paid WOs):", money(beforeTotal));
  console.log("After total (paid WOs):", money(afterTotal));
  console.log("Delta:", money(afterTotal - beforeTotal));
  console.log("Updated:", done - failed, "/ Failed:", failed);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("import-corrected-payment-amounts failed:", e);
    process.exit(1);
  });
