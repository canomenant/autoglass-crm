// xlsx arrastra un prototype pollution sin parche publicado en npm (GHSA-4r6h-8v6p-xvw6).
// Congelar el prototipo hace que la escritura falle en vez de contaminar el proceso, que es lo
// que convertiria una hoja de calculo manipulada en control sobre las comprobaciones del resto
// del programa. Va en la PRIMERA linea, antes de que se cargue xlsx.
Object.freeze(Object.prototype);

require("dotenv").config();
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const xlsx = require("xlsx");
const pool = require("../src/config/db");
const customersStore = require("../src/store/customers.store");
const quotesStore = require("../src/store/quotes.store");
const workOrdersStore = require("../src/store/workorders.store");
const zipCodesStore = require("../src/store/zipCodes.store");

// Source: 715 new jobs (Jan-Aug 2026), customer-only data — vehicle/parts/pricing filled in by
// hand afterward. See the approved plan for full design rationale (address-parsing strategy,
// customer dedup rules, why work orders bypass createFromQuote).
const SOURCE_FILE = path.join(__dirname, "..", "imports", "new_work_orders_2026-08-19.xlsx");
const BACKUP_FILE = path.join(
  __dirname, "..", "backups",
  `${new Date().toISOString().replace(/[:.]/g, "-")}_new-work-orders-import-created-ids.json`
);
const CONCURRENCY = 8;
const ACTOR = "System - Bulk Import 2026-08-19";

const KNOWN_STATES = ["CA", "TX"];
const STATE_ZIP_RE = new RegExp(`\\b(${KNOWN_STATES.join("|")})\\b[^\\d]{0,40}?(\\d{5})(?:-\\d{4})?`, "i");

function stateFromZip(zip) {
  const n = Number(zip);
  if (n >= 90001 && n <= 96162) return "CA";
  if (n === 73301 || (n >= 75001 && n <= 79999) || (n >= 88510 && n <= 88595)) return "TX";
  return null;
}

function splitStreetCity(prefix) {
  const parts = prefix.split(",");
  if (parts.length >= 2) return { city: parts[parts.length - 1].trim(), street: parts.slice(0, -1).join(",").trim() };
  return { city: "", street: prefix };
}

// See the plan / prior analysis for why this two-tier approach (explicit CA/TX token first,
// ZIP-range inference second) gets 698/715 rows parsed instead of a naive last-token split.
function parseAddress(raw) {
  if (!raw) return { ok: false, reason: "empty" };
  let s = String(raw).trim().replace(/,?\s*(USA|US|Usa)\.?\s*$/i, "").trim();

  const m = s.match(STATE_ZIP_RE);
  if (m) {
    const prefix = s.slice(0, m.index).trim().replace(/,\s*$/, "").trim();
    return { ok: true, ...splitStreetCity(prefix), state: m[1].toUpperCase(), zip: m[2] };
  }

  const allNums = [...s.matchAll(/\b(\d{5})(?:-\d{4})?\b/g)];
  for (let i = allNums.length - 1; i >= 0; i--) {
    const inferredState = stateFromZip(allNums[i][1]);
    if (inferredState) {
      const prefix = s.slice(0, allNums[i].index).trim().replace(/,\s*$/, "").trim();
      return { ok: true, ...splitStreetCity(prefix), state: inferredState, zip: allNums[i][1] };
    }
  }
  return { ok: false, reason: "no CA/TX zip found", raw };
}

function excelDateToISO(serial) {
  if (!serial) return "";
  if (typeof serial === "string") return serial;
  const epoch = new Date(Date.UTC(1899, 11, 30));
  return new Date(epoch.getTime() + serial * 86400000).toISOString().slice(0, 10);
}

function normalizeType(raw) {
  const t = String(raw || "").trim().toLowerCase();
  if (t === "cancelled") return { workOrderStatus: "Cancelled", quoteStatus: "Cancelled", workOrderType: "Personal" };
  if (t === "insurance") return { workOrderStatus: "Scheduled", quoteStatus: "Draft", workOrderType: "Insurance" };
  return { workOrderStatus: "Scheduled", quoteStatus: "Draft", workOrderType: "Personal" };
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
  let rows = xlsx.utils.sheet_to_json(wb.Sheets["Hoja1"], { defval: null }).filter((r) => r["WO-NUMBERs"]);
  if (process.env.IMPORT_LIMIT) rows = rows.slice(0, Number(process.env.IMPORT_LIMIT));
  console.log(`Loaded ${rows.length} rows.`);

  // --- Phase A: resolve customers, sequentially (dedup-safe for repeated phones) ---
  const existingCustomers = await pool.query("SELECT id, phone FROM customers WHERE active <> false");
  const existingByPhone = new Map(existingCustomers.rows.map((r) => [String(r.phone || "").replace(/\D/g, ""), r.id]));
  const createdInRunByPhone = new Map();
  const parseFailures = [];
  const zipTaxCache = new Map();

  const prepared = [];
  const createdCustomerIds = [];
  let reusedExisting = 0;
  let reusedWithinRun = 0;
  let customersCreated = 0;

  for (const r of rows) {
    const phone = String(r["Teléfono"] || "").replace(/\D/g, "");
    const parsed = parseAddress(r["Dirección completa"]);
    if (!parsed.ok) parseFailures.push({ wo: r["WO-NUMBERs"], addr: r["Dirección completa"], reason: parsed.reason });

    let customerId;
    if (phone && existingByPhone.has(phone)) {
      customerId = existingByPhone.get(phone);
      reusedExisting++;
    } else if (phone && createdInRunByPhone.has(phone)) {
      customerId = createdInRunByPhone.get(phone);
      reusedWithinRun++;
    } else {
      const customer = await customersStore.create({
        firstName: r["Nombre"] || "",
        lastName: r["Apellido"] || "",
        phone,
        address: parsed.ok ? parsed.street : "",
        city: parsed.ok ? parsed.city : "",
        state: parsed.ok ? parsed.state : "",
        zipCode: parsed.ok ? parsed.zip : "",
        createdBy: ACTOR,
      });
      customerId = customer.id;
      if (phone) createdInRunByPhone.set(phone, customerId);
      createdCustomerIds.push(customerId);
      customersCreated++;
    }

    if (parsed.ok && !zipTaxCache.has(parsed.zip)) {
      const zipMatch = await zipCodesStore.findByZipcode(parsed.zip);
      // zip_codes.tax is a decimal fraction (0.0925 = 9.25%); quote.taxRate is a plain percentage
      // number (9.25) — computeTotals() divides it by 100 itself. Same conversion the frontend
      // does in QuoteForm.js when a zip is selected (`match.tax * 100`).
      zipTaxCache.set(parsed.zip, zipMatch ? Number(zipMatch.tax) * 100 : 0);
    }

    prepared.push({
      wo: r["WO-NUMBERs"],
      customerId,
      customerName: `${r["Nombre"] || ""} ${r["Apellido"] || ""}`.trim(),
      phone,
      address: r["Dirección completa"] || "",
      date: excelDateToISO(r["Fecha"]),
      type: normalizeType(r["Tipo"]),
      state: parsed.ok ? parsed.state : "",
      zip: parsed.ok ? parsed.zip : "",
      taxRate: parsed.ok ? zipTaxCache.get(parsed.zip) : 0,
    });
  }

  console.log(`Phase A done: ${customersCreated} customers created, ${reusedExisting} reused (existing), ${reusedWithinRun} reused (within file).`);
  console.log(`Address parse failures: ${parseFailures.length}`);

  // --- Phase B: create quote + work order per row, in parallel ---
  const createdIds = []; // { wo, customerId (only if newly created — tracked separately below), quoteId, workOrderId }
  let done = 0;
  let failed = 0;
  const failures = [];

  // Quote creation MUST be sequential: quotesStore.create() auto-numbers via a MAX(quote_no)+1
  // SELECT with no locking, so concurrent calls race and collide on the same number (hit this for
  // real in a 5-row test run — 2 of 5 failed on a duplicate quote_no). Work order writes use our
  // own pre-assigned, already-unique numbers, so those alone are safe to parallelize.
  const quoted = [];
  for (const row of prepared) {
    try {
      const quote = await quotesStore.create({
        status: row.type.quoteStatus,
        paymentType: row.type.workOrderType,
        customerType: "Existing",
        customerId: row.customerId,
        customerName: row.customerName,
        date: row.date,
        zipCode: row.zip,
        state: row.state,
        taxRate: row.taxRate,
        createdBy: ACTOR,
      });
      quoted.push({ row, quote });
    } catch (e) {
      failed++;
      failures.push({ wo: row.wo, stage: "quote", error: e.message });
    }
  }
  console.log(`Quotes created: ${quoted.length}/${prepared.length}`);

  await mapWithConcurrency(quoted, CONCURRENCY, async ({ row, quote }) => {
    try {
      const workOrder = {
        id: crypto.randomUUID(),
        workOrderNo: row.wo,
        quoteId: quote.id,
        quoteNo: quote.quoteNo,
        customerId: row.customerId,
        customerName: row.customerName,
        workOrderType: row.type.workOrderType,
        state: row.state,
        phone: row.phone,
        email: "",
        address: row.address,
        status: row.type.workOrderStatus,
        appointmentDate: row.date,
        cancelledAt: row.type.workOrderStatus === "Cancelled" ? row.date : null,
        active: true,
        createdBy: ACTOR,
        updatedBy: ACTOR,
        updatedAt: new Date().toISOString(),
      };
      await workOrdersStore.writeWorkOrderToSql(workOrder);
      createdIds.push({ wo: row.wo, quoteId: quote.id, workOrderId: workOrder.id });
    } catch (e) {
      failed++;
      failures.push({ wo: row.wo, stage: "workOrder", error: e.message });
    }
    done++;
    if (done % 100 === 0 || done === quoted.length) console.log(`  ${done}/${quoted.length} work orders processed (${failed} failed)`);
  });

  fs.writeFileSync(BACKUP_FILE, JSON.stringify({ createdCustomerIds, createdIds, parseFailures }, null, 2), "utf-8");
  console.log("Created-ids log (for rollback) written to:", BACKUP_FILE);

  if (failures.length) console.error("\nFAILURES:", JSON.stringify(failures, null, 2));

  console.log("\n=== RESULT ===");
  console.log("Rows processed:", prepared.length, "| WOs+quotes created:", done - failed, "| failed:", failed);
  console.log("Customers created:", customersCreated, "| reused (existing):", reusedExisting, "| reused (within file):", reusedWithinRun);
  console.log("Address parse failures (state/zip left blank):", parseFailures.length);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("import-new-work-orders-2026-08 failed:", e);
    process.exit(1);
  });
