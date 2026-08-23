// PASO 1 del modulo de cuentas por pagar: esquema y migracion de las obligaciones ya importadas.
//
//   cd backend && node scripts/create-payable-schema.js          # dry-run
//   cd backend && node scripts/create-payable-schema.js --apply
//
// NIVEL 1 = payable, una obligacion por work order y por parte (tecnico, agente, distribuidor).
// NIVEL 2 = payouts, que ya existia y agrupa obligaciones en un lote con numero consecutivo.
//
// Una sola tabla para los tres tipos porque comparten ciclo de vida: nacen con la work order,
// esperan en pendiente, y un lote las marca pagadas. Separarlas en tres obligaria a triplicar
// esa maquinaria y a elegir tres veces la misma decision.
//
// Las obligaciones de distribuidor salen de las 4,643 lineas del export y no de nuestros 4,342
// line items: el export es el unico lugar donde vive el estado pagado/pendiente, y sus 301
// huerfanas tambien representan plata que se debe aunque su work order no exista aca.
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const pool = require("../src/config/db");

const APPLY = process.argv.includes("--apply");
const DIR = path.join(__dirname, "..", "imports", "appsheet", "csv");

function parseCSV(t) {
  const R = []; let r = [], f = "", q = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (q) { if (c === '"') { if (t[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
    else if (c === '"') q = true;
    else if (c === ",") { r.push(f); f = ""; }
    else if (c === "\n") { r.push(f); R.push(r); r = []; f = ""; }
    else if (c !== "\r") f += c;
  }
  if (f || r.length) { r.push(f); R.push(r); }
  const h = R.shift().map((x) => x.trim());
  return R.filter((x) => x.length > 1).map((x) => Object.fromEntries(h.map((k, i) => [k, (x[i] ?? "").trim()])));
}
const num = (v) => { const n = Number(String(v ?? "").replace(/[$,]/g, "")); return Number.isFinite(n) ? n : 0; };
const money = (n) => "$" + Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const woNo = (l) => { const m = String(l ?? "").match(/^(Wo-\d+)/i); return m ? m[1] : null; };
const fecha = (v) => {
  const s = String(v ?? "").trim(); if (!s) return null;
  if (/^\d+$/.test(s)) { const d = new Date(Date.UTC(1899, 11, 30) + Number(s) * 86400000); return isNaN(d) ? null : d.toISOString().slice(0, 10); }
  const d = new Date(s); return isNaN(d) ? null : d.toISOString().slice(0, 10);
};

(async () => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    await client.query(`CREATE TABLE IF NOT EXISTS payable (
      id BIGSERIAL PRIMARY KEY,
      work_order_no TEXT,                    -- nulo en las huerfanas del export
      kind TEXT NOT NULL,                    -- TECH | AGENT | DISTRIBUTOR
      party TEXT,                            -- a quien se le debe
      amount NUMERIC(12,2) NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'pendiente',   -- pendiente | pagado
      payout_id INTEGER REFERENCES payouts(id) ON DELETE SET NULL,   -- lote que la pago
      work_date DATE,
      source TEXT,
      external_id TEXT UNIQUE,               -- id en AppSheet: hace el import idempotente
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
    await client.query("CREATE INDEX IF NOT EXISTS payable_wo_idx ON payable (work_order_no)");
    await client.query("CREATE INDEX IF NOT EXISTS payable_payout_idx ON payable (payout_id)");
    await client.query("CREATE INDEX IF NOT EXISTS payable_kind_status_idx ON payable (kind, status)");

    // La formula del lote de tecnico:
    //   subtotal + bonus - discount - cash_advance - parts_deduction + parts_return = total
    // bonus y deductions(=discount) ya existian; faltaban estas tres.
    for (const col of ["cash_advance", "parts_deduction", "parts_return"]) {
      await client.query(`ALTER TABLE payouts ADD COLUMN IF NOT EXISTS ${col} NUMERIC(12,2) DEFAULT 0`);
    }

    // --- migrar lo ya importado ---
    const tech = await client.query(`
      INSERT INTO payable (work_order_no, kind, party, amount, work_date, source, external_id)
      SELECT work_order_no, 'TECH', technician, labor, work_date, source, 'tech:' || external_id
        FROM work_order_tech_labor
      ON CONFLICT (external_id) DO NOTHING RETURNING 1`);
    const agent = await client.query(`
      INSERT INTO payable (work_order_no, kind, party, amount, work_date, source, external_id)
      SELECT work_order_no, 'AGENT', agent, total_pay, work_date, source, 'agent:' || external_id
        FROM work_order_agent_commission
      ON CONFLICT (external_id) DO NOTHING RETURNING 1`);

    // --- distribuidor, desde el export ---
    const det = parseCSV(fs.readFileSync(path.join(DIR, "BD_WORKORDER_DETAIL.csv"), "utf8"));
    let dist = 0, distHuerfanas = 0;
    for (const d of det) {
      const wo = woNo(d.WORKORDER_LABEL);
      if (!wo) distHuerfanas++;
      const r = await client.query(
        `INSERT INTO payable (work_order_no, kind, party, amount, work_date, source, external_id)
         VALUES ($1,'DISTRIBUTOR',$2,$3,$4::date,'appsheet_import',$5)
         ON CONFLICT (external_id) DO NOTHING RETURNING 1`,
        [wo, d.DISTRIBUTOR_LABEL || "", num(d["Glass Cost"]), fecha(d["DATE WORK ORDER"]), "dist:" + d.ID]
      );
      dist += r.rowCount;
    }

    const r = await client.query(`SELECT kind, count(*) n, SUM(amount) s FROM payable GROUP BY 1 ORDER BY 1`);
    console.log("obligaciones creadas");
    for (const x of r.rows) console.log(`  ${x.kind.padEnd(12)} ${String(x.n).padStart(5)}  ${money(x.s)}`);
    const tot = r.rows.reduce((a, x) => a + Number(x.s), 0);
    console.log(`  ${"TOTAL".padEnd(12)} ${String(r.rows.reduce((a, x) => a + Number(x.n), 0)).padStart(5)}  ${money(tot)}`);
    console.log(`\n  insertadas ahora: tech ${tech.rowCount} · agent ${agent.rowCount} · dist ${dist} (${distHuerfanas} sin work order)`);
    console.log(`  columnas nuevas en payouts: cash_advance, parts_deduction, parts_return`);

    if (APPLY) { await client.query("COMMIT"); console.log("\n  APLICADO"); }
    else { await client.query("ROLLBACK"); console.log("\n  ROLLBACK — dry-run"); }
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    console.log("ERROR:", e.message);
  } finally { client.release(); await pool.end(); }
})();
