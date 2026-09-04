require("dotenv").config();
const fs = require("fs");
const path = require("path");
const pool = require("../src/config/db");
const paymentsStore = require("../src/store/payments.store");

// Cierre 2025: dejar las órdenes con cita en 2025 cuadradas contra lo que de verdad se pagó a
// distribuidores, técnicos y agentes, para el Profit & Loss que Antonio presenta al socio
// (pedido del 4-sep-2026).
//
//   node scripts/cerrar-2025.js            -> solo reporta
//   node scripts/cerrar-2025.js --apply    -> respalda y aplica
//
// Lo que corrige (con datos que ya están en la base o en el export de AppSheet):
//   1. El costo de vidrio de la orden pasa a ser lo que se le pagó al distribuidor por ella.
//      El P&L lee glass_cost; la obligación dice lo pagado. 312 órdenes difieren, casi todas
//      por clips y uretano que Mygrant facturó junto con el vidrio.
//   2. Obligaciones de distribuidor en $0, sin parte y sin distribuidor: ruido del import de
//      AppSheet (órdenes sin parte comprada). Se borran para que no cuenten como pendientes.
//   3. Piezas que el técnico puso de su bolsa ("Tech Part") y que ya se le devolvieron en un
//      lote de técnico (parts_return), pero nunca se amarraron. Se enlazan cuando las piezas
//      pendientes del técnico dentro del periodo del lote suman exactamente lo devuelto.
//   4. Tech-0035: AppSheet dice labor 1,040 + bono 64 = 1,104 pagados y cero efectivo; el import
//      lo dejó con efectivo 1,104 y total $0.
// Lo que NO puede resolver solo se lista al final para que Antonio decida.

const APPLY = process.argv.includes("--apply");
const ACTOR = "Cierre 2025 (2026-09-04)";
const A = "2025-01-01", B = "2026-01-01";
const money = (n) => Math.round(Number(n || 0) * 100) / 100;
const fmt = (n) => money(n).toFixed(2);
const eq = (a, b) => Math.abs(money(a) - money(b)) < 0.005;
const informe = [];
function log(...a) { const s = a.join(" "); informe.push(s); console.log(s); }
function titulo(t) { log("\n" + "=".repeat(78) + "\n" + t + "\n" + "=".repeat(78)); }

async function respaldar() {
  const dir = path.join(__dirname, "..", "backups");
  fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const out = {};
  out.work_orders = (await pool.query("SELECT id, work_order_no, glass_cost, updated_at, updated_by FROM work_orders WHERE active<>false AND appointment_date>=$1 AND appointment_date<$2", [A, B])).rows;
  out.payable = (await pool.query("SELECT * FROM payable WHERE kind='DISTRIBUTOR'")).rows;
  out.payouts = (await pool.query("SELECT * FROM payouts WHERE type='TECHNICIAN' AND (parts_return>0 OR payment_number='Tech-0035')")).rows;
  const file = path.join(dir, `cierre-2025-${stamp}.json`);
  fs.writeFileSync(file, JSON.stringify(out));
  log(`Respaldo escrito: ${file} (${out.work_orders.length} órdenes, ${out.payable.length} obligaciones, ${out.payouts.length} lotes)`);
}

// ---------------------------------------------------------------------------------------------
async function paso1_costoVidrio() {
  titulo("1. Costo de vidrio de la orden = lo pagado al distribuidor");
  const r = await pool.query(`
    WITH o AS (SELECT work_order_no, sum(amount)::numeric ob, count(*) FILTER (WHERE payout_id IS NULL AND amount>0)::int pend
                 FROM payable WHERE kind='DISTRIBUTOR' GROUP BY work_order_no)
    SELECT w.id, w.work_order_no, w.appointment_date::text fecha, w.glass_cost::numeric costo, o.ob, o.pend
      FROM work_orders w JOIN o ON o.work_order_no=w.work_order_no
     WHERE w.active<>false AND w.status<>'Cancelled' AND w.appointment_date>=$1 AND w.appointment_date<$2
       AND abs(o.ob - COALESCE(w.glass_cost,0)) > 0.005
     ORDER BY w.appointment_date`, [A, B]);
  let sube = 0, baja = 0, dSube = 0, dBaja = 0;
  for (const x of r.rows) {
    const d = money(Number(x.ob) - Number(x.costo));
    if (d > 0) { sube++; dSube += d; } else { baja++; dBaja += d; }
  }
  log(`  ${r.rows.length} órdenes: ${sube} suben (+$${fmt(dSube)}), ${baja} bajan ($${fmt(dBaja)}); neto $${fmt(dSube + dBaja)}`);
  for (const x of r.rows.filter((x) => Math.abs(Number(x.ob) - Number(x.costo)) > 50)) log(`     ${x.work_order_no} ${x.fecha} costo $${fmt(x.costo)} -> $${fmt(x.ob)} (diferencia mayor a $50)`);
  if (APPLY) {
    for (const x of r.rows) {
      await pool.query(
        `UPDATE work_orders SET glass_cost = $2, glass_cost_source = 'obligaciones', updated_at = now(), updated_by = $3 WHERE id = $1`,
        [x.id, money(x.ob), ACTOR]);
    }
    log(`  -> ${r.rows.length} órdenes actualizadas`);
  }
  return r.rows.length;
}

// ---------------------------------------------------------------------------------------------
async function paso2_obligacionesVacias() {
  titulo("2. Obligaciones de distribuidor en $0 sin parte ni distribuidor (ruido del import)");
  const r = await pool.query(`
    SELECT pb.id, pb.work_order_no, pb.party, pb.source FROM payable pb
     WHERE pb.kind='DISTRIBUTOR' AND pb.payout_id IS NULL AND pb.amount = 0
       AND btrim(COALESCE(pb.part_number,'')) = ''
       AND btrim(COALESCE(pb.party,'')) IN ('', 'Tech Part')`);
  const porParty = {};
  for (const x of r.rows) porParty[x.party || "(en blanco)"] = (porParty[x.party || "(en blanco)"] || 0) + 1;
  log(`  ${r.rows.length} obligaciones: ${Object.entries(porParty).map(([k, v]) => `${k} ${v}`).join(", ")}`);
  if (APPLY && r.rows.length) await pool.query("DELETE FROM payable WHERE id = ANY($1::bigint[]) AND payout_id IS NULL AND amount = 0", [r.rows.map((x) => x.id)]);
  return r.rows.length;
}

// ---------------------------------------------------------------------------------------------
// Un servicio (Chip Repair, Labor, Delivery Surcharge) no instala pieza: AppSheet lo traía con
// "Tech Part" como distribuidor, y de ahí salían órdenes y líneas de cotización con distribuidor
// pero sin parte ni costo (Wo-0308, visto por Antonio el 4-sep-2026). Se limpia el distribuidor
// en la línea y en la cabecera de la orden cuando no hay parte ni precio de parte.
async function paso2b_serviciosSinParte() {
  titulo("2b. Servicios con 'Tech Part' como distribuidor (sin parte ni costo)");
  const raw = (await pool.query("SELECT value FROM app_data WHERE key = 'jobTypes.json'")).rows[0]?.value || [];
  const tipos = Array.isArray(raw) ? raw : JSON.parse(raw);
  const servicios = new Set(tipos.filter((j) => j.type === "Services").map((j) => j.name));
  const q = await pool.query(`
    SELECT q.id, q.quote_no, q.line_items FROM quotes q
     WHERE q.active<>false AND EXISTS (SELECT 1 FROM jsonb_array_elements(q.line_items) li
       WHERE li->>'distributor' ILIKE '%tech part%' AND btrim(COALESCE(li->>'partNumber','')) = ''
         AND COALESCE(NULLIF(li->>'pricePart','')::numeric,0) = 0)`);
  let lineas = 0, cotizaciones = 0;
  for (const c of q.rows) {
    let cambio = false;
    const items = (c.line_items || []).map((li) => {
      const esServicio = servicios.has(li.jobType) || !String(li.jobType || "").trim();
      if (/tech part/i.test(li.distributor || "") && !String(li.partNumber || "").trim() && Number(li.pricePart || 0) === 0 && esServicio) {
        cambio = true; lineas++;
        return { ...li, distributor: "", orderNumber: "" };
      }
      return li;
    });
    if (!cambio) continue;
    cotizaciones++;
    if (APPLY) await pool.query("UPDATE quotes SET line_items = $2::jsonb, updated_at = now() WHERE id = $1", [c.id, JSON.stringify(items)]);
  }
  log(`  Líneas de cotización: ${lineas} en ${cotizaciones} cotizaciones (tipos de servicio: ${[...servicios].join(", ")})`);
  const w = await pool.query(`
    SELECT id, work_order_no, job_type FROM work_orders
     WHERE active<>false AND distributor ILIKE '%tech part%' AND COALESCE(glass_cost,0) = 0 AND btrim(COALESCE(part_number,'')) = ''`);
  const porTipo = w.rows.reduce((a, x) => { a[x.job_type || "?"] = (a[x.job_type || "?"] || 0) + 1; return a; }, {});
  log(`  Órdenes con distribuidor "Tech Part" sin parte ni costo: ${w.rows.length} (${Object.entries(porTipo).map(([k, v]) => k + " " + v).join(", ")})`);
  if (APPLY && w.rows.length) await pool.query("UPDATE work_orders SET distributor = '', updated_at = now(), updated_by = $2 WHERE id = ANY($1::uuid[])", [w.rows.map((x) => x.id), ACTOR]);
  return { lineas, ordenes: w.rows.length };
}

// ---------------------------------------------------------------------------------------------
// Piezas del técnico: por cada lote de técnico con devolución de partes, las piezas pendientes
// de ESE técnico con fecha de trabajo dentro del periodo del lote. Se enlaza solo si un
// subconjunto suma exactamente lo devuelto (n es chico). Lo que no cuadra se reporta.
async function paso3_techPart() {
  titulo("3. Piezas de técnico (Tech Part) devueltas en lotes de técnico pero sin amarrar");
  const lotes = (await pool.query(`
    SELECT po.id, po.payment_number pn, po.payment_date::text d, po.parts_return::float ret, btrim(min(pb.party)) tech,
           min(pb.work_date)::text wmin, max(pb.work_date)::text wmax,
           (SELECT COALESCE(sum(amount),0)::float FROM payable x WHERE x.payout_id=po.id AND x.kind='DISTRIBUTOR') ya
      FROM payouts po JOIN payable pb ON pb.payout_id=po.id AND pb.kind='TECH'
     WHERE po.type='TECHNICIAN' AND po.active<>false AND po.status<>'Cancelled' AND po.parts_return>0
     GROUP BY po.id ORDER BY po.payment_date`)).rows;
  const piezas = (await pool.query(`
    SELECT pb.id, pb.work_order_no, pb.amount::float amt, pb.work_date::text d, btrim(w.tech) tech, pb.part_number
      FROM payable pb JOIN work_orders w ON w.work_order_no=pb.work_order_no
     WHERE pb.kind='DISTRIBUTOR' AND btrim(pb.party)='Tech Part' AND pb.payout_id IS NULL AND pb.amount>0
     ORDER BY pb.work_date`)).rows;
  // Las piezas "CANO PART" de 2025 son de Antonio Cano aunque la orden sea de otro técnico
  // (él compró la pieza, otro la instaló). Van a su lote anual Tech-0211, que Antonio pidió
  // dejar abierto (4-sep-2026) para aplicarle lo que vaya llegando. Aquí solo se reservan.
  const CANO_2025 = new Set(["Wo-0027","Wo-0079","Wo-0192","Wo-0279","Wo-0283","Wo-0485","Wo-0514","Wo-0523","Wo-0601","Wo-0684","Wo-0758","Wo-0837","Wo-0857","Wo-0863","Wo-0922","Wo-0991","Wo-1266","Wo-1362","Wo-1425","Wo-1771","Wo-1832","Wo-2049","Wo-2052","Wo-2110","Wo-2305","Wo-2446","Wo-2454","Wo-2545"]);
  const usadas = new Set(piezas.filter((x) => CANO_2025.has(x.work_order_no)).map((x) => x.id));
  log(`  Reservadas para Tech-0211 (Antonio Cano, lote abierto): ${usadas.size} piezas ${fmt(piezas.filter((x) => usadas.has(x.id)).reduce((s, x) => s + x.amt, 0))}`);
  let enlazados = 0, monto = 0, n = 0;
  const sinCuadre = [];
  for (const L of lotes) {
    const falta = money(L.ret - L.ya);
    if (falta <= 0 || L.pn === "Tech-0211") continue;
    const cand = piezas.filter((x) => !usadas.has(x.id) && x.tech === L.tech && x.d >= L.wmin && x.d <= L.wmax);
    let sol = null;
    if (cand.length && cand.length <= 22) {
      const T = Math.round(falta * 100);
      (function rec(i, sum, ch) {
        if (sol) return;
        if (sum === T && ch.length) { sol = [...ch]; return; }
        if (i >= cand.length || sum > T) return;
        ch.push(cand[i]); rec(i + 1, sum + Math.round(cand[i].amt * 100), ch); ch.pop();
        rec(i + 1, sum, ch);
      })(0, 0, []);
    }
    if (sol) {
      sol.forEach((x) => usadas.add(x.id));
      enlazados++; n += sol.length; monto += falta;
      log(`  ${L.pn} ${L.d} ${L.tech}: devolvió $${fmt(falta)} = ${sol.map((x) => `${x.work_order_no} $${fmt(x.amt)}`).join(" + ")}`);
      if (APPLY) await paymentsStore.linkObligations(L.id, sol.map((x) => x.id), ACTOR);
    } else {
      sinCuadre.push({ ...L, falta, cand: cand.reduce((s, x) => s + x.amt, 0), ncand: cand.length });
    }
  }
  log(`  -> ${enlazados} lotes, ${n} piezas, $${fmt(monto)} amarrados`);
  log(`  Sin cuadre exacto (${sinCuadre.length} lotes):`);
  for (const L of sinCuadre) log(`     ${L.pn} ${L.d} ${L.tech}: devolvió $${fmt(L.falta)}, piezas pendientes en el periodo ${L.ncand} por $${fmt(L.cand)}`);
  const sueltas = piezas.filter((x) => !usadas.has(x.id));
  const porTech = {};
  for (const x of sueltas) { (porTech[x.tech] = porTech[x.tech] || { n: 0, m: 0 }); porTech[x.tech].n++; porTech[x.tech].m += x.amt; }
  log(`  Piezas que siguen pendientes después de esto: ${sueltas.length} por $${fmt(sueltas.reduce((s, x) => s + x.amt, 0))}`);
  for (const [k, v] of Object.entries(porTech).sort((a, b) => b[1].m - a[1].m)) log(`     ${k}: ${v.n} piezas $${fmt(v.m)}`);
  return { enlazados, n, monto, sueltas: sueltas.length };
}

// ---------------------------------------------------------------------------------------------
async function paso4_tech0035() {
  titulo("4. Tech-0035 (Dung Nguyen, 12-feb-2025)");
  const r = (await pool.query("SELECT id, total_amount, net_amount, base_amount, bonus, cash_advance FROM payouts WHERE payment_number='Tech-0035'")).rows[0];
  if (!r) { log("  no existe"); return; }
  if (eq(r.total_amount, 1104) && eq(r.cash_advance, 0)) { log("  ya está en $1,104.00"); return; }
  log(`  AppSheet: labor 1,040 + bono 64 = 1,104 pagados, efectivo 0. En la base: total $${fmt(r.total_amount)}, efectivo $${fmt(r.cash_advance)} -> total $1,104.00, efectivo $0`);
  if (APPLY) await pool.query(
    `UPDATE payouts SET cash_advance = 0, total_amount = 1104, net_amount = 1104, updated_at = now(), updated_by = $2,
            audit_log = COALESCE(audit_log,'[]'::jsonb) || jsonb_build_array(jsonb_build_object('timestamp', now(), 'user', $2::text, 'action', 'Total corrected from AppSheet BD_PAYMENTTECH (1,040 + 64 bonus, no cash)'))
      WHERE id = $1`, [r.id, ACTOR]);
}

// ---------------------------------------------------------------------------------------------
async function paso5_pendientesDecision() {
  titulo("5. Lo que queda para decidir (no se toca)");
  let r = await pool.query(`
    SELECT pb.kind, btrim(pb.party) party, pb.work_order_no, w.appointment_date::text d, w.customer_name, pb.amount::float amt, pb.part_number
      FROM payable pb JOIN work_orders w ON w.work_order_no=pb.work_order_no
     WHERE pb.payout_id IS NULL AND pb.status<>'pagado' AND pb.amount>0 AND btrim(COALESCE(pb.party,''))<>'Tech Part'
       AND w.active<>false AND w.status<>'Cancelled' AND w.appointment_date>=$1 AND w.appointment_date<$2
     ORDER BY pb.kind, pb.party, w.appointment_date`, [A, B]);
  log(`  a) Pendientes reales de pago de trabajo 2025: ${r.rows.length} por $${fmt(r.rows.reduce((s, x) => s + x.amt, 0))}`);
  for (const x of r.rows) log(`     ${x.kind} ${x.party || "(sin distribuidor)"} ${x.work_order_no} ${x.d} ${x.customer_name || ""} $${fmt(x.amt)} ${x.part_number || ""}`);
  r = await pool.query(`
    SELECT work_order_no, appointment_date::text d, customer_name, tech, glass_cost::float g, labor_cost::float l FROM work_orders
     WHERE active<>false AND status<>'Cancelled' AND appointment_date>=$1 AND appointment_date<$2
       AND COALESCE(NULLIF(payment->>'amount','')::numeric,0)=0 ORDER BY appointment_date`, [A, B]);
  log(`  b) Órdenes cerradas como pagadas con cobro $0: ${r.rows.length} (costo vidrio $${fmt(r.rows.reduce((s, x) => s + x.g, 0))}, labor $${fmt(r.rows.reduce((s, x) => s + x.l, 0))})`);
  for (const x of r.rows) log(`     ${x.work_order_no} ${x.d} ${x.customer_name || ""} (${x.tech || "sin técnico"}) vidrio $${fmt(x.g)} labor $${fmt(x.l)}`);
  r = await pool.query(`SELECT note_number, kind, amount::float amt, entity_name, issue_date::text d, note FROM credit_debit_note WHERE active AND issue_date>=$1 AND issue_date<$2 AND payout_id IS NULL AND charge_payout_id IS NULL ORDER BY issue_date`, [A, B]);
  log(`  c) Notas de 2025 sin aplicar a un lote: ${r.rows.length}`);
  for (const x of r.rows) log(`     ${x.note_number} ${x.kind} $${fmt(x.amt)} ${x.entity_name} ${x.d} — ${(x.note || "").slice(0, 70)}`);
  r = await pool.query(`
    SELECT po.payment_number, po.payment_date::text d, po.total_amount::float tot, po.subtotal::float sub, COALESCE(sum(pb.amount),0)::float ob, count(pb.id)::int n,
           po.debit_notes_total::float dn, po.credit_notes_total::float cn, (SELECT string_agg(DISTINCT btrim(party), ', ') FROM payable WHERE payout_id=po.id) partes
      FROM payouts po LEFT JOIN payable pb ON pb.payout_id=po.id
     WHERE po.type='DISTRIBUTOR' AND po.active<>false AND po.status<>'Cancelled' AND po.payment_date::date>=$1::date AND po.payment_date::date<$2::date
     GROUP BY po.id HAVING abs(COALESCE(sum(pb.amount),0)-po.subtotal)>0.01 OR count(pb.id)=0 ORDER BY po.payment_date`, [A, B]);
  log(`  d) Lotes de distribuidor 2025 cuyo subtotal no es la suma de sus órdenes: ${r.rows.length}`);
  for (const x of r.rows) log(`     ${x.payment_number} ${x.d} pagado $${fmt(x.tot)} subtotal $${fmt(x.sub)} órdenes $${fmt(x.ob)} (${x.n}) déb $${fmt(x.dn)} créd $${fmt(x.cn)} ${x.partes || "(solo nota)"}`);
}

// ---------------------------------------------------------------------------------------------
async function verificacion() {
  titulo("Verificación 2025 después de los cambios");
  const c = async (kind, col) => (await pool.query(`
    WITH w AS (SELECT work_order_no, COALESCE(${col},0)::numeric costo FROM work_orders WHERE active<>false AND status<>'Cancelled' AND appointment_date>=$1 AND appointment_date<$2),
         o AS (SELECT work_order_no, sum(amount)::numeric ob, sum(amount) FILTER (WHERE payout_id IS NOT NULL)::numeric pagado, sum(amount) FILTER (WHERE payout_id IS NULL)::numeric pend FROM payable WHERE kind=$3 GROUP BY 1)
    SELECT sum(w.costo)::float costo, sum(COALESCE(o.ob,0))::float ob, sum(COALESCE(o.pagado,0))::float pagado, sum(COALESCE(o.pend,0))::float pend,
           count(*) FILTER (WHERE o.work_order_no IS NOT NULL AND abs(o.ob-w.costo)>0.01)::int difieren
      FROM w LEFT JOIN o ON o.work_order_no=w.work_order_no`, [A, B, kind])).rows[0];
  const D = await c("DISTRIBUTOR", "glass_cost"), T = await c("TECH", "labor_cost"), G = await c("AGENT", "commission");
  const bon = (await pool.query(`SELECT type, sum(bonus)::float bonus, sum(deductions)::float ded FROM payouts WHERE active<>false AND status<>'Cancelled' AND payment_date::date>=$1::date AND payment_date::date<$2::date AND type IN ('TECHNICIAN','AGENT') GROUP BY 1`, [A, B])).rows;
  const ing = (await pool.query(`SELECT sum(COALESCE(NULLIF(payment->>'amount','')::numeric,0))::float s FROM work_orders WHERE active<>false AND status<>'Cancelled' AND appointment_date>=$1 AND appointment_date<$2`, [A, B])).rows[0].s;
  log(`  Ingresos cobrados            $${fmt(ing)}`);
  log(`  Partes: órdenes $${fmt(D.costo)} | obligaciones $${fmt(D.ob)} | pagado $${fmt(D.pagado)} | pendiente $${fmt(D.pend)} | órdenes que difieren: ${D.difieren}`);
  log(`  Labor:  órdenes $${fmt(T.costo)} | obligaciones $${fmt(T.ob)} | pagado $${fmt(T.pagado)} | pendiente $${fmt(T.pend)} | difieren: ${T.difieren}`);
  log(`  Comisiones: órdenes $${fmt(G.costo)} | obligaciones $${fmt(G.ob)} | pagado $${fmt(G.pagado)} | pendiente $${fmt(G.pend)} | difieren: ${G.difieren}`);
  for (const b of bon) log(`  Bonos ${b.type}: $${fmt(b.bonus)}, deducciones $${fmt(b.ded)} (pagados en lotes de 2025; el P&L por orden no los ve)`);
}

(async () => {
  log(`Cierre 2025 — ${APPLY ? "APLICANDO" : "SOLO REPORTE"} — ${new Date().toISOString()}`);
  if (APPLY) await respaldar();
  await paso1_costoVidrio();
  await paso2_obligacionesVacias();
  await paso2b_serviciosSinParte();
  await paso3_techPart();
  await paso4_tech0035();
  await paso5_pendientesDecision();
  await verificacion();
  const out = path.join(__dirname, "..", "backups", `cierre-2025-informe-${APPLY ? "apply" : "reporte"}-${new Date().toISOString().slice(0, 10)}.txt`);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, informe.join("\n"));
  console.log(`\nInforme guardado en ${out}`);
  await pool.end();
})().catch(async (e) => { console.error("\nERROR:", e.stack || e.message); try { await pool.end(); } catch {} process.exit(1); });
