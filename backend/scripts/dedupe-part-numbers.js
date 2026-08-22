// Deduplicates the part-number catalog in app_data.
//
//   cd backend && node scripts/dedupe-part-numbers.js          # dry run, writes the reports
//   cd backend && node scripts/dedupe-part-numbers.js --apply  # actually rewrites app_data
//
// Safe to delete rows because nothing references the catalog by id: quote line items store
// partNumber/nagsDescription as plain text (quotes.store.js#normalizeLineItems whitelists the
// keys and none of them is a catalog id) and work_orders.part_number is text as well. The
// dropdowns address entries by id, but they resolve that id from the stored text at render time,
// so a surviving row in the same group answers for the ones removed.
//
// Keep rule, in order:
//   1. an entry with addedBy wins — somebody added it by hand, it is the most current
//   2. otherwise the longest usable NAGS description wins ("", "NULL" and "NULO" are not usable)
//   3. ties break to the lowest id, i.e. the longest-standing row
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const pool = require("../src/config/db");

const APPLY = process.argv.includes("--apply");
const OUT_DIR = path.join(__dirname);

// Same rule the duplicate report was built with. Deliberately NOT the stricter squash used by
// partNumbers.store.js#normalizePartNumber: this decides what gets DELETED, so it is the
// conservative of the two. The gap is reported rather than acted on.
// Held back from the cleanup: in these three the members describe different vehicles, and the
// keep rule would silently commit to one of them. A single NAGS number legitimately covering
// several models is normal — but the catalog's own convention for that is ONE entry listing them
// with "|" (508 entries do exactly that), not two rows. So either these should be merged into one
// entry or they are genuinely different parts that collided; both need Mygrant to say which.
// Until then they keep both rows.
const HELD_GROUPS = new Set([
  "dd11927 gtn", // Chevy Silverado 99-03  /  Dodge Charger 11-23
  "fd26096 gtn", // Mercedes C-Class 15-21 /  Audi Q3 13-18
  "fw02500 gbn", // Toyota Tacoma 05-11    /  Subaru Forester 14-18
]);

function groupKey(value) {
  return String(value || "").trim().toLowerCase();
}

function isUsableDescription(value) {
  const text = String(value || "").trim();
  const upper = text.toUpperCase();
  return !!text && upper !== "NULL" && upper !== "NULO";
}

function descriptionOf(entry) {
  return String(entry.nagsDescription || "").trim();
}

// Returns [keeper, ...toDelete] for one group.
function rank(entries) {
  return [...entries].sort((a, b) => {
    const aManual = !!a.addedBy;
    const bManual = !!b.addedBy;
    if (aManual !== bManual) return aManual ? -1 : 1;

    const aDesc = isUsableDescription(a.nagsDescription) ? descriptionOf(a).length : -1;
    const bDesc = isUsableDescription(b.nagsDescription) ? descriptionOf(b).length : -1;
    if (aDesc !== bDesc) return bDesc - aDesc;

    return Number(a.id) - Number(b.id);
  });
}

(async () => {
  const catalog = (await pool.query("SELECT value FROM app_data WHERE key='partNumbers.json'")).rows[0].value;
  console.log(`catalogo: ${catalog.length} entradas\n`);

  const groups = new Map();
  for (const entry of catalog) {
    const key = groupKey(entry.partNumber);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(entry);
  }

  const duplicated = [...groups.entries()].filter(([, entries]) => entries.length > 1);

  const plan = [];
  const held = [];
  for (const [key, entries] of duplicated) {
    if (HELD_GROUPS.has(key)) {
      held.push({ normalized: key, entries });
      continue;
    }
    const distinctDescriptions = new Set(entries.map(descriptionOf));
    const [keeper, ...removed] = rank(entries);
    plan.push({
      normalized: key,
      conflicting: distinctDescriptions.size > 1,
      keeper,
      removed,
      // The raw spellings in this group; if they differ, one of them stops existing in the catalog.
      spellings: [...new Set(entries.map((e) => e.partNumber))],
    });
  }

  const identical = plan.filter((g) => !g.conflicting);
  const conflicting = plan.filter((g) => g.conflicting);
  const toDelete = plan.flatMap((g) => g.removed);
  const deleteIds = new Set(toDelete.map((e) => String(e.id)));

  console.log("=== PLAN ===");
  console.log(`  grupos retenidos sin tocar   : ${held.length}  (${held.reduce((s, g) => s + g.entries.length, 0)} filas conservadas)`);
  for (const g of held) console.log(`      ${g.normalized} — ${g.entries.length} entradas, ambas se conservan`);
  console.log(`  grupos a limpiar             : ${plan.length}`);
  console.log(`    identicos (sin conflicto)  : ${identical.length}`);
  console.log(`    con descripciones distintas: ${conflicting.length}`);
  console.log(`  entradas a eliminar          : ${toDelete.length}`);
  console.log(`  conteo final esperado        : ${catalog.length} -> ${catalog.length - toDelete.length}`);

  const manualKeepers = plan.filter((g) => g.keeper.addedBy).length;
  const rescued = conflicting.filter((g) => !isUsableDescription(g.keeper.nagsDescription)).length;
  console.log(`\n  grupos donde gano un alta manual (addedBy): ${manualKeepers}`);
  console.log(`  grupos en conflicto SIN ninguna descripcion usable: ${rescued}`);

  // Groups whose raw spelling is not uniform: one of the written forms disappears from the catalog.
  const spellingLoss = plan.filter((g) => g.spellings.length > 1);
  console.log(`  grupos con distinta grafia entre miembros: ${spellingLoss.length}`);

  // --- VALIDATION -----------------------------------------------------------
  // Nothing may end up pointing at a deleted entry. References are by text, so the question is
  // whether every line item's stored part number still resolves to a surviving catalog row.
  const survivors = new Set();
  for (const [key, entries] of groups) {
    if (entries.length === 1) survivors.add(key);
  }
  for (const g of plan) survivors.add(groupKey(g.keeper.partNumber));
  // Held groups keep every row they have, so their part numbers survive in full. Without this
  // they looked orphaned purely because they are not in `plan`, and the guard aborted on 14
  // perfectly healthy line items.
  for (const g of held) survivors.add(g.normalized);

  const quotes = await pool.query(
    "SELECT quote_no, line_items FROM quotes WHERE active <> false AND line_items IS NOT NULL"
  );
  let lineItems = 0;
  let withPart = 0;
  let touchingDeleted = 0;
  let orphaned = [];
  for (const row of quotes.rows) {
    for (const li of row.line_items || []) {
      lineItems++;
      const key = groupKey(li.partNumber);
      if (!key) continue;
      withPart++;
      // Does this line item's part number live in a group we are trimming?
      if (groups.get(key)?.some((e) => deleteIds.has(String(e.id)))) touchingDeleted++;
      if (!survivors.has(key) && groups.has(key)) orphaned.push({ quote: row.quote_no, partNumber: li.partNumber });
    }
  }

  console.log("\n=== VALIDACION ===");
  console.log(`  line items totales                          : ${lineItems}`);
  console.log(`  con part number cargado                     : ${withPart}`);
  console.log(`  que apuntan a un grupo que se va a recortar : ${touchingDeleted}`);
  console.log(`  que quedarian SIN entrada sobreviviente     : ${orphaned.length}`);
  if (orphaned.length) {
    console.log("\n  !!! HUERFANOS — no se aplica nada:");
    console.log("  " + JSON.stringify(orphaned.slice(0, 10), null, 2));
  }

  // --- REPORTS --------------------------------------------------------------
  const dryRun = {
    generatedAt: new Date().toISOString(),
    catalogBefore: catalog.length,
    catalogAfter: catalog.length - toDelete.length,
    duplicateGroups: plan.length,
    identicalGroups: identical.length,
    conflictingGroups: conflicting.length,
    entriesRemoved: toDelete.length,
    groups: plan.map((g) => ({
      normalized: g.normalized,
      conflicting: g.conflicting,
      spellings: g.spellings,
      keep: { id: g.keeper.id, partNumber: g.keeper.partNumber, nagsDescription: g.keeper.nagsDescription, notes: g.keeper.notes, addedBy: g.keeper.addedBy },
      delete: g.removed.map((e) => ({ id: e.id, partNumber: e.partNumber, nagsDescription: e.nagsDescription, notes: e.notes })),
    })),
  };
  fs.writeFileSync(path.join(OUT_DIR, "dedupe-part-numbers-dryrun.json"), JSON.stringify(dryRun, null, 2));

  const conflictReport = {
    generatedAt: new Date().toISOString(),
    note: "Descripciones lado a lado para los grupos donde los miembros no coinciden. 'keep' es lo que el criterio elige; revisar si alguna descripcion descartada era la correcta.",
    groups: conflicting.length,
    rows: conflicting.map((g) => ({
      partNumber: g.keeper.partNumber,
      keepDescription: descriptionOf(g.keeper) || "(vacia)",
      discardedDescriptions: g.removed.map((e) => descriptionOf(e) || "(vacia)"),
    })),
  };
  fs.writeFileSync(path.join(OUT_DIR, "dedupe-part-numbers-conflicts.json"), JSON.stringify(conflictReport, null, 2));

  console.log("\n=== EJEMPLOS DE CONFLICTO (primeros 5) ===");
  for (const row of conflictReport.rows.slice(0, 5)) {
    console.log(`\n  ${row.partNumber}`);
    console.log(`    CONSERVA : ${row.keepDescription.slice(0, 88)}`);
    for (const d of row.discardedDescriptions) console.log(`    descarta : ${d.slice(0, 88)}`);
  }

  console.log("\nreportes escritos:");
  console.log("  scripts/dedupe-part-numbers-dryrun.json");
  console.log("  scripts/dedupe-part-numbers-conflicts.json");

  if (!APPLY) {
    console.log("\nDRY RUN — no se modifico nada. Usar --apply para escribir.");
    await pool.end();
    return;
  }

  if (orphaned.length) {
    console.log("\nABORTADO: hay line items que quedarian huerfanos.");
    await pool.end();
    process.exit(1);
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const snapshot = path.join(OUT_DIR, `dedupe-part-numbers-backup-${stamp}.json`);
  fs.writeFileSync(snapshot, JSON.stringify(catalog, null, 2));
  console.log(`\nrespaldo del catalogo completo: scripts/${path.basename(snapshot)}`);

  const kept = catalog.filter((e) => !deleteIds.has(String(e.id)));
  await pool.query(
    "UPDATE app_data SET value = $2::jsonb, updated_at = now() WHERE key = $1",
    ["partNumbers.json", JSON.stringify(kept)]
  );
  const after = (await pool.query("SELECT jsonb_array_length(value) n FROM app_data WHERE key='partNumbers.json'")).rows[0].n;
  console.log(`\nAPLICADO: ${catalog.length} -> ${after}`);
  await pool.end();
})();
