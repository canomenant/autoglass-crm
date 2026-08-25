// PASO 11: el bono guarda por que se dio.
//
//   cd backend && node scripts/add-bonus-reason.js --apply
//
// AppSheet itemiza los bonos en una tabla hija (fecha, tipo, monto por fila). Ese export no
// existe: de los ocho CSV que se recibieron, ninguno trae bonos ni descuentos. Asi que el monto
// llego y el motivo no, en los 229 lotes que tienen bono — 220 de agente por $11,462.99 y 9 de
// tecnico por $826.00.
//
// No se puede reconstruir. El bono de $100 en Tech-0011 es por una garantia que Joel cubrio de
// otro tecnico, de un trabajo de 2024: la base arranca el 2025-01-02 y no tiene una sola work
// order anterior, asi que ese trabajo no existe aqui ni va a existir. Ese es justamente el caso
// que obliga a que el motivo sea texto libre y no una referencia a una orden — lo que explica el
// bono puede vivir enteramente fuera del sistema.
//
// Va como campo propio y no reusando `notes` porque son dos cosas distintas: notes es una
// observacion del pago, y mezclarlas deja sin forma de saber cual de las dos se esta leyendo.
require("dotenv").config();
const pool = require("../src/config/db");

const APPLY = process.argv.includes("--apply");

(async () => {
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    await c.query("ALTER TABLE payouts ADD COLUMN IF NOT EXISTS bonus_reason TEXT");

    const pend = (await c.query(
      `SELECT type, count(*)::int lotes, round(SUM(bonus), 2) monto
         FROM payouts WHERE active <> false AND bonus <> 0 AND COALESCE(btrim(bonus_reason), '') = ''
        GROUP BY 1 ORDER BY 1`)).rows;

    console.log(APPLY ? "=== APLICANDO ===" : "=== DRY-RUN (termina en ROLLBACK) ===");
    console.log("columna bonus_reason lista.\n");
    console.log("Bonos historicos sin motivo — solo Antonio puede llenarlos:");
    console.table(pend);
    console.log(`total sin explicar: $${pend.reduce((s, x) => s + Number(x.monto), 0).toFixed(2)}`);

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
