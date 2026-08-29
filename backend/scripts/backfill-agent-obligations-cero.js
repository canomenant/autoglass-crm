// Crea la obligación AGENT que faltaba para toda orden activa cuya cotización tiene agente pero
// que no aparece en cuentas por pagar (Antonio, 29-ago-2026: "que las arroje aunque estén sin
// comisión 0.00, para ponerse su comisión correspondiente").
//
// Eran invisibles porque payableSync solo creaba la obligación con monto > 0 — regla que ese
// mismo día se cambió para AGENT (basta el agente; $0.00 = comisión por capturar). Este script
// pone al día lo acumulado: 376 órdenes al momento de escribirlo. Idempotente por
// external_id = 'auto:agent:<orden>' (ON CONFLICT DO NOTHING), y no toca órdenes que ya tienen
// obligación AGENT de cualquier fuente.
//
// Uso: node scripts/backfill-agent-obligations-cero.js [--dry-run]

require("dotenv").config();
const pool = require("../src/config/db");
const { resolveAgentCompany } = require("../src/lib/payableSync");

const DRY = process.argv.includes("--dry-run");

(async () => {
  const faltantes = (
    await pool.query(`
      SELECT w.work_order_no, btrim(q.agent_name) AS party, COALESCE(w.commission, 0) AS amount,
             COALESCE(w.appointment_date::date, w.created_at::date) AS work_date
        FROM work_orders w JOIN quotes q ON q.id = w.quote_id
       WHERE w.active <> false AND btrim(COALESCE(q.agent_name, '')) <> ''
         AND NOT EXISTS (SELECT 1 FROM payable p WHERE p.work_order_no = w.work_order_no AND p.kind = 'AGENT')
       ORDER BY w.work_order_no`)
  ).rows;

  const porParte = {};
  faltantes.forEach((f) => { porParte[f.party] = (porParte[f.party] || 0) + 1; });
  console.log(`Órdenes con agente sin obligación: ${faltantes.length}`);
  console.log(porParte);

  let creadas = 0;
  for (const f of faltantes) {
    const company = await resolveAgentCompany(pool, f.party);
    if (DRY) { creadas++; continue; }
    const r = await pool.query(
      `INSERT INTO payable (work_order_no, kind, party, company, amount, status, work_date, source, external_id)
       VALUES ($1, 'AGENT', $2, $3, $4, 'pendiente', $5::date, 'auto_sync', $6)
       ON CONFLICT (external_id) DO NOTHING`,
      [f.work_order_no, f.party, company, Number(f.amount), f.work_date, `auto:agent:${f.work_order_no}`]
    );
    creadas += r.rowCount;
  }
  console.log(DRY ? `--dry-run: se crearían ${creadas}.` : `Creadas: ${creadas}.`);

  if (!DRY) {
    const check = await pool.query(`
      SELECT COALESCE(NULLIF(btrim(company), ''), party) AS party, count(*) n,
             count(*) FILTER (WHERE amount = 0) por_capturar
        FROM payable WHERE kind = 'AGENT' AND status = 'pendiente'
       GROUP BY 1 ORDER BY n DESC`);
    console.table(check.rows);
  }
  await pool.end();
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
