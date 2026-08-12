require("dotenv").config();
const pool = require("../src/config/db");

// Criterion: within a duplicate zipcode group, prefer the row with the higher tax (a 0%
// rate on an otherwise-taxed zip is almost certainly a data gap from the original import,
// not a legitimate rate) — tie-broken by a properly formatted 2-letter uppercase state code
// over anything else (e.g. "Tx" or "Harris County" spillover). Final tiebreak is just id,
// for a deterministic pick when rows are otherwise identical (the common case: 45 of 47
// groups are byte-for-byte identical across every field, so this tiebreak rarely matters).
//
// A tax >= 1 is caught first and never allowed to win on "higher tax" alone — it's a
// data-format error (percentage entered without converting to a decimal fraction, e.g. 9.75
// meaning "9.75%" stored as-is), not a legitimately higher rate. Found the hard way: an
// earlier version of this script picked tax=9.75 over the correct tax=0.095 for zipcode
// 91316 because 9.75 > 0.095 numerically; fixed by hand afterward, this guard prevents it
// from happening again on a future run against different data.
function pickKeeper(rows) {
  const isSaneTax = (r) => Number(r.tax) < 1;
  const sorted = [...rows].sort((a, b) => {
    const aSane = isSaneTax(a) ? 1 : 0;
    const bSane = isSaneTax(b) ? 1 : 0;
    if (aSane !== bSane) return bSane - aSane;
    const taxDiff = Number(b.tax) - Number(a.tax);
    if (taxDiff !== 0) return taxDiff;
    const aStateOk = /^[A-Z]{2}$/.test(a.state || "") ? 1 : 0;
    const bStateOk = /^[A-Z]{2}$/.test(b.state || "") ? 1 : 0;
    if (aStateOk !== bStateOk) return bStateOk - aStateOk;
    return String(a.id).localeCompare(String(b.id));
  });
  return sorted[0];
}

async function main() {
  const groups = await pool.query(
    "SELECT zipcode FROM zip_codes GROUP BY zipcode HAVING COUNT(*) > 1 ORDER BY zipcode"
  );
  console.log(`Found ${groups.rows.length} duplicate zipcode groups.`);

  let totalDeleted = 0;
  let conflictGroups = 0;

  for (const { zipcode } of groups.rows) {
    const rows = (await pool.query("SELECT * FROM zip_codes WHERE zipcode = $1", [zipcode])).rows;
    const keeper = pickKeeper(rows);
    const toDelete = rows.filter((r) => r.id !== keeper.id);

    const isIdentical = rows.every(
      (r) => r.city === keeper.city && r.county === keeper.county && r.state === keeper.state && Number(r.tax) === Number(keeper.tax)
    );
    if (!isIdentical) {
      conflictGroups++;
      console.log(`\nConflict for zipcode ${zipcode}:`);
      console.log("  KEEPING:", JSON.stringify({ id: keeper.id, city: keeper.city, county: keeper.county, state: keeper.state, tax: keeper.tax }));
      for (const r of toDelete) {
        console.log("  dropping:", JSON.stringify({ id: r.id, city: r.city, county: r.county, state: r.state, tax: r.tax }));
      }
    }

    for (const r of toDelete) {
      await pool.query("DELETE FROM zip_codes WHERE id = $1", [r.id]);
      totalDeleted++;
    }
  }

  console.log(`\nDone — ${totalDeleted} duplicate rows deleted across ${groups.rows.length} groups (${conflictGroups} had real conflicts, ${groups.rows.length - conflictGroups} were identical duplicates).`);

  const check = await pool.query("SELECT COUNT(*) AS count FROM zip_codes");
  console.log("Final zip_codes row count:", check.rows[0].count);

  await pool.end();
}

main().catch((e) => {
  console.error("dedupe-zipcodes failed:", e.message);
  process.exit(1);
});
