require("dotenv").config();
const fs = require("fs");
const path = require("path");
const pool = require("../src/config/db");

// Enlaza notas de débito heredadas de AppSheet al pago de distribuidor donde se facturaron —
// SOLO cuando la asignación es matemáticamente única.
//
// AppSheet no guardó ese vínculo (BD_WORKORDER_DETAIL pierde ID_PAYMENTDISTRIBUTOR cuando la
// línea se vuelve nota de débito), pero sí dejó el TOTAL de débitos de cada pago (la columna
// BONUS del CSV, hoy payouts.debit_notes_total). Este script busca, por pago, el subconjunto de
// débitos sueltos del mismo distribuidor (partes del lote, emitidos hasta 60 días después de la
// fecha del pago — las fechas de AppSheet son de captura, no de facturación: ND-0309 se capturó
// 6 días después del pago que la facturó) cuya suma sea EXACTAMENTE el hueco:
//
//     hueco = debit_notes_total − débitos ya enlazados al pago
//
// y lo enlaza únicamente si existe UNA SOLA combinación posible (conteo por programación
// dinámica). Si hay dos o más combinaciones que suman lo mismo, no se adivina: ese pago queda
// para asignación manual (View/Edit de la nota → Related Payment). Los pagos se procesan en
// orden cronológico y cada nota enlazada sale del pool, lo que a su vez vuelve únicos a pagos
// posteriores.
//
// El enlace pone payout_id y status Applied — igual que una nota capturada a mano y neteada en
// su lote. No se recalcula nada: la suma queda idéntica al total que el pago ya descontaba, y la
// verificación DENTRO de la transacción lo comprueba pago por pago (si Antonio capturó algo en
// paralelo y un hueco cambió, ROLLBACK de todo).
//
// --apply para escribir; sin el flag solo simula. Respaldo JSON antes de tocar nada.
// Reversa: UPDATE credit_debit_note SET payout_id = NULL, status = 'Active' WHERE id = <id>;

const APPLY = process.argv.includes("--apply");
const cents = (n) => Math.round(Number(n || 0) * 100);
const masDias = (f, d) => { const x = new Date(f); x.setDate(x.getDate() + d); return x.toISOString().slice(0, 10); };
const VENTANA_DIAS = 60;

// count[s] con tope en 2: solo interesa si hay 0, 1 o varias combinaciones.
function contar(cands, gap) {
  const count = new Float64Array(gap + 1);
  count[0] = 1;
  for (const c of cands) {
    const a = cents(c.amount);
    if (a > gap) continue;
    for (let s = gap; s >= a; s--) if (count[s - a]) count[s] = Math.min(2, count[s] + count[s - a]);
  }
  return count[gap];
}

function resolverUnico(cands, gap) {
  if (!cands.length || gap <= 0) return { status: "sin" };
  const n = contar(cands, gap);
  if (n === 0) return { status: "sin" };
  if (n > 1) return { status: "multi" };
  // Reconstrucción: prueba nota por nota si el resto sigue teniendo solución.
  const sol = [];
  let resto = gap;
  let pool2 = cands.slice();
  while (resto > 0) {
    let found = null;
    for (let i = 0; i < pool2.length; i++) {
      const a = cents(pool2[i].amount);
      if (a > resto) continue;
      if (contar(pool2.filter((_, j) => j !== i), resto - a) >= 1) { found = i; break; }
    }
    if (found == null) return { status: "sin" };
    sol.push(pool2[found]);
    resto -= cents(pool2[found].amount);
    pool2.splice(found, 1);
  }
  return { status: "unico", sol };
}

async function calcularPlan(client) {
  const pagos = (await client.query(`
    SELECT po.id, po.payment_number, po.payment_date::date::text AS fecha, po.debit_notes_total,
           COALESCE((SELECT SUM(n.amount) FROM credit_debit_note n
             WHERE n.payout_id = po.id AND n.kind = 'DEBIT' AND n.active AND n.status NOT IN ('Void','Cancelled')), 0) AS ya,
           COALESCE((SELECT array_agg(DISTINCT btrim(p.party)) FROM payable p
             WHERE p.payout_id = po.id AND btrim(COALESCE(p.party, '')) <> ''), '{}') AS parties
      FROM payouts po
     WHERE po.type = 'DISTRIBUTOR' AND po.active <> false AND po.debit_notes_total > 0
     ORDER BY po.payment_date, po.id`)).rows
    .map((p) => ({ ...p, gap: cents(p.debit_notes_total) - cents(p.ya) }))
    .filter((p) => p.gap > 0);
  const notas = (await client.query(`
    SELECT id, note_number, amount, entity_name, issue_date::date::text AS fecha
      FROM credit_debit_note
     WHERE kind = 'DEBIT' AND active AND status NOT IN ('Void','Cancelled')
       AND entity_type = 'DISTRIBUTOR' AND payout_id IS NULL AND amount > 0`)).rows;

  const plan = [];
  const stats = { unico: 0, multi: 0, sin: 0, sinCand: 0 };
  const usada = new Set();
  for (const p of pagos) {
    const tope = p.fecha ? masDias(p.fecha, VENTANA_DIAS) : null;
    const cands = notas.filter((x) => !usada.has(x.id)
      && (p.parties || []).includes((x.entity_name || "").trim())
      && (!x.fecha || !tope || x.fecha <= tope));
    if (!cands.length) { stats.sinCand++; continue; }
    const r = resolverUnico(cands, p.gap);
    stats[r.status]++;
    if (r.status === "unico") {
      plan.push({ payoutId: p.id, pago: p.payment_number, gap: p.gap, notas: r.sol });
      r.sol.forEach((x) => usada.add(x.id));
    }
  }
  return { plan, stats, pendientes: pagos.length };
}

(async () => {
  const { plan, stats, pendientes } = await calcularPlan(pool);
  console.log(`Pagos con hueco de débito: ${pendientes} | asignación ÚNICA: ${stats.unico} | ambiguos (quedan manuales): ${stats.multi} | sin combinación: ${stats.sin} | sin candidatas: ${stats.sinCand}\n`);
  for (const x of plan) {
    console.log(`  ${x.pago} $${(x.gap / 100).toFixed(2)} <- ${x.notas.map((n) => `${n.note_number} $${n.amount}`).join(", ")}`);
  }
  console.log(`\nTotal a enlazar: $${(plan.reduce((s, x) => s + x.gap, 0) / 100).toFixed(2)} en ${plan.reduce((s, x) => s + x.notas.length, 0)} notas / ${plan.length} pagos.`);

  if (!APPLY) {
    console.log("\nSimulación. Volver a lanzar con --apply para escribir.");
    await pool.end();
    return;
  }

  const ids = plan.flatMap((x) => x.notas.map((n) => n.id));
  const backup = (await pool.query(
    "SELECT id, note_number, payout_id, status FROM credit_debit_note WHERE id = ANY($1) ORDER BY id", [ids])).rows;
  const file = path.join(__dirname, `link-appsheet-debits-backup-${new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)}.json`);
  fs.writeFileSync(file, JSON.stringify(backup, null, 2));
  console.log(`\nRespaldo: ${file}`);

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // El plan se recalcula DENTRO de la transacción: si Antonio capturó algo desde la simulación,
    // los huecos son otros y el plan de afuera podría estar viejo.
    const vivo = await calcularPlan(client);
    for (const x of vivo.plan) {
      await client.query(
        `UPDATE credit_debit_note
            SET payout_id = $2, status = 'Applied', updated_at = now(),
                audit_log = COALESCE(audit_log, '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
                  'timestamp', now(), 'user', 'System',
                  'action', 'Linked to distributor payment ' || $3 || ' (unique exact match of inherited debit total)'))
          WHERE id = ANY($1) AND payout_id IS NULL AND active`,
        [x.notas.map((n) => n.id), x.payoutId, x.pago]);
    }
    // Candado: cada pago tocado debe quedar con débitos == debit_notes_total exacto.
    const check = (await client.query(`
      SELECT po.payment_number, po.debit_notes_total, COALESCE(SUM(n.amount), 0) AS notas
        FROM payouts po JOIN credit_debit_note n ON n.payout_id = po.id
       WHERE n.kind = 'DEBIT' AND n.active AND n.status NOT IN ('Void','Cancelled') AND po.id = ANY($1)
       GROUP BY po.payment_number, po.debit_notes_total`, [vivo.plan.map((x) => x.payoutId)])).rows;
    const malos = check.filter((l) => cents(l.notas) !== cents(l.debit_notes_total));
    if (malos.length) {
      malos.forEach((l) => console.error(`  NO CUADRA ${l.payment_number}: notas $${Number(l.notas).toFixed(2)} vs total $${Number(l.debit_notes_total).toFixed(2)}`));
      throw new Error("un pago dejó de cuadrar — ROLLBACK, no se cambió nada; vuelva a correr el script");
    }
    await client.query("COMMIT");
    console.log(`Enlazadas: ${vivo.plan.reduce((s, x) => s + x.notas.length, 0)} notas en ${vivo.plan.length} pagos. Verificación: ${check.length}/${check.length} cuadran al centavo.`);
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
