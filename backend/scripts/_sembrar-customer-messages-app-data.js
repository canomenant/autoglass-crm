// Siembra customerMessages.json en app_data (bitácora de SMS al cliente) para que persistence.save()
// la sincronice; sin la fila, Railway pierde la bitácora en cada redespliegue. 19-sep-2026.
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const pool = require("../src/config/db");
(async () => {
  const r = await pool.query("SELECT 1 FROM app_data WHERE key='customerMessages.json'");
  if (r.rows.length) console.log("ya existe");
  else { await pool.query("INSERT INTO app_data (key, value, updated_at) VALUES ('customerMessages.json', '[]', now())"); console.log("sembrada"); }
  await pool.end();
})().catch((e) => { console.error("ERROR:", e.message); process.exit(1); });
