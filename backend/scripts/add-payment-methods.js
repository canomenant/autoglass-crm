require("dotenv").config();
const fs = require("fs");
const path = require("path");
const pool = require("../src/config/db");

// paymentMethods.store.js is JSON-only (never migrated to SQL) — loadOrSeed() prioritizes
// app_data over the local file, so both must be updated in lockstep or a server restart
// silently reverts this via the stale app_data cache (same bug class fixed for zip codes).
const NEW_METHODS = ["We Have CC In File", "Deposit"];

async function main() {
  const jsonPath = path.join(__dirname, "..", "data", "paymentMethods.json");
  const items = JSON.parse(fs.readFileSync(jsonPath, "utf-8"));

  let nextId = items.reduce((max, i) => Math.max(max, Number(i.id) || 0), 0) + 1;
  const added = [];
  for (const name of NEW_METHODS) {
    if (items.some((i) => i.name === name)) {
      console.log(`"${name}" already exists, skipping.`);
      continue;
    }
    const item = { id: nextId, name };
    items.push(item);
    added.push(item);
    nextId += 1;
  }

  fs.writeFileSync(jsonPath, JSON.stringify(items, null, 2), "utf-8");
  console.log(`Local file updated: ${added.length} added.`, JSON.stringify(added));

  await pool.query(
    `INSERT INTO app_data (key, value, updated_at) VALUES ('paymentMethods.json', $1, now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [JSON.stringify(items)]
  );
  console.log("app_data cache updated to match.");

  await pool.end();
}

main().catch((e) => {
  console.error("add-payment-methods failed:", e.message);
  process.exit(1);
});
