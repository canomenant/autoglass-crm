require("dotenv").config();
const path = require("path");
const pool = require("../src/config/db");

function normEmail(e) {
  return (e || "").trim().toLowerCase();
}

function normName(n) {
  return (n || "").trim().toLowerCase();
}

async function main() {
  const colRes = await pool.query(
    "SELECT data_type FROM information_schema.columns WHERE table_name = 'payouts' AND column_name = 'technician_id'"
  );
  const currentType = colRes.rows[0] && colRes.rows[0].data_type;
  console.log(`payouts.technician_id current type: ${currentType}`);

  if (currentType === "uuid") {
    console.log("Already migrated to UUID — nothing to do.");
    const check = await pool.query("SELECT COUNT(*) AS total, COUNT(technician_id) AS with_tech FROM payouts");
    console.log("Current state:", JSON.stringify(check.rows[0]));
    await pool.end();
    return;
  }

  // Capture the legacy integer values before the column type changes out from under us.
  const legacyRes = await pool.query("SELECT id, technician_id FROM payouts WHERE technician_id IS NOT NULL");
  console.log(`Found ${legacyRes.rows.length} payouts with a legacy integer technician_id.`);

  // technicians.json still has the old integer ids (1-16); technicians.store.js's SQL rows
  // (Fase 4 step 1) were matched onto those by email. Reuse the same email-first, name-fallback
  // crosswalk here: legacy int id -> JSON technician -> email/name -> SQL technicians.id (UUID).
  const jsonTechs = require(path.join(__dirname, "..", "data", "technicians.json"));
  const sqlTechRes = await pool.query("SELECT id, name, email FROM technicians");
  const byEmail = new Map(sqlTechRes.rows.map((r) => [normEmail(r.email), r]));
  const byName = new Map(sqlTechRes.rows.map((r) => [normName(r.name), r]));

  const resolved = [];
  const unresolved = [];
  for (const row of legacyRes.rows) {
    const jsonTech = jsonTechs.find((t) => t.id === row.technician_id);
    if (!jsonTech) {
      unresolved.push({ payoutId: row.id, legacyTechnicianId: row.technician_id, reason: "no matching JSON technician" });
      continue;
    }
    let sqlTech = jsonTech.email ? byEmail.get(normEmail(jsonTech.email)) : null;
    if (!sqlTech) sqlTech = byName.get(normName(jsonTech.name));
    if (!sqlTech) {
      unresolved.push({ payoutId: row.id, legacyTechnicianId: row.technician_id, reason: `no SQL technician match for "${jsonTech.name}"` });
      continue;
    }
    resolved.push({ payoutId: row.id, technicianUuid: sqlTech.id, name: jsonTech.name });
  }

  console.log(`Resolved ${resolved.length}/${legacyRes.rows.length} to a technician UUID.`);
  if (unresolved.length) console.log("Unresolved:", JSON.stringify(unresolved));

  await pool.query("ALTER TABLE payouts DROP COLUMN technician_id");
  await pool.query("ALTER TABLE payouts ADD COLUMN technician_id UUID");
  console.log("Converted payouts.technician_id column from INTEGER to UUID.");

  for (const { payoutId, technicianUuid, name } of resolved) {
    await pool.query("UPDATE payouts SET technician_id = $1 WHERE id = $2", [technicianUuid, payoutId]);
    console.log(`✓ payout ${payoutId} -> ${name} (${technicianUuid})`);
  }

  const check = await pool.query("SELECT COUNT(*) AS total, COUNT(technician_id) AS with_tech FROM payouts");
  console.log("\nFinal state:", JSON.stringify(check.rows[0]));

  await pool.end();
}

main().catch((e) => {
  console.error("migrate-payout-ids failed:", e.message);
  process.exit(1);
});
