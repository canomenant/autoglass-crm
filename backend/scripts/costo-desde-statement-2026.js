require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
// Pagos de distribuidor 2026 pagados por statement: la obligación de cada orden toma el precio y el
// número de parte de los renglones de factura clasificados como instalados/accesorio para esa orden
// (regla de Antonio: el costo de la orden es lo que se pagó). Corrige las obligaciones que la
// sincronización creó con el costo estimado o sin número de parte, y deja el subtotal = órdenes.
//   node scripts/costo-desde-statement-2026.js          -> reporte
//   node scripts/costo-desde-statement-2026.js --apply  -> escribe
//   node scripts/costo-desde-statement-2026.js Dist-0334 -> solo ese pago
const fs = require("fs");
const pool = require("../src/config/db");
const APPLY = process.argv.includes("--apply");
const SOLO = process.argv.find((a) => /^Dist-\d+$/.test(a));
const ACTOR = "Costo desde statement 2026 (2026-09-06)";
const money = (n) => Math.round(Number(n || 0) * 100) / 100;
const fmt = (n) => money(n).toFixed(2);
(async () => {
  const lots = (await pool.query(`SELECT o.id, o.payment_number pn, o.payment_date::text d, o.total_amount::float t, o.subtotal::float s, o.debit_notes_total::float dn, o.credit_notes_total::float cn, o.bonus::float b, o.deductions::float de,
      (SELECT COALESCE(sum(amount),0)::float FROM payable WHERE payout_id=o.id) ob
    FROM payouts o WHERE o.type='DISTRIBUTOR' AND o.active<>false AND o.payment_date>='2026-01-01' ${SOLO ? "AND o.payment_number=$1" : ""}
      AND EXISTS (SELECT 1 FROM distributor_statement s WHERE s.payout_id=o.id AND s.active) ORDER BY o.payment_date`, SOLO ? [SOLO] : [])).rows;
  const desc = lots.filter((L) => Math.abs(L.ob - L.s) > 0.005);
  console.log(`pagos 2026 con statements: ${lots.length} | con órdenes ≠ subtotal: ${desc.length}`);
  const cambios = []; let lotesOk = 0;
  for (const L of desc) {
    const ob = (await pool.query("SELECT q.id, q.work_order_no wo, q.amount::float a, q.part_number part, w.part_number wpart FROM payable q JOIN work_orders w ON w.work_order_no=q.work_order_no WHERE q.payout_id=$1 AND q.kind='DISTRIBUTOR' ORDER BY w.appointment_date, q.id", [L.id])).rows;
    const ln = (await pool.query("SELECT l.work_order_no wo, l.part_number part, l.amount::float a, l.classification cl FROM distributor_statement s JOIN distributor_statement_line l ON l.statement_id=s.id WHERE s.payout_id=$1 AND s.active AND l.work_order_no IS NOT NULL AND l.classification IN ('INSTALLED','ACCESSORY') AND l.amount > 0", [L.id])).rows;
    const porWo = {}; for (const l of ln) { (porWo[l.wo] = porWo[l.wo] || []).push(l); }
    const wosOb = {}; for (const o of ob) { (wosOb[o.wo] = wosOb[o.wo] || []).push(o); }
    let sinLineas = [], sinObl = Object.keys(porWo).filter((wo) => !wosOb[wo]);
    const plan = [];
    for (const [wo, obs] of Object.entries(wosOb)) {
      const lines = porWo[wo];
      if (!lines) { sinLineas.push(...obs); continue; }
      const total = money(lines.reduce((s, l) => s + l.a, 0));
      const partes = [...new Set(lines.map((l) => l.part))].join(" + ");
      const actual = money(obs.reduce((s, o) => s + o.a, 0));
      // una obligación por orden: la primera toma el total de la factura y las demás (si las había) se borran
      plan.push({ wo, keep: obs[0], drop: obs.slice(1), total, partes, actual });
    }
    const nuevoSub = money(plan.reduce((s, p) => s + p.total, 0) + sinLineas.reduce((s, o) => s + o.a, 0));
    const cierra = Math.abs(nuevoSub - L.s) < 0.005 && !sinObl.length;
    console.log(`\n${L.pn} ${L.d} pagado $${fmt(L.t)} | subtotal (facturas) $${fmt(L.s)} | órdenes hoy $${fmt(L.ob)} -> con precio de factura $${fmt(nuevoSub)} ${cierra ? "CIERRA" : "NO CIERRA"}`);
    for (const p of plan.filter((p) => Math.abs(p.total - p.actual) > 0.005 || !p.keep.part || p.drop.length)) console.log(`   ${p.wo} ${(p.keep.part || "(sin pieza)").padEnd(22)} $${fmt(p.actual).padStart(8)} -> ${p.partes.padEnd(30)} $${fmt(p.total).padStart(8)}`);
    if (sinLineas.length) console.log(`   sin renglón de factura en este pago (se dejan igual): ${sinLineas.map((o) => o.wo + " $" + fmt(o.a)).join(", ")}`);
    if (sinObl.length) console.log(`   renglones con orden que no está en el pago: ${sinObl.join(", ")}`);
    if (cierra) { lotesOk++; cambios.push({ L, plan }); }
  }
  console.log(`\n${lotesOk} de ${desc.length} pagos cierran con el precio de factura`);
  if (!APPLY) { await pool.end(); return; }
  fs.writeFileSync(`backups/costo-statement-2026-respaldo-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify({ payable: (await pool.query("SELECT * FROM payable WHERE payout_id = ANY($1)", [cambios.map((c) => c.L.id)])).rows, payouts: (await pool.query("SELECT * FROM payouts WHERE id = ANY($1)", [cambios.map((c) => c.L.id)])).rows }, null, 1));
  for (const { L, plan } of cambios) {
    for (const p of plan) {
      if (Math.abs(p.total - p.actual) > 0.005 || !p.keep.part || p.drop.length || p.keep.part !== p.partes) {
        await pool.query("UPDATE payable SET amount=$2, part_number=$3, part_description=COALESCE(part_description,'')||$4, updated_at=now() WHERE id=$1", [p.keep.id, p.total, p.partes, Math.abs(p.total - p.actual) > 0.005 ? ` | Precio de factura Mygrant en ${L.pn} (antes $${fmt(p.actual)}, ${ACTOR})` : ""]);
        if (p.drop.length) await pool.query("DELETE FROM payable WHERE id = ANY($1)", [p.drop.map((o) => o.id)]);
        await pool.query("UPDATE work_orders w SET glass_cost=(SELECT COALESCE(sum(amount),0) FROM payable WHERE work_order_no=w.work_order_no AND kind='DISTRIBUTOR'), glass_cost_source='obligaciones', updated_at=now(), updated_by=$2 WHERE work_order_no=$1", [p.wo, ACTOR]);
      }
    }
    await pool.query("UPDATE payouts SET notes=replace(COALESCE(notes,''),'WOs por vincular','WOs vinculadas'), updated_at=now(), updated_by=$2 WHERE id=$1", [L.id, ACTOR]);
    const v = (await pool.query("SELECT subtotal::float s, (SELECT COALESCE(sum(amount),0)::float FROM payable WHERE payout_id=$1) ob FROM payouts WHERE id=$1", [L.id])).rows[0];
    console.log(`  ${L.pn}: órdenes $${fmt(v.ob)} vs subtotal $${fmt(v.s)} ${Math.abs(v.ob - v.s) < 0.005 ? "OK" : "REVISAR"}`);
  }
  await pool.end();
})().catch(async (e) => { console.error(e.stack); try { await pool.end(); } catch {} process.exit(1); });
