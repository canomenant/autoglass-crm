// Cierra el hueco que dejo el duplicado de DN-0017: la copia doble conto en el numerador (que
// contaba filas) y la siguiente nota salio como DN-0019 sin que existiera DN-0018. Renombra
// DN-0019 -> DN-0018. El numero es solo la etiqueta visible; los enlaces (pago, cargo, credito)
// van por id y no se tocan.
//
//   node scripts/renumber-dn-0019-to-0018.js          (solo muestra)
//   node scripts/renumber-dn-0019-to-0018.js --apply
//
// Reversa: UPDATE credit_debit_note SET note_number='DN-0019' WHERE id=<id>;

require("dotenv").config();
const pool = require("../src/config/db");

const APPLY = process.argv.includes("--apply");

(async () => {
  const libre = await pool.query(
    "SELECT 1 FROM credit_debit_note WHERE kind='DEBIT' AND note_number='DN-0018' AND active");
  if (libre.rows.length) { console.log("DN-0018 ya existe activa; nada que hacer."); process.exit(0); }

  const r = await pool.query(
    "SELECT id, status, amount FROM credit_debit_note WHERE kind='DEBIT' AND note_number='DN-0019' AND active");
  if (r.rows.length !== 1) { console.log(`Esperaba 1 DN-0019 activa, hay ${r.rows.length}; no toco nada.`); process.exit(1); }
  const n = r.rows[0];
  console.log(`${APPLY ? "RENOMBRANDO" : "renombraria"} DN-0019 (id=${n.id}, ${n.status}, $${n.amount}) -> DN-0018`);

  if (!APPLY) { console.log("\nDry-run. Con --apply renombra."); process.exit(0); }

  await pool.query(
    `UPDATE credit_debit_note SET note_number='DN-0018', updated_at=now(),
        audit_log = COALESCE(audit_log, '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
          'timestamp', now(), 'user', 'System',
          'action', 'Renumbered DN-0019 -> DN-0018 (gap left by duplicate DN-0017)'))
      WHERE id=$1`, [n.id]);
  console.log("Listo.");
  process.exit(0);
})().catch((e) => { console.error("FALLA:", e.message); process.exit(1); });
