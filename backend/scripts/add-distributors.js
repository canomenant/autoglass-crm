require("dotenv").config();
const fs = require("fs");
const path = require("path");
const pool = require("../src/config/db");

// distributors.store.js is JSON-only (never migrated to SQL) — loadOrSeed() prioritizes
// app_data over the local file, so both must be updated in lockstep or a server restart
// silently reverts this via the stale app_data cache (same bug class fixed for zip codes
// and payment methods).
const NEW_DISTRIBUTORS = ["Mygrant San Antonio", "Mygrant San Fernando", "Pilkington Houston", "Vitro", "Tech Part"];

async function main() {
  const jsonPath = path.join(__dirname, "..", "data", "distributors.json");
  const items = JSON.parse(fs.readFileSync(jsonPath, "utf-8"));

  let nextId = items.reduce((max, i) => Math.max(max, Number(i.id) || 0), 0) + 1;
  const added = [];
  const now = new Date().toISOString();
  for (const name of NEW_DISTRIBUTORS) {
    if (items.some((i) => i.name === name)) {
      console.log(`"${name}" already exists, skipping.`);
      continue;
    }
    const item = {
      id: nextId, name, contactName: "", phone: "", mobile: "", email: "", address: "", city: "",
      state: "", zipCode: "", website: "", accountNumber: "", paymentTerms: "", taxId: "", notes: "",
      logo: null, status: "Active", active: true, deletedAt: null, createdAt: now, updatedAt: now,
    };
    items.push(item);
    added.push(item);
    nextId += 1;
  }

  fs.writeFileSync(jsonPath, JSON.stringify(items, null, 2), "utf-8");
  console.log(`Local file updated: ${added.length} added.`, JSON.stringify(added.map((a) => a.name)));

  await pool.query(
    `INSERT INTO app_data (key, value, updated_at) VALUES ('distributors.json', $1, now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [JSON.stringify(items)]
  );
  console.log("app_data cache updated to match.");

  await pool.end();
}

main().catch((e) => {
  console.error("add-distributors failed:", e.message);
  process.exit(1);
});
