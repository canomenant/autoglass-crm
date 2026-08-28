// Numeros de nota unicos: el doble clic en Save creaba dos notas con el mismo numero (DN-0017
// salio dos veces). Este script (1) desactiva las copias duplicadas entre las notas activas —
// conserva la mejor copia de cada numero: la que NO esta Void, o la mas reciente — y (2) crea el
// indice unico parcial que impide que vuelva a pasar. El store reintenta con el siguiente numero
// cuando dos creaciones chocan.
//
//   node scripts/add-note-number-unique-index.js          (solo muestra)
//   node scripts/add-note-number-unique-index.js --apply
//
// Reversa: UPDATE credit_debit_note SET active = true WHERE id = <id>;
//          DROP INDEX uq_credit_debit_note_numero;

require("dotenv").config();
const pool = require("../src/config/db");

const APPLY = process.argv.includes("--apply");

(async () => {
  const dups = await pool.query(`
    SELECT kind, note_number, array_agg(json_build_object('id', id, 'status', status, 'amount', amount, 'created', created_at) ORDER BY id) AS copias
      FROM credit_debit_note
     WHERE active AND note_number IS NOT NULL AND note_number <> ''
     GROUP BY kind, note_number
    HAVING COUNT(*) > 1`);

  const aDesactivar = [];
  for (const d of dups.rows) {
    // Se queda la mejor copia: primero las que no estan Void/Cancelled; a igualdad, la mas nueva.
    const orden = [...d.copias].sort((a, b) => {
      const va = ["Void", "Cancelled"].includes(a.status) ? 1 : 0;
      const vb = ["Void", "Cancelled"].includes(b.status) ? 1 : 0;
      if (va !== vb) return va - vb;
      return new Date(b.created) - new Date(a.created);
    });
    const queda = orden[0];
    for (const c of orden.slice(1)) aDesactivar.push({ ...c, numero: d.note_number, kind: d.kind, quedaId: queda.id });
  }

  if (dups.rows.length === 0) console.log("Sin numeros duplicados entre las notas activas.");
  for (const c of aDesactivar) {
    console.log(`${APPLY ? "DESACTIVANDO" : "desactivaria"} ${c.kind} ${c.numero} id=${c.id} (${c.status}, $${c.amount}) — queda id=${c.quedaId}`);
  }

  if (!APPLY) {
    console.log("\nDry-run. Con --apply desactiva las copias y crea el indice unico.");
    process.exit(0);
  }

  for (const c of aDesactivar) {
    await pool.query(
      `UPDATE credit_debit_note SET active = false, updated_at = now(),
              audit_log = COALESCE(audit_log, '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
                'timestamp', now(), 'user', 'System',
                'action', 'Deactivated duplicate note number (kept id ' || $2 || ')'))
        WHERE id = $1`, [c.id, String(c.quedaId)]);
  }

  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS uq_credit_debit_note_numero
    ON credit_debit_note (kind, note_number) WHERE active`);
  console.log(`\nListo: ${aDesactivar.length} copia(s) desactivada(s), indice unico uq_credit_debit_note_numero creado.`);
  process.exit(0);
})().catch((e) => { console.error("FALLA:", e.message); process.exit(1); });
