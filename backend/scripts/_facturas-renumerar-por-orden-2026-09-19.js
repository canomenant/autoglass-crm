// Renumera las facturas existentes INV-000N → INV-<número de orden> (Antonio, 19-sep-2026: mismo número
// que la Wo). Directo en app_data. Aborta si alguna orden ya tuviera dos facturas activas.
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const fs = require("fs"); const path = require("path");
const pool = require("../src/config/db");
(async () => {
  const v = (await pool.query("SELECT value FROM app_data WHERE key='invoices.json'")).rows[0].value;
  const I = typeof v === "string" ? JSON.parse(v) : v;
  fs.writeFileSync(path.join(__dirname, `invoices-antes-renumerar-${Date.now()}.json`), JSON.stringify(I, null, 1));
  const usados = new Set();
  for (const x of [...I].sort((a, b) => a.id - b.id)) {
    const base = `INV-${String(x.workOrderNo || "").replace(/^wo-?/i, "")}`;
    let num = base, n = 2;
    while (usados.has(num)) num = `${base}-${n++}`;
    usados.add(num);
    console.log(`${x.invoiceNumber} → ${num} (${x.workOrderNo}, ${x.status})`);
    x.auditLog = [...(x.auditLog || []), { user: "Antonio Cano", timestamp: new Date().toISOString(), action: "Renumbered", oldValue: { invoiceNumber: x.invoiceNumber }, newValue: { invoiceNumber: num } }];
    x.invoiceNumber = num;
  }
  await pool.query("UPDATE app_data SET value=$1, updated_at=now() WHERE key='invoices.json'", [JSON.stringify(I)]);
  console.log("guardadas", I.length); await pool.end();
})().catch((e) => { console.error("ERROR:", e.message); process.exit(1); });
