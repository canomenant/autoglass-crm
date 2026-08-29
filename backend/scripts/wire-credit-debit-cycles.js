require("dotenv").config();
const pool = require("../src/config/db");

// Cierra los ciclos devolución→crédito que quedaron a medio cablear tras la recaptura manual y la
// reactivación en bloque: los créditos capturados a mano (CN-0004..CN-0017 y los 3 de notes.json)
// nacieron sin debit_note_id, y sus notas de débito — reactivadas después — quedaron como
// "RETURNED sin crédito" aunque el crédito existe y está aplicado.
//
// El puente lo dan las notas de crédito RETIRADAS de AppSheet (active=false): conservan su
// note_number = factura Z09… y su debit_note_id original (114/114 verificado). Para cada crédito
// activo sin débito:
//
//   factura del crédito → CN retirada con ese número → su debit_note_id →
//     · si ese débito está ACTIVO: es la pareja (imported, p. ej. ND-0012).
//     · si está retirado (porque duplicaba una captura manual): la pareja es la nota manual
//       DN-#### equivalente (mismo monto y misma parte, la regla del reactivador).
//
// Solo se enlaza si la pareja es inequívoca; con dudas se lista y no se toca. El enlace estampa
// en el débito lo mismo que enlazarDebitResuelta (notes.store): RETURNED / COMPANY / resolved_at,
// sin pisar lo que ya tenga. Ningún monto ni total de pago cambia (debit_note_id no participa en
// recálculos). De paso, CN-0016 — enlazada a su pago pero nunca marcada — pasa a Applied.
//
// --apply para escribir; sin el flag solo simula.
// Reversa: UPDATE credit_debit_note SET debit_note_id = NULL WHERE id = <cn_id>;

const APPLY = process.argv.includes("--apply");
const cents = (n) => Math.round(Number(n || 0) * 100);
const pref = (s) => String(s || "").slice(0, 4).toUpperCase();

(async () => {
  const sueltos = (await pool.query(`
    SELECT id, note_number, amount, part_number, invoice_number, source
      FROM credit_debit_note
     WHERE kind = 'CREDIT' AND active AND status NOT IN ('Void','Cancelled')
       AND debit_note_id IS NULL
     ORDER BY note_number`)).rows;
  const retiradasCN = (await pool.query(`
    SELECT note_number, debit_note_id FROM credit_debit_note
     WHERE kind = 'CREDIT' AND source = 'appsheet' AND NOT active AND debit_note_id IS NOT NULL`)).rows;
  const porFactura = Object.fromEntries(retiradasCN.map((r) => [String(r.note_number || "").trim(), r.debit_note_id]));
  const debitos = (await pool.query(`
    SELECT d.id, d.note_number, d.amount, d.part_number, d.active, d.source,
           cr.note_number AS ya_resuelta_por
      FROM credit_debit_note d
      LEFT JOIN credit_debit_note cr ON cr.debit_note_id = d.id AND cr.kind = 'CREDIT'
           AND cr.active AND cr.status NOT IN ('Void','Cancelled')
     WHERE d.kind = 'DEBIT'`)).rows;
  const debPorId = Object.fromEntries(debitos.map((d) => [d.id, d]));
  const appActivos = debitos.filter((d) => d.active && d.source === "app");

  const plan = [];
  const manuales = [];
  for (const c of sueltos) {
    const inv = String(c.invoice_number || "").trim();
    const dnId = inv ? porFactura[inv] : null;
    if (!dnId) { manuales.push([c.note_number, "$" + c.amount, "sin factura rastreable (inv " + (inv || "—") + ")"]); continue; }
    let target = debPorId[dnId];
    if (target && !target.active) {
      // El débito importado se quedó retirado por duplicar una captura manual: buscar la manual.
      const cand = appActivos.filter((d) => cents(d.amount) === cents(target.amount) && pref(d.part_number) === pref(target.part_number));
      target = cand.length === 1 ? cand[0] : null;
    }
    if (!target) { manuales.push([c.note_number, "$" + c.amount, "pareja ambigua o inexistente (era débito id " + dnId + ")"]); continue; }
    if (target.ya_resuelta_por) { manuales.push([c.note_number, "$" + c.amount, target.note_number + " ya resuelto por " + target.ya_resuelta_por]); continue; }
    const montoIgual = cents(target.amount) === cents(c.amount);
    if (!montoIgual && pref(target.part_number) !== pref(c.part_number)) {
      manuales.push([c.note_number, "$" + c.amount, "monto Y parte distintos de " + target.note_number + " ($" + target.amount + " " + (target.part_number || "") + ")"]);
      continue;
    }
    plan.push({ cn: c, dn: target, nota: montoIgual ? "" : "montos distintos a propósito (crédito bruto vs débito neteado)" });
  }

  console.log("Ciclos a cablear (crédito → su nota de débito):");
  plan.forEach((x) => console.log(`  ${x.cn.note_number} $${x.cn.amount} (inv ${x.cn.invoice_number}) -> ${x.dn.note_number} $${x.dn.amount} ${x.dn.part_number || ""} ${x.nota}`));
  if (manuales.length) {
    console.log("\nQuedan para revisión manual:");
    manuales.forEach((m) => console.log("  " + m.join(" | ")));
  }

  if (!APPLY) {
    console.log("\nSimulación. Volver a lanzar con --apply para escribir.");
    await pool.end();
    return;
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const x of plan) {
      await client.query(
        `UPDATE credit_debit_note SET debit_note_id = $2, updated_at = now(),
                audit_log = COALESCE(audit_log, '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
                  'timestamp', now(), 'user', 'System',
                  'action', 'Wired to debit note ' || $3 || ' (cycle recovered from retired AppSheet link)'))
          WHERE id = $1 AND active AND debit_note_id IS NULL`, [x.cn.id, x.dn.id, x.dn.note_number]);
      await client.query(
        `UPDATE credit_debit_note SET resolution = COALESCE(resolution, 'RETURNED'),
                charged_to_type = COALESCE(charged_to_type, 'COMPANY'),
                resolved_at = COALESCE(resolved_at, now()), resolved_by = COALESCE(resolved_by, 'System'),
                updated_at = now()
          WHERE id = $1 AND active`, [x.dn.id]);
    }
    const cn16 = await client.query(
      `UPDATE credit_debit_note SET status = 'Applied', updated_at = now()
        WHERE kind = 'CREDIT' AND active AND status = 'Active' AND payout_id IS NOT NULL AND note_number = 'CN-0016'
        RETURNING note_number`);
    await client.query("COMMIT");
    console.log(`\nCableados: ${plan.length} ciclos.` + (cn16.rowCount ? " CN-0016 marcada Applied." : ""));
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
