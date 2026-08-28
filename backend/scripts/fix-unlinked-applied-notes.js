require("dotenv").config();
const pool = require("../src/config/db");

// Devuelve a "Active" las notas que dicen "Applied" sin estar enlazadas a ningún pago.
//
// De dónde vienen: el botón Apply de la lista cambiaba el estado sin exigir pago (corregido en
// 7bbb8e3 — hoy se niega), y las notas que alcanzaron a pasar por ahí quedaron con el estado
// mentiroso grabado: "aplicadas"… a nada, invisibles en cualquier pago. Aplicada significa
// "ajusta este lote"; sin lote, el estado correcto es Active.
//
// Idempotente: solo toca Applied con payout_id y charge_payout_id vacíos.

const APPLY = process.argv.includes("--apply");

(async () => {
  const r = (await pool.query(
    `SELECT id, note_number, kind, entity_name, amount FROM credit_debit_note
      WHERE active <> false AND status = 'Applied' AND payout_id IS NULL AND charge_payout_id IS NULL`
  )).rows;

  console.log(`Notas "Applied" sin pago enlazado: ${r.length}`);
  r.forEach((x) => console.log(`  ${x.note_number} ${x.kind} ${x.entity_name} $${x.amount}`));

  if (!APPLY) {
    console.log("\nSimulación. Volver a lanzar con --apply para devolverlas a Active.");
    await pool.end();
    return;
  }

  for (const x of r) {
    await pool.query(
      `UPDATE credit_debit_note SET status = 'Active',
          audit_log = COALESCE(audit_log,'[]'::jsonb) || $2::jsonb, updated_at = now()
        WHERE id = $1`,
      [x.id, JSON.stringify([{ user: "System", timestamp: new Date().toISOString(), action: "Status corrected: Applied without linked payment", oldValue: { status: "Applied" }, newValue: { status: "Active" } }])]
    );
  }
  console.log(`\nCorregidas: ${r.length}. Ahora dicen Active, que es la verdad: sin aplicar todavía.`);
  await pool.end();
})().catch((e) => { console.error(e); process.exit(1); });
