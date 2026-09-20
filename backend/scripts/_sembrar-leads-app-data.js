// Siembra leadBuyers.json y leadSettings.json en app_data (venta de leads, 19-sep-2026) para que
// persistence.save() los sincronice; sin la fila, Railway pierde los cambios al redesplegar.
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const pool = require("../src/config/db");
const store = require("../src/store/leadBuyers.store");
(async () => {
  for (const [key, value] of [["leadBuyers.json", []], ["leadSettings.json", store.getSettings()]]) {
    const r = await pool.query("SELECT 1 FROM app_data WHERE key=$1", [key]);
    if (r.rows.length) console.log(key, "ya existe");
    else { await pool.query("INSERT INTO app_data (key, value, updated_at) VALUES ($1, $2, now())", [key, JSON.stringify(value)]); console.log(key, "sembrada"); }
  }
  await pool.end();
})().catch((e) => { console.error("ERROR:", e.message); process.exit(1); });
