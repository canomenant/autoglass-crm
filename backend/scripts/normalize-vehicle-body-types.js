// Rewrites the vehicle catalog so bodyType holds the 10-value taxonomy and the trim string it was
// built from moves to trimDescription.
//
//   cd backend && node scripts/normalize-vehicle-body-types.js          # dry run + report
//   cd backend && node scripts/normalize-vehicle-body-types.js --apply  # rewrites app_data
//
// This is a cleanup, not a prerequisite: vehicleTypes.store.js#effectiveBodyType already maps the
// raw trim on the fly, which is why the cascade works today against un-normalized data. What it
// buys is honest stored data and a duplicate guard that agrees with itself — the SQL guard inside
// appendToAppDataArray compares stored bodyType as text, so while the catalog holds "LE Sedan
// 4-Door" it cannot see that an incoming "Sedan" is the same vehicle. The store compensates with a
// JS pre-check; after this runs, both sides agree without help.
//
// Rows are preserved, not collapsed. Five Camry rows (LE/LEV/SE/XLE/XSE) all normalize to Sedan
// and stay five rows with distinct trimDescriptions, because the trim is real information and the
// vehicle-to-glass mapping this business is heading toward will want it. The dropdown dedupes on
// read, so the redundancy is invisible there.
//
// AFTER APPLYING, RESTART THE BACKEND. loadOrSeed() hands the store the cached array by reference,
// so a running process keeps the pre-rewrite copy and the next catalog edit writes all of it back.
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const pool = require("../src/config/db");
const store = require("../src/store/vehicleTypes.store");

const APPLY = process.argv.includes("--apply");
const KEY = "vehicleTypes.json";

(async () => {
  const catalog = (await pool.query("SELECT value FROM app_data WHERE key=$1", [KEY])).rows[0].value;
  console.log(`catalogo: ${catalog.length} entradas\n`);

  const alreadyDone = catalog.filter((e) => e.trimDescription !== undefined).length;
  if (alreadyDone) console.log(`  aviso: ${alreadyDone} entradas ya tienen trimDescription\n`);

  const counts = new Map();
  let mapped = 0;
  let unmapped = 0;
  const unmappedSamples = new Map();

  const next = catalog.map((entry) => {
    const raw = String(entry.bodyType || "").trim();
    // Already-normalized rows keep their value; the trim they came from is whatever is already in
    // trimDescription, so re-running this is a no-op rather than a data shredder.
    const normalized = store.BODY_TYPES.includes(raw) ? raw : store.normalizeBodyType(raw);

    if (normalized) {
      mapped++;
      counts.set(normalized, (counts.get(normalized) || 0) + 1);
    } else if (raw) {
      unmapped++;
      unmappedSamples.set(raw, (unmappedSamples.get(raw) || 0) + 1);
    }

    return {
      ...entry,
      bodyType: normalized,
      // Never overwrite a trim already recorded, and never lose the raw string: when it did not
      // map, this is the only place it survives.
      trimDescription: entry.trimDescription ?? (store.BODY_TYPES.includes(raw) ? "" : raw),
    };
  });

  console.log("=== distribucion resultante ===");
  for (const [type, n] of [...counts.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${type.padEnd(12)} ${String(n).padStart(6)}`);
  }
  console.log(`  ${"(sin mapear)".padEnd(12)} ${String(unmapped).padStart(6)}   -> bodyType queda vacio, el trim se conserva`);
  console.log(`\n  mapeadas: ${mapped} de ${catalog.length} (${((mapped / catalog.length) * 100).toFixed(1)}%)`);

  console.log("\n=== los que no mapean, mas frecuentes ===");
  for (const [value, n] of [...unmappedSamples.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8)) {
    console.log(`  ${String(n).padStart(5)}  ${value.slice(0, 70)}`);
  }

  // Consequence worth seeing before applying: normalization makes many rows share a
  // (year, make, model, bodyType) tuple. Harmless for the dropdown, which dedupes on read, and it
  // is what lets the duplicate guard recognise "2025 Toyota Camry Sedan" as already present.
  const tuples = new Set();
  for (const e of next) tuples.add(`${e.year}|${e.make}|${e.model}|${e.bodyType}`.toLowerCase());
  console.log(`\n  filas: ${next.length}   combinaciones distintas anio+marca+modelo+carroceria: ${tuples.size}`);

  console.log("\n=== muestra del cambio ===");
  const samples = catalog
    .map((e, i) => ({ before: e, after: next[i] }))
    .filter((p) => /camry|odyssey|f-150|tacoma/i.test(p.before.model))
    .slice(0, 5);
  for (const { before, after } of samples) {
    console.log(`  ${before.year} ${before.make} ${before.model}`);
    console.log(`     antes : bodyType="${before.bodyType}"`);
    console.log(`     ahora : bodyType="${after.bodyType}"  trimDescription="${after.trimDescription}"`);
  }

  if (!APPLY) {
    console.log("\nDRY RUN — no se modifico nada. Usar --apply para escribir.");
    await pool.end();
    return;
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backup = path.join(__dirname, `normalize-vehicle-body-types-backup-${stamp}.json`);
  fs.writeFileSync(backup, JSON.stringify(catalog, null, 2));
  console.log(`\nrespaldo del catalogo completo: scripts/${path.basename(backup)}`);

  await pool.query("UPDATE app_data SET value = $2::jsonb, updated_at = now() WHERE key = $1", [KEY, JSON.stringify(next)]);
  const after = (await pool.query("SELECT jsonb_array_length(value) n FROM app_data WHERE key=$1", [KEY])).rows[0].n;
  console.log(`APLICADO: ${catalog.length} -> ${after} entradas (mismo conteo, filas reescritas)`);
  console.log("\nREINICIAR EL BACKEND: el proceso en curso todavia tiene la copia vieja en memoria.");
  await pool.end();
})();
