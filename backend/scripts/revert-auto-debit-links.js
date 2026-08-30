require("dotenv").config();
const pool = require("../src/config/db");

// OPCIÓN 2 elegida por Antonio (30-ago-2026): quitar las DECISIONES automáticas, no las notas.
//
// Se revierte el "nacimiento" (payout_id) que los scripts le pusieron a los débitos heredados —
// combinación única, evidencia de factura hermana, y el intercambio ND-0029 — para que CADA
// aplicación al distribuidor la decida Antonio con el panel "Desglosar ajustes heredados".
//
// SE QUEDA tal cual:
//   - Las notas mismas, visibles, con su parte/factura/monto (datos del propio AppSheet).
//   - Los desgloses que Antonio hizo A MANO con el panel (audit: 'legacy adjustments breakdown').
//   - Los créditos y su pago (payout_id de las CN): eso venía 114/114 en el export — es dato, no
//     decisión — igual que los cargos a técnico (charge_payout_id) y los ciclos crédito→débito.
//   - Todos los totales de pagos (nunca se tocaron) y todo el código/diseño.
//
// Tras quitar los enlaces se reenciende legacy_adjustments donde vuelva a haber heredado sin
// desglosar, para que ningún recálculo pueda mover esos totales mientras Antonio trabaja.
//
// --apply para escribir; sin el flag solo simula.

const APPLY = process.argv.includes("--apply");

(async () => {
  // Los enlaces PUESTOS POR SCRIPT se reconocen por su huella de auditoría; los del panel de
  // Antonio dicen 'legacy adjustments breakdown' y esos NO se tocan.
  const aRevertir = (await pool.query(`
    SELECT n.id, n.note_number, n.amount, po.payment_number,
           (SELECT e->>'action' FROM jsonb_array_elements(n.audit_log) e
             WHERE e->>'action' ILIKE 'Linked to distributor payment%'
                OR e->>'action' ILIKE 'Reactivated and itemized%'
             ORDER BY e->>'timestamp' DESC LIMIT 1) AS huella
      FROM credit_debit_note n
      JOIN payouts po ON po.id = n.payout_id
     WHERE n.kind = 'DEBIT' AND n.source = 'appsheet' AND n.payout_id IS NOT NULL
       AND EXISTS (SELECT 1 FROM jsonb_array_elements(n.audit_log) e
                    WHERE e->>'action' ILIKE 'Linked to distributor payment%'
                       OR e->>'action' ILIKE 'Reactivated and itemized%')
     ORDER BY po.payment_number, n.note_number`)).rows;

  const seQuedan = (await pool.query(`
    SELECT n.note_number, n.amount, po.payment_number
      FROM credit_debit_note n JOIN payouts po ON po.id = n.payout_id
     WHERE n.kind = 'DEBIT' AND n.source = 'appsheet' AND n.payout_id IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(n.audit_log) e
                        WHERE e->>'action' ILIKE 'Linked to distributor payment%'
                           OR e->>'action' ILIKE 'Reactivated and itemized%')
     ORDER BY po.payment_number, n.note_number`)).rows;

  const pagos = [...new Set(aRevertir.map((x) => x.payment_number))];
  console.log(`SE REVIERTEN ${aRevertir.length} nacimientos puestos por script ($${aRevertir.reduce((s, x) => s + Number(x.amount), 0).toFixed(2)}) en ${pagos.length} pagos:\n`);
  let pagoAct = "";
  aRevertir.forEach((x) => {
    if (x.payment_number !== pagoAct) { pagoAct = x.payment_number; console.log(`  ${pagoAct}:`); }
    const met = /invoice evidence/i.test(x.huella || "") ? "evidencia factura" : /unique exact/i.test(x.huella || "") ? "combinación única" : "intercambio";
    console.log(`    ${x.note_number} $${x.amount} (${met})`);
  });

  console.log(`\nSE QUEDAN (los pusiste TÚ con el panel): ${seQuedan.length} notas`);
  seQuedan.forEach((x) => console.log(`    ${x.note_number} $${x.amount} -> ${x.payment_number}`));

  if (!APPLY) {
    // Vista previa del efecto en la bandera de protección.
    const flag = (await pool.query(`
      SELECT count(*)::int n FROM payouts p
       WHERE p.active <> false AND NOT p.legacy_adjustments AND p.id IN (
         SELECT po.id FROM credit_debit_note n JOIN payouts po ON po.id = n.payout_id
          WHERE n.id = ANY($1::bigint[]))`, [aRevertir.map((x) => x.id)])).rows[0];
    console.log(`\nPagos que recuperarían la bandera de protección: ~${flag.n} (se recalcula exacto al aplicar).`);
    console.log("\nSimulación. Volver a lanzar con --apply para escribir.");
    await pool.end();
    return;
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `UPDATE credit_debit_note SET payout_id = NULL, updated_at = now(),
              audit_log = COALESCE(audit_log, '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
                'timestamp', now(), 'user', 'System',
                'action', 'Auto-link reverted: Antonio itemizes distributor payments manually (option 2, 30-Aug-2026)'))
        WHERE id = ANY($1::bigint[])`, [aRevertir.map((x) => x.id)]);
    // La etiqueta vuelve a decir la verdad: sin nacimiento y sin otra salida real = Active.
    await client.query(`
      UPDATE credit_debit_note n SET status = 'Active', updated_at = now()
       WHERE n.id = ANY($1::bigint[]) AND n.status = 'Applied'
         AND n.charge_payout_id IS NULL
         AND COALESCE(n.resolution, '') NOT IN ('LOSS', 'INSTALLED')
         AND NOT EXISTS (SELECT 1 FROM credit_debit_note c
                          WHERE c.debit_note_id = n.id AND c.kind = 'CREDIT' AND c.active
                            AND c.status NOT IN ('Void','Cancelled') AND c.payout_id IS NOT NULL)`,
      [aRevertir.map((x) => x.id)]);
    // Y se reenciende la protección donde vuelva a haber heredado sin desglosar.
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
    const on = await client.query(`UPDATE payouts p SET legacy_adjustments = true WHERE ${cond} AND NOT p.legacy_adjustments`);
    await client.query("COMMIT");
    console.log(`\nRevertidos: ${aRevertir.length} enlaces. Protección reencendida en ${on.rowCount} pagos más.`);
  } catch (e) {
    try { await client.query("ROLLBACK"); } catch {}
    throw e;
  } finally {
    client.release();
  }
  await pool.end();
})().catch((e) => {
  console.error("FALLA:", e.message);
  process.exit(1);
});
