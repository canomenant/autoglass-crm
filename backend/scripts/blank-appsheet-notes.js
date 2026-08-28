require("dotenv").config();
const pool = require("../src/config/db");

// Retira de la vista TODAS las notas de crédito/débito heredadas de AppSheet, para capturarlas de
// nuevo a mano desde la hoja de respaldo.
//
// Por qué: la numeración y la aplicación de esas notas no reflejan la realidad (decisión de
// Antonio, 2026-08-27). El flujo real es: llega la factura del distribuidor, se desglosan las
// partes, y al resto se le aplican notas manuales hasta cuadrar el total facturado.
//
// Cómo: soft-delete (active = false), NUNCA DELETE — reversible con un UPDATE si hiciera falta.
// Y deliberadamente SIN pasar por notes.store ni recalcular pagos:
//
//   - Los totales de crédito/débito que traen los payouts vienen del propio CSV de pagos de
//     AppSheet (verificados al centavo contra BD_PAYMENTDISTRIBUTOR), NO de estas notas. Esos
//     totales son historia correcta y se quedan como están.
//   - Al capturar las notas reales de un pago, recalculatePayment recompone sus totales desde las
//     notas activas — por eso hay que capturar TODAS las notas de ese pago, no una parte.
//
// Solo toca source='appsheet'. Las creadas en la app (source='app') y las 3 viejas de notes.json
// se quedan.
//
// --apply para escribir; sin el flag solo simula.

const APPLY = process.argv.includes("--apply");

(async () => {
  const antes = (await pool.query(
    "SELECT sum(credit_notes_total)::numeric AS cred, sum(debit_notes_total)::numeric AS deb FROM payouts WHERE active <> false"
  )).rows[0];

  const r = (await pool.query(
    `SELECT kind, count(*)::int AS n, sum(amount)::numeric AS total
       FROM credit_debit_note WHERE active <> false AND source = 'appsheet' GROUP BY kind ORDER BY kind`
  )).rows;
  const quedan = (await pool.query(
    `SELECT source, kind, count(*)::int AS n FROM credit_debit_note
      WHERE active <> false AND source <> 'appsheet' GROUP BY 1,2 ORDER BY 1,2`
  )).rows;

  console.log("A retirar (source='appsheet'):");
  r.forEach((x) => console.log(`  ${x.kind}: ${x.n} notas ($${Number(x.total).toFixed(2)})`));
  console.log("Se quedan:");
  quedan.forEach((x) => console.log(`  ${x.source} ${x.kind}: ${x.n}`));
  console.log(`\nTotales de payouts ANTES (no deben moverse): cred=$${Number(antes.cred).toFixed(2)} deb=$${Number(antes.deb).toFixed(2)}`);

  if (!APPLY) {
    console.log("\nSimulación. Volver a lanzar con --apply para escribir.");
    await pool.end();
    return;
  }

  const upd = await pool.query(
    "UPDATE credit_debit_note SET active = false, updated_at = now() WHERE active <> false AND source = 'appsheet'"
  );
  const despues = (await pool.query(
    "SELECT sum(credit_notes_total)::numeric AS cred, sum(debit_notes_total)::numeric AS deb FROM payouts WHERE active <> false"
  )).rows[0];

  console.log(`\nRetiradas: ${upd.rowCount}.`);
  console.log(`Totales de payouts DESPUÉS: cred=$${Number(despues.cred).toFixed(2)} deb=$${Number(despues.deb).toFixed(2)}`);
  const intactos = Number(antes.cred) === Number(despues.cred) && Number(antes.deb) === Number(despues.deb);
  console.log(intactos ? "OK — los totales históricos no se movieron." : "¡ATENCIÓN! Los totales cambiaron.");
  console.log("\nReversa, si hiciera falta: UPDATE credit_debit_note SET active = true WHERE source = 'appsheet';");
  await pool.end();
  process.exit(intactos ? 0 : 1);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
