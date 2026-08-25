// PASO 17: el bono gana un TIPO, para poder responder que clase de bonos se estan dando.
//
//   cd backend && node scripts/add-bonus-type.js --apply
//
// El motivo en texto libre sirve para explicar un caso — "garantia de 2024 que cubrio de otro
// tecnico" — pero no agrupa: 226 bonos escritos a mano no van a producir dos frases iguales, y el
// sumario no podria sumar nada.
//
// Las categorias no se inventan: son las que ya usa AppSheet en su tabla hija de bonos, visibles en
// la pantalla de Agent0234 — CC COLLECTED, REVIEWS, ADMIN FEE, CC PROCESSED, ITEMIZED INVOICE. Se
// agrega WARRANTY, que es el caso de Tech-0011, y OTHER para lo que no encaje.
//
// Nada se clasifica solo. Los 226 quedan sin tipo hasta que Antonio los revise uno por uno, que es
// como decidio hacerlo; el sumario reporta cuantos faltan para que el hueco sea visible.
require("dotenv").config();
const pool = require("../src/config/db");

const APPLY = process.argv.includes("--apply");
const money = (n) => "$" + Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

(async () => {
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    await c.query("ALTER TABLE payouts ADD COLUMN IF NOT EXISTS bonus_type TEXT");
    await c.query("CREATE INDEX IF NOT EXISTS payouts_bonus_type_idx ON payouts (bonus_type) WHERE bonus <> 0");

    // Los 5 lotes que se cuadraron llevan un ajuste, no un bono de verdad. Se marcan como tales
    // para que no ensucien el sumario: si aparecieran sin tipo, alguien intentaria clasificarlos.
    const ajustes = await c.query(
      `UPDATE payouts SET bonus_type = 'ADJUSTMENT', updated_at = now()
        WHERE bonus <> 0 AND bonus_type IS NULL AND bonus_reason LIKE 'Ajuste sin respaldo%' RETURNING 1`);

    const r = (await c.query(
      `SELECT count(*)::int total, round(SUM(bonus),2) monto,
              count(*) FILTER (WHERE bonus_type IS NULL)::int sin_tipo
         FROM payouts WHERE active <> false AND bonus <> 0`)).rows[0];

    console.log(APPLY ? "=== APLICANDO ===" : "=== DRY-RUN (termina en ROLLBACK) ===");
    console.log(`marcados como ajuste (no son bono): ${ajustes.rowCount}`);
    console.log(`pagos con bono: ${r.total}, ${money(r.monto)} — sin clasificar: ${r.sin_tipo}`);

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
