// PASO 20: la obligacion de agente guarda a que COMPANIA pertenece.
//
//   cd backend && node scripts/backfill-payable-company.js          # dry-run, ROLLBACK
//   cd backend && node scripts/backfill-payable-company.js --apply
//
// La comision se le paga a la compania, no al agente, y una compania puede tener varios: Digiclique
// Digital Marketing Services tiene tres con saldo — David Cruz, Ashley Diaz y Kayla Lopez — y se les
// paga junto, en un solo lote. La vista de cuentas por pagar agrupaba por agente, asi que obligaba a
// hacer tres pagos donde el negocio hace uno.
//
// El dato ya estaba en work_order_agent_commission.company; solo faltaba en payable.
//
// Los distribuidores NO se agrupan: en CAT_COMPANY cada sucursal de Mygrant es una compania
// distinta, no una sucursal de una matriz. Que Dist-0244 pagara a tres a la vez es una excepcion
// del historico, no una regla que la vista deba reproducir.
require("dotenv").config();
const pool = require("../src/config/db");

const APPLY = process.argv.includes("--apply");
const money = (n) => "$" + Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

(async () => {
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    await c.query("ALTER TABLE payable ADD COLUMN IF NOT EXISTS company TEXT");
    await c.query("CREATE INDEX IF NOT EXISTS payable_company_idx ON payable (kind, company) WHERE company IS NOT NULL");

    const r = await c.query(
      `UPDATE payable p SET company = k.company, updated_at = now()
         FROM work_order_agent_commission k
        WHERE 'agent:' || k.external_id = p.external_id
          AND p.kind = 'AGENT' AND COALESCE(btrim(k.company), '') <> ''
          AND p.company IS DISTINCT FROM k.company
       RETURNING 1`);

    const sin = (await c.query(
      "SELECT count(*)::int n FROM payable WHERE kind = 'AGENT' AND company IS NULL")).rows[0].n;

    console.log(APPLY ? "=== APLICANDO ===" : "=== DRY-RUN (termina en ROLLBACK) ===");
    console.log(`obligaciones de agente con compania: ${r.rowCount}`);
    console.log(`  siguen sin compania: ${sin}`);

    console.log("\n--- como se vera la vista de cuentas por pagar ---");
    console.table((await c.query(
      `SELECT COALESCE(NULLIF(btrim(company), ''), party) AS quien,
              count(*)::int obligaciones, count(DISTINCT party)::int agentes, round(SUM(amount), 2) monto
         FROM payable WHERE kind = 'AGENT' AND status = 'pendiente' AND amount > 0
        GROUP BY 1 ORDER BY 4 DESC`)).rows);

    const t = (await c.query(
      "SELECT count(*)::int n, round(SUM(amount),2) s FROM payable WHERE kind='AGENT' AND status='pendiente' AND amount>0")).rows[0];
    console.log(`total pendiente con agentes: ${money(t.s)} en ${t.n} obligaciones (sin cambios)`);

    if (APPLY) { await c.query("COMMIT"); console.log("\nCOMMIT"); }
    else { await c.query("ROLLBACK"); console.log("\nROLLBACK: corre con --apply."); }
  } catch (e) {
    await c.query("ROLLBACK");
    console.error("ROLLBACK:", e.message);
    process.exitCode = 1;
  } finally {
    c.release();
    await pool.end();
  }
})().catch((e) => { console.error(e); process.exit(1); });
