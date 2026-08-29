require("dotenv").config();
const fs = require("fs");
const path = require("path");
const pool = require("../src/config/db");

// Reactiva en bloque las notas de crédito/débito heredadas de AppSheet que blank-appsheet-notes.js
// retiró el 2026-08-28, EXCEPTO lo que Antonio ya recapturó a mano y la lista de revisión 1×1
// (informe del 28-ago). Al reactivar, las de crédito reciben por fin numeración propia:
//
//   - note_number pasa de la factura del distribuidor (Z09…) a un consecutivo CN-#### que continúa
//     el de la app (empieza después del máximo actual), en orden cronológico de emisión.
//   - La factura Z09… se muda a invoice_number, que es donde vive en las notas capturadas a mano.
//
// Las de débito conservan su ND-#### original (ese consecutivo sí venía completo de AppSheet) y no
// chocan con el DN-#### de la app: siguienteNumero() solo cuenta su propio prefijo.
//
// Antonio sigue capturando a mano mientras este script existe, así que las exclusiones NO son
// listas de pagos congeladas: se calculan contra el estado vivo de la base en el momento de correr.
//
//   - CRÉDITOS, por lote completo (regla de blank-appsheet-notes.js: un lote tiene TODAS sus notas
//     activas o ninguna, porque recalculatePayment recompone desde las activas). Para cada pago:
//     hueco = credit_notes_total − suma de CN ya activas. Sus CN importadas entran solo si lo
//     llenan EXACTO al centavo. hueco 0 = ya recapturado a mano, se salta; hueco distinto = ese
//     lote queda para revisión manual y se reporta.
//   - DÉBITOS, uno por uno: se salta la que duplicaría una captura manual (misma cantidad y misma
//     parte —4 primeros caracteres— que una nota DN-#### activa, o mismo cargo con mismo monto en
//     el mismo pago de técnico) y la lista fija de sospechosas del informe.
//
// Ningún total de pago se toca ni se recalcula: los importes ya cuadran (la verificación de abajo
// lo comprueba lote por lote ANTES de escribir). Las CN quedan en status Applied porque eso son:
// el ajuste que su lote ya descontó.
//
// --apply para escribir; sin el flag solo simula. Respaldo JSON antes de tocar nada.
// Reversa: el JSON trae note_number/invoice_number/active/status originales de cada fila.

const APPLY = process.argv.includes("--apply");
const pad = (n) => String(n).padStart(4, "0");
const cents = (n) => Math.round(Number(n || 0) * 100);

// Sospechosas de doble cobro o duplicado — revisar 1×1 (informe 28-ago). Fijas a propósito:
// ninguna regla dinámica puede saber si FW04186 fueron dos vidrios o uno cobrado dos veces.
const DN_REVISION = {
  "ND-0246": "cobrada al tech (Tech-0095) Y acreditada (Dist-0230): doble recuperación",
  "ND-0209": "FW04186 cobrada a Tech-0217; su gemela ND-0245 acreditada",
  "ND-0245": "FW04186 acreditada en Dist-0230; su gemela ND-0209 cobrada",
  "ND-0057": "FW05932 $126 x4 mismo día (Tech-0047)",
  "ND-0254": "FW05932 $126 x4 mismo día (Tech-0048)",
  "ND-0255": "FW05932 $126 x4 mismo día (Tech-0049)",
  "ND-0256": "FW05932 $126 x4 mismo día (Tech-0050)",
  "ND-0047": "marcada Loss pero cobrada a Daniela (Tech-0041)",
  "ND-0081": "marcada Loss pero cobrada a Daniela (Tech-0041)",
  "ND-0061": "DD12393 duplicada con ND-0157, ambas abiertas",
  "ND-0157": "DD12393 duplicada con ND-0061, ambas abiertas",
  "ND-0049": "FW03838 acreditada (Dist-0042); su gemela ND-0052 cobrada a Edwin",
  "ND-0156": "conflicto en Tech-0199: AppSheet dice FW05659 $197.12, a mano se capturó FW04472 $193.87",
  "ND-0068": "vacía", "ND-0266": "vacía", "ND-0267": "vacía", "ND-0268": "vacía", "ND-0269": "vacía",
};
// Y sus créditos: si el débito es sospechoso, su nota de crédito tampoco entra (lote completo).
const PAGOS_REVISION = new Set(["Dist-0230", "Dist-0042"]);

(async () => {
  // --- Candidatas y estado vivo ---
  const cn = (await pool.query(`
    SELECT n.id, n.note_number, n.amount, n.issue_date, n.debit_note_id, po.payment_number
      FROM credit_debit_note n LEFT JOIN payouts po ON po.id = n.payout_id
     WHERE n.source = 'appsheet' AND n.kind = 'CREDIT' AND NOT n.active
     ORDER BY n.issue_date NULLS LAST, n.id`)).rows;
  const dn = (await pool.query(`
    SELECT n.id, n.note_number, n.amount, n.part_number, n.charge_payout_id
      FROM credit_debit_note n
     WHERE n.source = 'appsheet' AND n.kind = 'DEBIT' AND NOT n.active
     ORDER BY n.note_number`)).rows;
  // Lo capturado a mano hasta este momento (para detectar duplicados).
  const manuales = (await pool.query(`
    SELECT amount, part_number, charge_payout_id
      FROM credit_debit_note
     WHERE source = 'app' AND kind = 'DEBIT' AND active AND status NOT IN ('Void','Cancelled')`)).rows;

  // --- CRÉDITOS: regla del hueco, por lote ---
  const porPago = {};
  cn.forEach((c) => { (porPago[c.payment_number || "(sin pago)"] = porPago[c.payment_number || "(sin pago)"] || []).push(c); });
  const lotes = (await pool.query(`
    SELECT po.payment_number, po.credit_notes_total,
           COALESCE((SELECT SUM(x.amount) FROM credit_debit_note x
              WHERE x.payout_id = po.id AND x.kind = 'CREDIT' AND x.active
                AND x.status NOT IN ('Void','Cancelled')), 0) AS activas
      FROM payouts po WHERE po.payment_number = ANY($1)`, [Object.keys(porPago)])).rows;
  const loteInfo = Object.fromEntries(lotes.map((l) => [l.payment_number, l]));

  const cnEntra = [];
  const lotesSaltados = { recapturado: [], revision: [], hueco: [] };
  for (const [pago, notas] of Object.entries(porPago)) {
    const info = loteInfo[pago];
    if (!info) { lotesSaltados.hueco.push({ pago, motivo: "el pago no existe" }); continue; }
    const hueco = cents(info.credit_notes_total) - cents(info.activas);
    const suma = notas.reduce((s, c) => s + cents(c.amount), 0);
    if (PAGOS_REVISION.has(pago)) {
      lotesSaltados.revision.push({ pago, notas, suma });
    } else if (hueco === 0) {
      lotesSaltados.recapturado.push({ pago, notas, suma });
    } else if (hueco === suma) {
      cnEntra.push(...notas);
    } else {
      lotesSaltados.hueco.push({ pago, notas, motivo: `hueco $${(hueco / 100).toFixed(2)} ≠ notas $${(suma / 100).toFixed(2)}` });
    }
  }

  // --- DÉBITOS: una por una ---
  // Si la CN de un débito entra, el débito es obligatorio: son las dos mitades de la misma
  // devolución. El detector de duplicados no les aplica — una molding barata puede repetir monto
  // y parte con una captura manual de OTRO lote sin ser la misma (pasó con WFT $11.29).
  const obligatorias = new Set(cnEntra.map((c) => c.debit_note_id).filter(Boolean));
  const dnEntra = [];
  const dnFuera = [];
  for (const d of dn) {
    if (DN_REVISION[d.note_number]) {
      if (obligatorias.has(d.id)) {
        console.error(`ALTO: ${d.note_number} está en revisión pero su CN entraría — excluir ese lote primero.`);
        process.exit(1);
      }
      dnFuera.push({ ...d, motivo: DN_REVISION[d.note_number] });
      continue;
    }
    if (obligatorias.has(d.id)) { dnEntra.push(d); continue; }
    // (a) mismo pago de técnico y mismo monto = el cargo ya se recapturó en ese pago.
    // (b) solo para débitos SIN cargo asignado: mismo monto y misma parte (4 primeros caracteres)
    //     que una captura manual. No aplica a los que sí tienen cargo: un uretano de $154.50 se
    //     repite legítimamente en pagos distintos y la regla los confundía.
    const dup = manuales.find((m) =>
      (d.charge_payout_id && Number(m.charge_payout_id) === Number(d.charge_payout_id) && cents(m.amount) === cents(d.amount)) ||
      (!d.charge_payout_id && cents(m.amount) === cents(d.amount) &&
        String(m.part_number || "").slice(0, 4).toUpperCase() === String(d.part_number || "").slice(0, 4).toUpperCase() &&
        String(d.part_number || "").length >= 4)
    );
    if (dup) { dnFuera.push({ ...d, motivo: `ya capturada a mano ($${d.amount} ${d.part_number || ""})` }); continue; }
    dnEntra.push(d);
  }

  // Un crédito solo entra completo: si entra la CN, tiene que entrar su nota de débito.
  const dnEntraIds = new Set(dnEntra.map((d) => d.id));
  const rotas = cnEntra.filter((c) => c.debit_note_id && !dnEntraIds.has(c.debit_note_id));
  if (rotas.length) {
    console.error("ALTO: estas CN entrarían sin su nota de débito (revisar exclusiones):");
    rotas.forEach((c) => console.error("  ", c.note_number, "$" + c.amount, "pago", c.payment_number));
    process.exit(1);
  }

  // --- Numeración: continúa el consecutivo de la app, en orden cronológico ---
  const mx = (await pool.query(
    `SELECT COALESCE(MAX(substring(note_number FROM '^CN-(\\d+)$')::int), 0) AS n
       FROM credit_debit_note WHERE kind = 'CREDIT'`)).rows[0].n;
  let siguiente = Number(mx);
  const plan = cnEntra
    .slice()
    .sort((a, b) => (a.issue_date && b.issue_date ? new Date(a.issue_date) - new Date(b.issue_date) : 0) || a.id - b.id)
    .map((c) => ({ ...c, nuevoNumero: `CN-${pad(++siguiente)}` }));

  console.log(`Notas de crédito: entran ${plan.length} de ${cn.length} ($${(plan.reduce((s, c) => s + cents(c.amount), 0) / 100).toFixed(2)}) — reciben CN-${pad(Number(mx) + 1)} a CN-${pad(siguiente)}; su factura Z09… pasa a invoice_number`);
  console.log(`Notas de débito:  entran ${dnEntra.length} de ${dn.length} ($${(dnEntra.reduce((s, d) => s + cents(d.amount), 0) / 100).toFixed(2)}) — conservan su ND-####\n`);

  if (lotesSaltados.recapturado.length) {
    console.log("Lotes que ya recapturaste a mano (sus CN importadas se quedan retiradas):");
    lotesSaltados.recapturado.forEach((l) => console.log(`  ${l.pago}: ${l.notas.length} CN importadas ($${(l.suma / 100).toFixed(2)}) — el lote ya está completo`));
  }
  if (lotesSaltados.revision.length) {
    console.log("\nLotes en revisión 1×1 (no entran):");
    lotesSaltados.revision.forEach((l) => l.notas.forEach((c) => console.log(`  ${l.pago}: ${c.note_number} $${c.amount}`)));
  }
  if (lotesSaltados.hueco.length) {
    console.log("\nLotes donde el hueco NO coincide — revisar a mano:");
    lotesSaltados.hueco.forEach((l) => console.log(`  ${l.pago}: ${l.motivo}`));
  }
  if (dnFuera.length) {
    console.log("\nDébitos que se quedan retirados:");
    dnFuera.forEach((d) => console.log(`  ${d.note_number} $${d.amount} — ${d.motivo}`));
  }

  if (!APPLY) {
    console.log("\nSimulación. Volver a lanzar con --apply para escribir.");
    await pool.end();
    return;
  }

  // --- Respaldo del estado actual de TODO lo importado, para reversa exacta ---
  const backup = (await pool.query(`
    SELECT id, kind, note_number, invoice_number, active, status
      FROM credit_debit_note WHERE source = 'appsheet' ORDER BY id`)).rows;
  const file = path.join(__dirname, `reactivate-appsheet-notes-backup-${new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)}.json`);
  fs.writeFileSync(file, JSON.stringify(backup, null, 2));
  console.log(`\nRespaldo: ${file}`);

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const c of plan) {
      await client.query(
        `UPDATE credit_debit_note
            SET invoice_number = COALESCE(NULLIF(note_number, ''), invoice_number, ''),
                note_number = $2, status = 'Applied', active = true,
                updated_at = now(),
                audit_log = COALESCE(audit_log, '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
                  'timestamp', now(), 'user', 'System',
                  'action', 'Reactivated from AppSheet retirement; numbered ' || $2 || ' (invoice ' || COALESCE(NULLIF(note_number, ''), 'sin factura') || ')'))
          WHERE id = $1 AND NOT active`, [c.id, c.nuevoNumero]);
    }
    const rd = await client.query(
      `UPDATE credit_debit_note
          SET active = true, updated_at = now(),
              audit_log = COALESCE(audit_log, '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
                'timestamp', now(), 'user', 'System', 'action', 'Reactivated from AppSheet retirement'))
        WHERE id = ANY($1) AND NOT active`, [dnEntra.map((d) => d.id)]);

    // --- Candado final DENTRO de la transacción: Antonio puede estar capturando a mano en este
    // mismo momento; si un lote dejó de cuadrar entre la selección y el UPDATE, se revierte todo.
    const check = (await client.query(`
      SELECT po.payment_number, po.credit_notes_total,
             COALESCE(SUM(x.amount), 0) AS notas
        FROM payouts po JOIN credit_debit_note x ON x.payout_id = po.id
       WHERE x.kind = 'CREDIT' AND x.active AND x.status NOT IN ('Void','Cancelled')
         AND po.payment_number = ANY($1)
       GROUP BY po.payment_number, po.credit_notes_total`, [plan.map((c) => c.payment_number)])).rows;
    const malos = check.filter((l) => cents(l.notas) !== cents(l.credit_notes_total));
    if (malos.length) {
      malos.forEach((l) => console.error(`  NO CUADRA ${l.payment_number}: notas $${Number(l.notas).toFixed(2)} vs total $${Number(l.credit_notes_total).toFixed(2)}`));
      throw new Error("un lote dejó de cuadrar durante la escritura — ROLLBACK, no se cambió nada; vuelva a correr el script");
    }
    await client.query("COMMIT");
    console.log(`Reactivadas: ${plan.length} de crédito (renumeradas) y ${rd.rowCount} de débito.`);
    console.log(`Verificación final: ${check.length}/${check.length} lotes cuadran al centavo.`);
  } catch (e) {
    try { await client.query("ROLLBACK"); } catch {}
    throw e;
  } finally {
    client.release();
  }

  console.log("Reversa exacta: el JSON de respaldo trae note_number/invoice_number/active/status originales.");
  await pool.end();
  process.exit(0);
})().catch((e) => {
  console.error("FALLA:", e.message);
  process.exit(1);
});
