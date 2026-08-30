require("dotenv").config();
const pool = require("../src/config/db");

// La etiqueta de una nota de débito debe decir la verdad: "Applied" cuando su costo YA llegó a
// algún lado. Antonio veía "muchas sin aplicar" (29-ago-2026) y tenía razón en la pantalla pero
// no en el dinero: la reactivación del histórico dejó los débitos con status 'Active' aunque su
// ciclo estaba cerrado — cobrados a un técnico (charge_payout_id), neteados en un pago de
// distribuidor (payout_id), devueltos con crédito aplicado, o asumidos como pérdida/instalados.
//
// Regla (la misma que la bandeja usa para "cerrada"):
//   Applied = tiene charge_payout_id, o payout_id, o resolution LOSS/INSTALLED, o un crédito
//   activo que la resuelve y que ya está neteado en un pago.
//   Active  = de verdad pendiente (TECH sin cobrar, o sin destino en la bandeja).
//
// El status NO participa en ningún monto (los recálculos solo excluyen Void/Cancelled), así que
// esto no mueve un centavo: cambia lo que dicen los dashboards y las pantallas.
//
// --apply para escribir; sin el flag solo simula.

const APPLY = process.argv.includes("--apply");

(async () => {
  const cond = `
    kind = 'DEBIT' AND active AND status = 'Active' AND (
      charge_payout_id IS NOT NULL
      OR payout_id IS NOT NULL
      OR resolution IN ('LOSS', 'INSTALLED')
      OR EXISTS (SELECT 1 FROM credit_debit_note c
                  WHERE c.debit_note_id = credit_debit_note.id AND c.kind = 'CREDIT' AND c.active
                    AND c.status NOT IN ('Void', 'Cancelled') AND c.payout_id IS NOT NULL)
    )`;
  const prev = await pool.query(`SELECT count(*)::int n, round(SUM(amount),2) m FROM credit_debit_note WHERE ${cond}`);
  console.log(`Débitos con ciclo cerrado pero etiqueta Active: ${prev.rows[0].n} ($${prev.rows[0].m})`);

  // Créditos con pago pero sin marcar (el caso CN-0016 puede repetirse con capturas nuevas).
  const prevC = await pool.query(
    `SELECT count(*)::int n FROM credit_debit_note
      WHERE kind = 'CREDIT' AND active AND status = 'Active' AND payout_id IS NOT NULL`);
  console.log(`Créditos neteados en un pago pero con etiqueta Active: ${prevC.rows[0].n}`);

  if (!APPLY) {
    console.log("\nSimulación. Volver a lanzar con --apply para escribir.");
    await pool.end();
    return;
  }

  const d = await pool.query(`
    UPDATE credit_debit_note SET status = 'Applied', updated_at = now(),
           audit_log = COALESCE(audit_log, '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
             'timestamp', now(), 'user', 'System',
             'action', 'Status corrected to Applied: cycle already closed (charged/netted/credited/resolved)'))
     WHERE ${cond}`);
  const c = await pool.query(`
    UPDATE credit_debit_note SET status = 'Applied', updated_at = now(),
           audit_log = COALESCE(audit_log, '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
             'timestamp', now(), 'user', 'System',
             'action', 'Status corrected to Applied: already netted against its payment'))
     WHERE kind = 'CREDIT' AND active AND status = 'Active' AND payout_id IS NOT NULL`);
  console.log(`\nCorregidos: ${d.rowCount} débitos y ${c.rowCount} créditos a Applied.`);

  const rest = await pool.query(`
    SELECT count(*)::int n, round(SUM(amount),2) m FROM credit_debit_note
     WHERE kind = 'DEBIT' AND active AND status = 'Active'`);
  console.log(`Quedan Active (pendientes DE VERDAD): ${rest.rows[0].n} ($${rest.rows[0].m}).`);
  await pool.end();
})().catch((e) => {
  console.error("FALLA:", e.message);
  process.exit(1);
});
