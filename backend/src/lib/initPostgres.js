const pool = require("../config/db");

async function initPostgres() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS app_data (
      key TEXT PRIMARY KEY,
      value JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
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
