require("dotenv").config();
const fs = require("fs");
const path = require("path");
const pool = require("../src/config/db");

// OPCIÓN 1 elegida por Antonio (30-ago-2026), sustituye a la opción 2 de hace un rato: las notas
// heredadas de AppSheet se RETIRAN otra vez (active=false) y en pantalla queda SOLO lo que él
// capturó/aplicó a mano. Es volver al régimen del 27-ago (blank-appsheet-notes), pero conservando
// lo aprendido en el camino:
//
//   SE RETIRA:  las 355 notas heredadas (95 créditos + 260 débitos), restaurando a los créditos
//               su número original (la factura Z09…, que estaba respaldada). Sus vínculos de
//               archivo (payout de créditos, cargos a técnico, ciclo crédito↔débito, Invoice #
//               rellenado) se quedan escritos en las filas retiradas: si algún día vuelven, ya
//               traen todo.
//   SE QUEDA:   todas las notas de Antonio (source app + notes.json) con sus aplicaciones, y las
//               4 heredadas que ÉL aplicó con el panel en Dist-0025 (ND-0015/0016/0017/0028) —
//               esas son decisión suya, no de un script.
//   PROTECCIÓN: legacy_adjustments se reenciende donde el retiro vuelva a dejar heredado sin
//               desglosar, para que ningún recálculo mueva totales históricos.
//
// Respaldo JSON del estado previo (reversa exacta). --apply para escribir; sin el flag simula.

const APPLY = process.argv.includes("--apply");
const RESPALDO_REACTIVACION = path.join(__dirname, "reactivate-appsheet-notes-backup-2026-08-29T04-31-29.json");
const MANTENER = ["ND-0015", "ND-0016", "ND-0017", "ND-0028"]; // el panel de Antonio en Dist-0025

(async () => {
  const original = Object.fromEntries(
    JSON.parse(fs.readFileSync(RESPALDO_REACTIVACION, "utf8")).map((r) => [r.id, r])
  );

  const vivas = (await pool.query(`
    SELECT id, kind, note_number, invoice_number, status, payout_id, charge_payout_id
      FROM credit_debit_note WHERE source = 'appsheet' AND active ORDER BY kind, note_number`)).rows;
  const retirar = vivas.filter((n) => !MANTENER.includes(n.note_number));
  const dejar = vivas.filter((n) => MANTENER.includes(n.note_number));

  console.log(`Heredadas activas hoy: ${vivas.length}. Se retiran ${retirar.length}; se quedan ${dejar.length} (panel de Antonio):`);
  dejar.forEach((n) => console.log(`  QUEDA ${n.note_number} — aplicada por Antonio en su pago`));
  const creditos = retirar.filter((n) => n.kind === "CREDIT");
  console.log(`\nDe las retiradas, ${creditos.length} créditos recuperan su número original (CN-#### → Z09…).`);
  console.log("Muestra:", creditos.slice(0, 5).map((c) => `${c.note_number}→${(original[c.id] || {}).note_number || c.invoice_number}`).join(", "));

  if (!APPLY) {
    console.log("\nSimulación. Volver a lanzar con --apply para escribir.");
    await pool.end();
    return;
  }

  // Respaldo del estado ACTUAL para reversa exacta de este paso.
  const backup = (await pool.query(
    `SELECT id, kind, note_number, invoice_number, active, status, payout_id
       FROM credit_debit_note WHERE source = 'appsheet' ORDER BY id`)).rows;
  const file = path.join(__dirname, `opcion1-backup-${new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)}.json`);
  fs.writeFileSync(file, JSON.stringify(backup, null, 2));
  console.log(`\nRespaldo: ${file}`);

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const n of retirar) {
      const orig = original[n.id] || {};
      // Los créditos vuelven a llamarse por su factura (número original); el Invoice # rellenado
      // se conserva en su campo. Débitos conservan su ND-#### de siempre.
      const numero = n.kind === "CREDIT" && orig.note_number ? orig.note_number : n.note_number;
      const status = orig.status || n.status;
      await client.query(
        `UPDATE credit_debit_note SET active = false, note_number = $2, status = $3, updated_at = now(),
                audit_log = COALESCE(audit_log, '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
                  'timestamp', now(), 'user', 'Antonio Cano',
                  'action', 'Retired again (option 1, 30-Aug-2026): Antonio captures and applies notes manually'))
          WHERE id = $1`, [n.id, numero, status]);
    }
    // Protección donde el retiro vuelva a dejar heredado sin desglosar.
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
    console.log(`Retiradas: ${retirar.length}. Protección encendida en ${on.rowCount} pagos más.`);
  } catch (e) {
    try { await client.query("ROLLBACK"); } catch {}
    throw e;
  } finally {
    client.release();
  }

  const fin = await pool.query(`
    SELECT (SELECT count(*) FROM credit_debit_note WHERE active AND kind='DEBIT' AND status NOT IN ('Void','Cancelled'))::int debitos,
           (SELECT count(*) FROM credit_debit_note WHERE active AND kind='CREDIT' AND status NOT IN ('Void','Cancelled'))::int creditos,
           (SELECT count(*) FROM payouts WHERE legacy_adjustments AND active <> false)::int protegidos`);
  console.log("Estado final:", JSON.stringify(fin.rows[0]));
  console.log("Reversa: el JSON de respaldo trae el estado exacto previo de cada fila.");
  await pool.end();
})().catch((e) => {
  console.error("FALLA:", e.message);
  process.exit(1);
});
