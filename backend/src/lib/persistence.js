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

module.exports = { loadOrSeed, save, nextIdFrom, backup, listBackups, restore, setPgCache, DATA_DIR, BACKUPS_DIR };
