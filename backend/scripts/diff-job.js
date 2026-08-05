require("dotenv").config();
const fs = require("fs");
const path = require("path");
const pool = require("../src/config/db");

const DATA_DIR = path.join(__dirname, "..", "data");

// The real, current JSON side is the local file persist()/loadOrSeed() actually read/write —
// app_data in Postgres is only a boot-time cache (see initPostgres.js), never updated after a
// write, so it goes stale the moment anything is created post-boot. Reading it here would make
// every new record look "missing," even when the SQL sync worked correctly.
function readLocalJson(file) {
  const p = path.join(DATA_DIR, file);
  if (!fs.existsSync(p)) return [];
  return JSON.parse(fs.readFileSync(p, "utf-8"));
}

function businessNumber(businessKey) {
  const digits = String(businessKey || "").replace(/\D/g, "");
  return digits ? Number(digits) : null;
}

// Two things this catches that the per-record id/status diff above it doesn't:
// duplicate numbers within the same source (a real collision, e.g. the race window noted
// in nextBusinessNumber), and any *new* record (number > 3865, past the historical range)
// whose number doesn't match between JSON and SQL — the exact bug class fixed this round.
function checkNumbering(label, keys) {
  const seen = new Map();
  let duplicates = 0;
  for (const key of keys) {
    const num = businessNumber(key);
    if (num === null) continue;
    if (seen.has(num)) {
      duplicates++;
      console.warn(`[diff-job:${label}] duplicate business number ${num}: '${seen.get(num)}' and '${key}'`);
    } else {
      seen.set(num, key);
    }
    if (num > 3865) {
      console.log(`[diff-job:${label}] new record past historical range: ${key}`);
    }
  }
  if (duplicates === 0) console.log(`[diff-job:${label}] no duplicate business numbers`);
}

function customerKey(c) {
  const phone = (c.phone || "").trim();
  if (phone) return `p:${phone}`;
  const email = (c.email || "").trim().toLowerCase();
  return email ? `e:${email}` : null;
}

async function diffCustomers() {
  const sqlRes = await pool.query("SELECT id, first_name, last_name, phone, email, address FROM customers");
  const jsonRows = readLocalJson("customers.json").filter((c) => c.active !== false);
  const sqlByKey = new Map(sqlRes.rows.map((r) => [customerKey(r), r]));

  let mismatched = 0;
  let missing = 0;
  for (const json of jsonRows) {
    const key = customerKey(json);
    const sql = key ? sqlByKey.get(key) : null;
    if (!sql) {
      missing++;
      console.warn(`[diff-job:customers] missing in SQL: ${key || "(no phone/email)"}`);
      continue;
    }
    if (String(json.id) !== String(sql.id)) {
      mismatched++;
      console.warn(`[diff-job:customers] id mismatch for ${key}: app_data=${json.id} vs sql=${sql.id}`);
    }
  }
  console.log(`[diff-job:customers] ${jsonRows.length} in JSON, ${sqlRes.rows.length} in SQL, ${missing} missing, ${mismatched} id mismatches`);
}

async function diffQuotes() {
  const sqlRes = await pool.query("SELECT id, quote_no, status FROM quotes");
  const jsonRows = readLocalJson("quotes.json").filter((q) => q.active !== false);
  const sqlByNo = new Map(sqlRes.rows.map((r) => [r.quote_no, r]));

  let mismatched = 0;
  let missing = 0;
  for (const json of jsonRows) {
    const sql = sqlByNo.get(json.quoteNo);
    if (!sql) {
      missing++;
      console.warn(`[diff-job:quotes] missing in SQL: ${json.quoteNo}`);
      continue;
    }
    if (String(json.id) !== String(sql.id) || json.status !== sql.status) {
      mismatched++;
      console.warn(`[diff-job:quotes] mismatch for ${json.quoteNo}: id ${json.id} vs ${sql.id}, status '${json.status}' vs '${sql.status}'`);
    }
  }
  console.log(`[diff-job:quotes] ${jsonRows.length} in JSON, ${sqlRes.rows.length} in SQL, ${missing} missing, ${mismatched} mismatches`);
  checkNumbering("quotes:json", jsonRows.map((q) => q.quoteNo));
  checkNumbering("quotes:sql", sqlRes.rows.map((r) => r.quote_no));
}

async function diffWorkOrders() {
  const sqlRes = await pool.query("SELECT id, work_order_no, status, total_sale FROM work_orders");
  const jsonRows = readLocalJson("workorders.json").filter((w) => w.active !== false);
  const sqlByNo = new Map(sqlRes.rows.map((r) => [r.work_order_no, r]));

  let mismatched = 0;
  let missing = 0;
  for (const json of jsonRows) {
    const sql = sqlByNo.get(json.workOrderNo);
    if (!sql) {
      missing++;
      console.warn(`[diff-job:workorders] missing in SQL: ${json.workOrderNo}`);
      continue;
    }
    if (String(json.id) !== String(sql.id) || json.status !== sql.status || Number(json.totalSale || 0) !== Number(sql.total_sale || 0)) {
      mismatched++;
      console.warn(`[diff-job:workorders] mismatch for ${json.workOrderNo}: id ${json.id} vs ${sql.id}, status '${json.status}' vs '${sql.status}'`);
    }
  }
  console.log(`[diff-job:workorders] ${jsonRows.length} in JSON, ${sqlRes.rows.length} in SQL, ${missing} missing, ${mismatched} mismatches`);
  checkNumbering("workorders:json", jsonRows.map((w) => w.workOrderNo));
  checkNumbering("workorders:sql", sqlRes.rows.map((r) => r.work_order_no));
}

async function main() {
  console.log(`--- diff-job run at ${new Date().toISOString()} ---`);
  await diffCustomers();
  await diffQuotes();
  await diffWorkOrders();
  console.log("--- diff-job done ---");
  await pool.end();
}

main().catch((e) => {
  console.error("diff-job failed:", e.message);
  process.exit(1);
});
