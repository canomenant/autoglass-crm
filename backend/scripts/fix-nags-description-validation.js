require("dotenv").config();
const pool = require("../src/config/db");

// Common NAGS-text abbreviations for makes that don't spell themselves out in full — found by
// inspecting real mismatches (e.g. "18-23 Chevy Traverse" for a Chevrolet, "11-14 VW Jetta"
// for a Volkswagen). Deliberately conservative: a make/model NAGS text style we haven't seen
// evidence of (e.g. "Silverado" implying Chevrolet without saying so) still blanks out — per
// instruction, a false negative (blanked but was actually fine) is preferable to a false
// positive (a description naming the wrong vehicle).
const ALIASES = {
  chevrolet: ["chevy", "chev"],
  volkswagen: ["vw"],
  "mercedes-benz": ["mercedes", "mb", "benz"],
  gmc: ["gm"],
  ram: ["dodge ram", "dodge"],
  "land rover": ["range rover", "landrover"],
};

function makeMatches(nagsDescription, vehicleMake) {
  const desc = nagsDescription.toLowerCase();
  const make = vehicleMake.trim().toLowerCase();
  if (!make) return false;
  if (desc.includes(make)) return true;
  return (ALIASES[make] || []).some((alias) => desc.includes(alias));
}

async function main() {
  console.log("Rebuilding NAGS lookup, excluding empty/blank name_part_number rows...");
  const catalog = await pool.query(
    "SELECT name_part_number, nags_description FROM cat_part_number WHERE nags_description IS NOT NULL AND nags_description != '' AND nags_description != 'NULL' AND name_part_number IS NOT NULL AND TRIM(name_part_number) != ''"
  );
  const nagsMap = new Map();
  for (const row of catalog.rows) {
    if (!nagsMap.has(row.name_part_number)) nagsMap.set(row.name_part_number, row.nags_description);
  }
  console.log(`Loaded ${nagsMap.size} usable part number -> NAGS description entries.`);

  const rows = await pool.query(
    "SELECT id, vehicle_make, line_items FROM quotes WHERE jsonb_array_length(line_items) > 0"
  );
  console.log(`Checking ${rows.rows.length} quotes with line items...`);

  let totalLines = 0;
  let clearedEmptyKeyBug = 0;
  let clearedMakeMismatch = 0;
  let keptValidated = 0;
  let quotesUpdated = 0;

  for (const q of rows.rows) {
    let changed = false;
    const fixed = q.line_items.map((li) => {
      if (!li.nagsDescription) return li;
      totalLines++;

      // Placeholder text (nagsDescription === partNumber, e.g. "Dealer Part") makes no vehicle
      // claim at all — nothing to validate, leave as-is.
      if (li.nagsDescription === li.partNumber) {
        keptValidated++;
        return li;
      }

      if (!li.partNumber) {
        // Bug from the original backfill: an empty partNumber matched the one blank-key
        // catalog row. Recompute from the clean map (which excludes blank keys) — will
        // always resolve to nothing.
        changed = true;
        clearedEmptyKeyBug++;
        return { ...li, nagsDescription: "" };
      }

      const canonical = nagsMap.get(li.partNumber) || "";
      if (!canonical) {
        // No longer resolves at all under the cleaned map (shouldn't happen often, but if the
        // stored description doesn't match a real catalog entry anymore, don't keep stale text).
        if (li.nagsDescription) {
          changed = true;
          clearedMakeMismatch++;
          return { ...li, nagsDescription: "" };
        }
        return li;
      }

      if (!makeMatches(canonical, q.vehicle_make || "")) {
        changed = true;
        clearedMakeMismatch++;
        return { ...li, nagsDescription: "" };
      }

      if (li.nagsDescription !== canonical) changed = true;
      keptValidated++;
      return { ...li, nagsDescription: canonical };
    });

    if (changed) {
      await pool.query("UPDATE quotes SET line_items = $1, updated_at = now() WHERE id = $2", [
        JSON.stringify(fixed),
        q.id,
      ]);
      quotesUpdated++;
    }
  }

  console.log("\n=== Results ===");
  console.log(`Total lines with a nagsDescription before this fix: ${totalLines}`);
  console.log(`Cleared — empty partNumber bug: ${clearedEmptyKeyBug}`);
  console.log(`Cleared — make validation (name/alias not found): ${clearedMakeMismatch}`);
  console.log(`Kept (validated match or placeholder text): ${keptValidated}`);
  console.log(`Quotes updated: ${quotesUpdated}`);

  await pool.end();
}

main().catch((e) => {
  console.error("fix-nags-description-validation failed:", e.message);
  process.exit(1);
});
