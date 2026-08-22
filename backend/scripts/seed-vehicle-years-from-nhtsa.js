// Seeds year/make/model into the vehicle catalog for model years the local catalog barely has.
//
//   cd backend && node scripts/seed-vehicle-years-from-nhtsa.js --fetch   # phase 1: ask NHTSA, dump raw
//   cd backend && node scripts/seed-vehicle-years-from-nhtsa.js           # status + what phase 2 would add
//   cd backend && node scripts/seed-vehicle-years-from-nhtsa.js --apply   # phase 2: write to the catalog
//
// Why this exists: cat_vehicle, the original import source, has exactly the same 22 rows for 2026
// as the catalog does and adds zero combinations for 2024-2025, so there is no backfill to be had
// from it. NHTSA does have the data — 24 Toyota models for 2026 against 18 in the whole catalog.
//
// Why two phases: the fetch is ~1,170 requests and the raw answers are written to disk before
// anything touches the catalog. If phase 2 goes wrong, or the rule for turning models into entries
// changes, phase 1 never has to run again. The dump doubles as the checkpoint — an interrupted
// fetch resumes by skipping makes already in it.
//
// vPIC ignores the year on GetMakesForVehicleType, which is why the year->make link cannot come
// from it directly. It does honour the year on GetModelsForMakeIdYear, so asking every make for
// its models in a given year and keeping the ones that answer reconstructs that link.
//
// Seeded rows carry no body type: NHTSA's model listing has none. The cascade answers those with
// the same model's body types from other years, or the full taxonomy — see
// vehicleTypes.store.js#bodyTypes. VIN decodes fill them in over time.
//
// AFTER APPLYING, RESTART THE BACKEND — the running process holds the pre-write catalog by
// reference and would write it back on the next catalog edit.
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const pool = require("../src/config/db");

const YEARS = [2025, 2026];
const VEHICLE_TYPES = ["car", "truck", "mpv"];
const VPIC = "https://vpic.nhtsa.dot.gov/api/vehicles";
const KEY = "vehicleTypes.json";

// Measured before choosing: 24 back-to-back requests all returned 200, median 196ms, no 429 and no
// throttling at 4.8 req/s. This pause is politeness rather than a documented requirement — it puts
// the full run around 6 minutes instead of 4.
const PAUSE_MS = Number(process.env.NHTSA_PAUSE_MS || 100);
const MAX_ATTEMPTS = 4;
const TIMEOUT_MS = 20000;

const FETCH = process.argv.includes("--fetch");
const APPLY = process.argv.includes("--apply");
const rawPath = (year) => path.join(__dirname, `nhtsa-raw-${year}.json`);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const clean = (v) => {
  const s = String(v ?? "").trim();
  return !s || s.toLowerCase() === "null" ? "" : s;
};
// Same character set the store and the SQL guard squash, so "what we already have" is decided the
// same way everywhere.
const normalize = (v) => String(v ?? "").toLowerCase().replace(/[ \t\r\n\-._/]+/g, "");

async function getJson(url) {
  let lastError = null;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
      // 429 and 5xx are worth waiting out; a 404 is an answer.
      if (res.status === 429 || res.status >= 500) throw new Error(`HTTP ${res.status}`);
      if (!res.ok) return null;
      return await res.json();
    } catch (err) {
      lastError = err;
      if (attempt < MAX_ATTEMPTS) await sleep(PAUSE_MS * 5 * attempt);
    }
  }
  throw lastError;
}

function loadDump(year) {
  const p = rawPath(year);
  if (!fs.existsSync(p)) return { year, fetchedAt: null, makes: {} };
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

function saveDump(year, dump) {
  dump.fetchedAt = new Date().toISOString();
  fs.writeFileSync(rawPath(year), JSON.stringify(dump, null, 2));
}

async function phaseFetch() {
  console.log("=== FASE 1: consulta a NHTSA ===");
  const makesBody = await getJson(`${VPIC}/GetMakesForVehicleType/car?format=json`);
  const byId = new Map();
  for (const m of makesBody?.Results || []) {
    const name = clean(m.MakeName);
    if (m.MakeId == null || !name || byId.has(m.MakeId)) continue;
    byId.set(m.MakeId, name);
  }
  const makes = [...byId.entries()].map(([id, name]) => ({ id, name }));
  console.log(`  ${makes.length} marcas a consultar, ${YEARS.length} anios, ${VEHICLE_TYPES.length} tipos`);
  console.log(`  ~${makes.length * YEARS.length * VEHICLE_TYPES.length} requests, pausa ${PAUSE_MS}ms\n`);

  for (const year of YEARS) {
    const dump = loadDump(year);
    const done = Object.keys(dump.makes).length;
    if (done) console.log(`  ${year}: retomando, ${done} marcas ya consultadas`);

    let processed = 0;
    for (const make of makes) {
      // The dump is the checkpoint: a make already in it is not asked again.
      if (dump.makes[make.name]) continue;

      const models = new Set();
      for (const vt of VEHICLE_TYPES) {
        const body = await getJson(
          `${VPIC}/GetModelsForMakeIdYear/makeId/${make.id}/modelyear/${year}/vehicletype/${vt}?format=json`
        );
        for (const row of body?.Results || []) {
          const model = clean(row.Model_Name);
          if (model) models.add(model);
        }
        await sleep(PAUSE_MS);
      }

      // Recorded even when empty — that is the answer "this make had no models this year", and it
      // is what stops a resume from asking again.
      dump.makes[make.name] = { makeId: make.id, models: [...models].sort() };
      processed++;
      // Written every make, not at the end: an interrupted run keeps everything it already paid for.
      saveDump(year, dump);
      if (processed % 25 === 0) console.log(`  ${year}: ${processed} marcas nuevas consultadas...`);
    }

    const total = Object.values(dump.makes).reduce((s, m) => s + m.models.length, 0);
    const withModels = Object.values(dump.makes).filter((m) => m.models.length).length;
    console.log(`  ${year}: listo — ${withModels} marcas con modelos, ${total} modelos, en scripts/${path.basename(rawPath(year))}`);
  }
}

async function buildPlan() {
  const catalog = (await pool.query("SELECT value FROM app_data WHERE key=$1", [KEY])).rows[0].value;
  // A model already in the catalog for that year is left alone whatever its body type — the point
  // is to add models that are missing, not an empty-bodied copy of one already there.
  const present = new Set(catalog.map((e) => `${Number(e.year)}|${normalize(e.make)}|${normalize(e.model)}`));

  // NHTSA writes makes in capitals ("TESLA", "ASTON MARTIN"); the catalog does not. 69 of the 72
  // overlapping makes are spelled differently. The cascade collapses them on read so the dropdown
  // never shows both, but the stored data would end up mixed, so the catalog's own spelling wins
  // wherever it has one. Makes it has never seen keep NHTSA's spelling as-is rather than being
  // title-cased into "Bmw".
  const catalogSpelling = new Map();
  for (const e of catalog) {
    const key = normalize(e.make);
    if (key && !catalogSpelling.has(key)) catalogSpelling.set(key, String(e.make).trim());
  }

  // Models the catalog already lists under a different name for the same year and make. Most are
  // legitimately distinct trims ("Prius" vs "Prius Prime (PHEV)", "540i" vs "540i xDrive"), but
  // some are the same car under two conventions — Tesla is "3"/"S"/"X"/"Y" in the catalog and
  // "Model 3"/"Model S"/... at NHTSA. Adding those blind would put both names in the dropdown, so
  // they are held out and written to a report instead of guessed at either way.
  const modelsByYearMake = new Map();
  for (const e of catalog) {
    const key = `${Number(e.year)}|${normalize(e.make)}`;
    if (!modelsByYearMake.has(key)) modelsByYearMake.set(key, new Set());
    modelsByYearMake.get(key).add(String(e.model).trim());
  }
  // Compared as word sets, not as substrings. Substring matching got both ends wrong: it flagged
  // "DBX" against "DBX707", which are different cars, while a length guard meant to suppress that
  // noise skipped Tesla entirely — the catalog calls them "3"/"S"/"X"/"Y" and one character never
  // cleared the guard. One name being all of the other's words plus more is the relationship worth
  // holding: "Model 3" over "3", "540i xDrive" over "540i", "Prius Prime (PHEV)" over "Prius".
  // "M235" and "M2" share no whole word, so they stay separate, which is correct.
  const words = (v) => new Set(String(v ?? "").toLowerCase().split(/[^a-z0-9]+/).filter(Boolean));
  const covers = (a, b) => b.size > 0 && a.size > b.size && [...b].every((w) => a.has(w));

  function nearMatch(year, makeName, model) {
    const existing = modelsByYearMake.get(`${year}|${normalize(makeName)}`);
    if (!existing) return null;
    const candidate = words(model);
    for (const known of existing) {
      const other = words(known);
      if (covers(candidate, other) || covers(other, candidate)) return known;
    }
    return null;
  }

  const additions = [];
  const held = [];
  const perYear = {};
  for (const year of YEARS) {
    const p = rawPath(year);
    if (!fs.existsSync(p)) {
      perYear[year] = { missing: true };
      continue;
    }
    const dump = loadDump(year);
    let added = 0;
    let skipped = 0;
    for (const [makeName, entry] of Object.entries(dump.makes)) {
      const make = catalogSpelling.get(normalize(makeName)) || makeName;
      for (const model of entry.models) {
        const key = `${year}|${normalize(makeName)}|${normalize(model)}`;
        if (present.has(key)) {
          skipped++;
          continue;
        }
        const similar = nearMatch(year, makeName, model);
        if (similar) {
          held.push({ year, make, nhtsaModel: model, catalogModel: similar });
          continue;
        }
        present.add(key); // guards against the same model arriving from two vehicle types
        additions.push({ year, make, model, bodyType: "", trimDescription: "" });
        added++;
      }
    }
    perYear[year] = { added, skipped, held: held.filter((h) => h.year === year).length, makes: Object.keys(dump.makes).length };
  }
  return { catalog, additions, held, perYear };
}

(async () => {
  if (FETCH) {
    await phaseFetch();
    console.log("\nFase 1 lista. Correr sin flags para ver que agregaria, o --apply para escribir.");
    await pool.end();
    return;
  }

  const { catalog, additions, held, perYear } = await buildPlan();
  console.log("=== FASE 2: que se agregaria al catalogo ===");
  console.log(`  catalogo actual: ${catalog.length} entradas\n`);
  for (const year of YEARS) {
    const s = perYear[year];
    if (s.missing) {
      console.log(`  ${year}: sin volcado — correr --fetch primero`);
      continue;
    }
    console.log(`  ${year}: ${s.added} nuevos, ${s.skipped} ya estaban, ${s.held} retenidos  (${s.makes} marcas)`);
  }

  if (held.length) {
    const reportPath = path.join(__dirname, "seed-vehicle-years-held.json");
    fs.writeFileSync(reportPath, JSON.stringify({ generatedAt: new Date().toISOString(), count: held.length, rows: held }, null, 2));
    console.log(`\n  retenidos por parecerse a un modelo existente: ${held.length}  -> scripts/${path.basename(reportPath)}`);
    for (const h of held.slice(0, 6)) {
      console.log(`    ${h.year} ${h.make}: NHTSA "${h.nhtsaModel}"  vs catalogo "${h.catalogModel}"`);
    }
  }
  console.log(`\n  total a agregar: ${additions.length}`);
  console.log(`  catalogo quedaria en: ${catalog.length + additions.length}`);
  if (additions.length) {
    console.log("\n  muestra:");
    for (const a of additions.slice(0, 8)) console.log(`    ${a.year} ${a.make} ${a.model}`);
  }

  if (!APPLY) {
    console.log("\nDRY RUN — no se modifico nada. Usar --apply para escribir.");
    await pool.end();
    return;
  }
  if (!additions.length) {
    console.log("\nNada que agregar.");
    await pool.end();
    return;
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backup = path.join(__dirname, `seed-vehicle-years-backup-${stamp}.json`);
  fs.writeFileSync(backup, JSON.stringify(catalog, null, 2));
  console.log(`\nrespaldo del catalogo completo: scripts/${path.basename(backup)}`);

  let nextId = catalog.reduce((max, e) => Math.max(max, Number(e.id) || 0), 0);
  const addedAt = new Date().toISOString();
  const merged = catalog.concat(
    additions.map((a) => ({
      id: ++nextId,
      year: a.year,
      make: a.make,
      model: a.model,
      bodyType: "",
      trimDescription: "",
      // Attributed to the script rather than a person: these were not typed by anyone, and the
      // distinction matters when reviewing manual additions later.
      addedBy: "seed-vehicle-years-from-nhtsa",
      addedAt,
    }))
  );

  await pool.query("UPDATE app_data SET value = $2::jsonb, updated_at = now() WHERE key = $1", [KEY, JSON.stringify(merged)]);
  const after = (await pool.query("SELECT jsonb_array_length(value) n FROM app_data WHERE key=$1", [KEY])).rows[0].n;
  console.log(`APLICADO: ${catalog.length} -> ${after}`);
  console.log("\nREINICIAR EL BACKEND: el proceso en curso todavia tiene la copia vieja en memoria.");
  await pool.end();
})();
