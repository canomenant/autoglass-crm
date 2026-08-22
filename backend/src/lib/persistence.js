const fs = require("fs");
const path = require("path");
const pool = require("../config/db");

const DATA_DIR = path.join(__dirname, "..", "..", "data");
const BACKUPS_DIR = path.join(__dirname, "..", "..", "backups");

let _pgCache = null;

function setPgCache(cache) {
  _pgCache = cache;
}

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function filePath(filename) {
  return path.join(DATA_DIR, filename);
}

// Fire-and-forget mirror to Postgres — never awaited, never allowed to throw into the caller.
// loadOrSeed() prefers app_data over the local file whenever a key is cached there, so a write
// that only reaches the file is invisible to the next boot (bit us with zipCodes, paymentMethods,
// and jobTypes.is_taxable). A rejected promise here must never surface as an unhandled rejection
// or an error response — the local file write above is already durable and already succeeded.
function syncToAppData(key, value) {
  pool
    .query(
      `INSERT INTO app_data (key, value, updated_at) VALUES ($1, $2, now())
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
      [key, JSON.stringify(value)]
    )
    .catch((err) => {
      console.error(`[persistence] Failed to sync "${key}" to app_data:`, err.message);
    });
}

function save(filename, data) {
  ensureDataDir();
  fs.writeFileSync(filePath(filename), JSON.stringify(data, null, 2), "utf-8");

  // Only for keys Postgres is already the source of truth for (i.e. present in _pgCache).
  // This is the same condition loadOrSeed() uses to prefer app_data over the file, so it
  // naturally excludes agents.json/technicians.json (kept out of the cache in initPostgres.js
  // for local-only login passwords) and any store never seeded into app_data at all — without
  // needing to duplicate that exclusion list here.
  if (_pgCache && Object.prototype.hasOwnProperty.call(_pgCache, filename)) {
    _pgCache[filename] = data; // next loadOrSeed() in this process sees it immediately, no restart needed
    syncToAppData(filename, data);
  }
}

// Appends one entry to a JSONB array in app_data without pulling it into the process first.
//
// save() rewrites the whole array, so two writers racing lose one of the two entries — with the
// 11k-entry part-number catalog that is 255 kB on the wire per add, and a silent loss whenever
// two people add a part at the same time. This is a single statement, so both land. The new id is
// computed from the stored array inside that same statement, and `uniqueField` is compared
// with case, whitespace and separator punctuation squashed out, so the duplicate guard can't be
// raced either. `uniqueField` takes one field name or several: part numbers are unique on the
// number alone, a vehicle only on year + make + model + body type together. That comparison must stay identical to the caller's own normalizer — see
// partNumbers.store.js#normalizePartNumber, which scripts/verify-add-part-number.js asserts
// against this statement. btrim() alone was not enough: it leaves internal runs of spaces intact,
// so "fw02500   gbn" slipped past a stored "FW02500 GBN".
//
// Returns the appended entry, or null when `uniqueField` already matches something (the caller
// decides what to tell the user). Throws if the key isn't in app_data at all.
//
// app_data only, deliberately: the local JSON file is a cold-start fallback for running without
// Postgres and is already thousands of entries out of date, so re-serializing it on every append
// would cost the write we just avoided and fix nothing. Callers keep the in-memory copy current.
async function appendToAppDataArray(filename, fields, { uniqueField, timestampField } = {}) {
  const columns = Object.keys(fields);
  // A number stays a number in the stored JSON. The 92,958 vehicle entries hold year as a JSON
  // number, and appending a string "2026" next to them would make `entry.year === 2026` false for
  // exactly the rows a user just added.
  const isNumeric = (name) => typeof fields[name] === "number" && Number.isFinite(fields[name]);
  const placeholder = (name, i) => (isNumeric(name) ? `to_jsonb($${i + 1}::numeric)` : `$${i + 1}::text`);
  // $1..$n carry the values; the object is built in SQL so 'id' and 'addedAt' come from the
  // database rather than from a process that may be one of several.
  const pairs = columns.map((name, i) => `'${name}', ${placeholder(name, i)}`).join(",\n          ");
  // Stamped by Postgres, not by the process: with more than one app instance their clocks are
  // the one thing guaranteed to disagree, and this timestamp is meant to be audit evidence.
  const timestamp = timestampField ? `,\n              '${timestampField}', to_jsonb(now())` : "";
  const values = columns.map((name) => (fields[name] == null ? "" : String(fields[name])));

  // Spelled out with chr() so the SQL carries no backslash escapes: space, tab, CR, LF and the
  // separators people vary on. Same set as the caller's normalizer, character for character.
  const SQUASH_CHARS = "' ' || chr(9) || chr(10) || chr(13) || '-._/'";
  const squash = (expr) => `translate(lower(${expr}), ${SQUASH_CHARS}, '')`;
  // One field or several — several means the combination is what has to be unique, so every
  // comparison is ANDed. Compared as text on both sides regardless of the stored JSON type.
  const uniqueFields = uniqueField == null ? [] : [].concat(uniqueField);
  const guard = uniqueFields.length
    ? `AND NOT EXISTS (
          SELECT 1 FROM jsonb_array_elements(value) e
          WHERE ${uniqueFields
            .map((name) => `${squash(`e->>'${name}'`)} = ${squash(`$${columns.indexOf(name) + 1}::text`)}`)
            .join("\n            AND ")})`
    : "";

  const result = await pool.query(
    `UPDATE app_data
        SET value = value || jsonb_build_object(
              'id', (SELECT COALESCE(MAX((e->>'id')::int), 0) + 1 FROM jsonb_array_elements(value) e),
              ${pairs}${timestamp}
            ),
            updated_at = now()
      WHERE key = $${columns.length + 1}
        ${guard}
      RETURNING value -> -1 AS entry`,
    [...values, filename]
  );

  if (result.rowCount === 0) return null;

  const entry = result.rows[0].entry;
  // Keep this process's view current: loadOrSeed() hands stores the cached array by reference, so
  // pushing here is what makes the new entry visible to the store without a restart.
  if (_pgCache && Array.isArray(_pgCache[filename])) _pgCache[filename].push(entry);
  return entry;
}

function loadOrSeed(filename, seedFn) {
  if (_pgCache && Object.prototype.hasOwnProperty.call(_pgCache, filename)) {
    return _pgCache[filename];
  }
  ensureDataDir();
  const target = filePath(filename);
  if (fs.existsSync(target)) {
    try {
      const raw = fs.readFileSync(target, "utf-8");
      return JSON.parse(raw);
    } catch {
      // Corrupt file: fall through and reseed rather than crash the server.
    }
  }
  const seeded = seedFn();
  save(filename, seeded);
  return seeded;
}

function nextIdFrom(items) {
  return items.reduce((max, item) => Math.max(max, Number(item.id) || 0), 0) + 1;
}

function backup(label) {
  ensureDataDir();
  if (!fs.existsSync(BACKUPS_DIR)) fs.mkdirSync(BACKUPS_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const name = label ? `${stamp}_${label}` : stamp;
  const dest = path.join(BACKUPS_DIR, name);
  fs.mkdirSync(dest, { recursive: true });
  for (const file of fs.readdirSync(DATA_DIR)) {
    fs.copyFileSync(path.join(DATA_DIR, file), path.join(dest, file));
  }
  return dest;
}

function listBackups() {
  if (!fs.existsSync(BACKUPS_DIR)) return [];
  return fs.readdirSync(BACKUPS_DIR).sort().reverse();
}

function restore(backupName) {
  const source = path.join(BACKUPS_DIR, backupName);
  if (!fs.existsSync(source)) throw new Error(`Backup not found: ${backupName}`);
  ensureDataDir();
  for (const file of fs.readdirSync(source)) {
    fs.copyFileSync(path.join(source, file), path.join(DATA_DIR, file));
  }
  return true;
}

module.exports = { loadOrSeed, save, appendToAppDataArray, nextIdFrom, backup, listBackups, restore, setPgCache, DATA_DIR, BACKUPS_DIR };
