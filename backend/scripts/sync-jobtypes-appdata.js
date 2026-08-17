require("dotenv").config();
const pool = require("../src/config/db");

// app_data.jobTypes.json is the source of truth on every boot (persistence.js's loadOrSeed
// checks the Postgres cache before ever touching the local file), but nothing in the running
// app writes back to app_data — the local-file backfill added for is_taxable never reached it.
// One-off sync, same pattern as populate-appdata.js: read the current row, backfill is_taxable
// by the same rule the app uses (Parts/Molding -> true, Services -> false), write it back.
async function main() {
  const r = await pool.query("SELECT value FROM app_data WHERE key = 'jobTypes.json'");
  if (!r.rows.length) {
    console.log("No app_data row for jobTypes.json — nothing to sync.");
    await pool.end();
    return;
  }

  const items = r.rows[0].value;
  let changed = 0;
  const updated = items.map((item) => {
    if (item.isTaxable !== undefined) return item;
    changed += 1;
    return { ...item, isTaxable: item.type !== "Services" };
  });

  if (changed === 0) {
    console.log("app_data.jobTypes.json already has isTaxable on every row — nothing to do.");
    await pool.end();
    return;
  }

  await pool.query(
    `UPDATE app_data SET value = $1, updated_at = now() WHERE key = 'jobTypes.json'`,
    [JSON.stringify(updated)]
  );
  console.log(`Backfilled isTaxable on ${changed} of ${items.length} rows in app_data.jobTypes.json.`);
  await pool.end();
}

main().catch((e) => {
  console.error("sync-jobtypes-appdata failed:", e.message);
  process.exit(1);
});
