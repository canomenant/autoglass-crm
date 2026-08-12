require("dotenv").config();
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const pool = require("../src/config/db");

function normEmail(e) {
  return (e || "").trim().toLowerCase();
}

function normName(n) {
  return (n || "").trim().toLowerCase();
}

async function main() {
  const jsonPath = path.join(__dirname, "..", "data", "technicians.json");
  const jsonTechs = JSON.parse(fs.readFileSync(jsonPath, "utf-8"));

  const missingEmail = jsonTechs.filter((t) => !t.email);
  console.log(`Read ${jsonTechs.length} technicians from technicians.json (${missingEmail.length} missing email).`);

  await pool.query("ALTER TABLE technicians ADD COLUMN IF NOT EXISTS password TEXT");
  console.log("Ensured technicians.password column exists.");

  const sqlRes = await pool.query("SELECT id, name, email FROM technicians");
  const byEmail = new Map(sqlRes.rows.map((r) => [normEmail(r.email), r]));
  const byName = new Map(sqlRes.rows.map((r) => [normName(r.name), r]));

  let updated = 0;
  let inserted = 0;
  const unmatched = [];

  for (const t of jsonTechs) {
    let sqlRow = t.email ? byEmail.get(normEmail(t.email)) : null;
    let matchedBy = sqlRow ? "email" : null;

    if (!sqlRow) {
      sqlRow = byName.get(normName(t.name));
      matchedBy = sqlRow ? "name" : null;
    }

    if (sqlRow) {
      await pool.query("UPDATE technicians SET password = $1 WHERE id = $2", [t.password || "", sqlRow.id]);
      updated++;
      console.log(`✓ updated (matched by ${matchedBy}): ${t.name}`);
    } else {
      const id = crypto.randomUUID();
      await pool.query(
        `INSERT INTO technicians (id, name, company_name, phone, mobile, email, address, city, state, zip_code,
           status, default_labor_rate, default_commission, active, password)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
        [
          id, t.name || "", t.companyName || "", t.phone || "", t.mobile || "", t.email || "", t.address || "",
          t.city || "", t.state || "", t.zipCode || "", t.status || "Active", t.defaultLaborRate || 0,
          t.defaultCommission || 0, t.active !== false, t.password || "",
        ]
      );
      inserted++;
      unmatched.push(t.name);
      console.log(`✓ inserted (no match in SQL): ${t.name}`);
    }
  }

  console.log(`\nDone — ${updated} updated, ${inserted} inserted.`);
  if (unmatched.length) console.log("Newly inserted (were missing from SQL entirely):", unmatched.join(", "));

  const check = await pool.query("SELECT COUNT(*) AS total, COUNT(*) FILTER (WHERE password IS NOT NULL AND password <> '') AS with_password FROM technicians");
  console.log("Final state:", JSON.stringify(check.rows[0]));

  await pool.end();
}

main().catch((e) => {
  console.error("add-technician-password failed:", e.message);
  process.exit(1);
});
