require("dotenv").config();
const pool = require("../src/config/db");

// Marca qué pagos traen ajustes HEREDADOS sin desglosar: su credit/debit_notes_total viene del
// CSV de AppSheet y NO coincide con la suma de sus notas enlazadas. Mientras esta bandera esté
// encendida, recalculatePayment NO reescribe los totales (recomponerlos desde notas parciales
// los encogería — p. ej. editar ND-0305 dejaría a Dist-0238 con $118.50 de débito en lugar de
// sus $351.50 reales). La bandera se apaga sola cuando el desglose queda exacto.
//
// Detectado al diseñar el "Desglosar ajustes heredados" que pidió Antonio con Dist-0073
// (29-ago-2026): $432.96 de legacy con CINCO combinaciones de notas posibles.
//
// --apply para escribir; sin el flag solo simula.

const APPLY = process.argv.includes("--apply");

(async () => {
  await pool.query("ALTER TABLE payouts ADD COLUMN IF NOT EXISTS legacy_adjustments BOOLEAN NOT NULL DEFAULT false");
  const cond = `
    p.active <> false AND (
      ABS(COALESCE(p.debit_notes_total, 0) - COALESCE((SELECT SUM(n.amount) FROM credit_debit_note n
        WHERE n.payout_id = p.id AND n.kind = 'DEBIT' AND n.active AND n.status NOT IN ('Void','Cancelled')
          AND n.entity_type = p.type), 0)) >= 0.005
      OR
      ABS(COALESCE(p.credit_notes_total, 0) - COALESCE((SELECT SUM(n.amount) FROM credit_debit_note n
        WHERE n.payout_id = p.id AND n.kind = 'CREDIT' AND n.active AND n.status NOT IN ('Void','Cancelled')
          AND n.entity_type = p.type), 0)) >= 0.005
    )`;
  const prev = await pool.query(`SELECT count(*)::int n FROM payouts p WHERE ${cond} AND NOT p.legacy_adjustments`);
  console.log(`Pagos con ajustes heredados sin desglosar (a marcar): ${prev.rows[0].n}`);
  if (!APPLY) {
    console.log("\nSimulación. Volver a lanzar con --apply para escribir.");
    await pool.end();
    return;
  }
  const r = await pool.query(`UPDATE payouts p SET legacy_adjustments = true WHERE ${cond} AND NOT p.legacy_adjustments`);
  // Y a la inversa: si alguno quedó marcado pero ya está en sincronía, se apaga.
  const off = await pool.query(`UPDATE payouts p SET legacy_adjustments = false WHERE p.legacy_adjustments AND NOT (${cond})`);
  console.log(`Marcados: ${r.rowCount}. Apagados por estar en sincronía: ${off.rowCount}.`);
  await pool.end();
})().catch((e) => {
  console.error("FALLA:", e.message);
  process.exit(1);
});
