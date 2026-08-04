const fs = require("fs");
const path = require("path");

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

function save(filename, data) {
  ensureDataDir();
  fs.writeFileSync(filePath(filename), JSON.stringify(data, null, 2), "utf-8");
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
