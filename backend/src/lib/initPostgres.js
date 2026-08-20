const pool = require("../config/db");
const { setPgCache } = require("./persistence");

// These two carry local-only login passwords that were never captured in Postgres
// (cat_technician.extra / cat_agent.extra have no password field); loading them into
// the cache would silently lock every technician and agent out of login.
const CACHE_EXCLUDED_KEYS = new Set(["technicians.json", "agents.json"]);

async function initPostgres() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS app_data (
      key TEXT PRIMARY KEY,
      value JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  // Audit trail for quote saves that repriced an already-Paid/Closed work order. The quote stays
  // the source of truth on purpose — historical figures get corrected in bulk and editing them in
  // two places would be worse — so this is a record, not a lock: it exists so that in a few months
  // we can tell whether this is happening by accident often enough to justify locking paid orders.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS paid_work_order_price_changes (
      id BIGSERIAL PRIMARY KEY,
      quote_id TEXT NOT NULL,
      quote_no TEXT,
      work_order_id TEXT NOT NULL,
      work_order_no TEXT,
      work_order_status TEXT NOT NULL,
      old_price NUMERIC(12,2) NOT NULL,
      new_price NUMERIC(12,2) NOT NULL,
      changed_by TEXT,
      changed_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  const r = await pool.query("SELECT key, value FROM app_data");
  const cache = {};
  for (const row of r.rows) {
    if (CACHE_EXCLUDED_KEYS.has(row.key)) continue;
    cache[row.key] = row.value;
  }
  setPgCache(cache);
}

async function getAppData(key, defaultValue = null) {
  const r = await pool.query("SELECT value FROM app_data WHERE key = $1", [key]);
  return r.rows.length > 0 ? r.rows[0].value : defaultValue;
}

async function setAppData(key, value) {
  await pool.query(
    `INSERT INTO app_data (key, value, updated_at) VALUES ($1, $2, now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [key, JSON.stringify(value)]
  );
}

module.exports = { initPostgres, getAppData, setAppData };
