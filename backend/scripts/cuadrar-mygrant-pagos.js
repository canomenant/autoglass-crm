require("dotenv").config();
const fs = require("fs");
const path = require("path");
const pool = require("../src/config/db");
const paymentsStore = require("../src/store/payments.store");
const statementsStore = require("../src/store/statements.store");
const notesStore = require("../src/store/notes.store");
const workordersStore = require("../src/store/workorders.store");

// Cuadre de los pagos a Mygrant que quedaron vacíos (sin órdenes) tras el import de compras con
// tarjeta (ago-2026) y el backfill de statements (3-sep-2026). Pedido de Antonio, 4-sep-2026:
// "que cada pago de Mygrant coincida con sus statements, con sus notas de débito y crédito
// aplicadas", y que el procedimiento quede para cuadrar lotes nuevos en el futuro.
//
//   node scripts/cuadrar-mygrant-pagos.js            -> solo reporta, no escribe nada
//   node scripts/cuadrar-mygrant-pagos.js --apply    -> respalda las filas afectadas y aplica
//
// El orden de los pasos importa: primero se corrigen los datos que harían enlazar mal (renglones
// en la orden equivocada, obligaciones duplicadas o fantasma), luego se amarran statements a
// lotes, luego obligaciones y notas, y al final se deja cada lote con la fórmula del sistema
// cumplida: total = subtotal + débito − crédito, y la lista de facturas sumando el total.
//
// Todo lo que NO se puede resolver con los datos que hay (facturas sin detalle, pagos sin
// statement que cuadre, costos de orden que no coinciden con el renglón) se reporta, no se
// adivina.

const APPLY = process.argv.includes("--apply");
const ACTOR = "Cuadre Mygrant 2026-09-04";
const money = (n) => Math.round(Number(n || 0) * 100) / 100;
const fmt = (n) => money(n).toFixed(2);
const eq = (a, b) => Math.abs(money(a) - money(b)) < 0.005;

const informe = [];
function log(...a) { const s = a.join(" "); informe.push(s); console.log(s); }
function titulo(t) { log("\n" + "=".repeat(78) + "\n" + t + "\n" + "=".repeat(78)); }

async function payoutByNumber(num) {
  const r = await pool.query("SELECT * FROM payouts WHERE payment_number = $1", [num]);
  if (!r.rows[0]) throw new Error(`No existe el lote ${num}`);
  return r.rows[0];
}
async function statementByInvoice(inv) {
  const r = await pool.query("SELECT * FROM distributor_statement WHERE invoice_number = $1 AND active", [inv]);
  if (!r.rows[0]) throw new Error(`No existe el statement ${inv}`);
  return r.rows[0];
}

// ---------------------------------------------------------------------------------------------
// 0. Respaldo de todo lo que se va a tocar (solo con --apply)
// ---------------------------------------------------------------------------------------------
const LOTES = ["Dist-0234", "Dist-0245", "Dist-0248", "Dist-0249", "Dist-0250", "Dist-0251", "Dist-0269", "Dist-0270", "Dist-0272", "Dist-0273", "Dist-0282", "Dist-0283", "Dist-0284", "Dist-0286",
  "Dist-0287", "Dist-0289", "Dist-0290", "Dist-0301", "Dist-0302", "Dist-0303", "Dist-0304", "Dist-0311", "Dist-0318",
  "Dist-0334", "Dist-0337", "Dist-0338"];

// Statements que se amarran a cada lote. Cada grupo cuadra al centavo con lo pagado (solo o
// sumado a lo que el lote ya tenía) y es un paquete coherente: la misma sucursal, semanas
// seguidas. Los de Texas de marzo y abril se resuelven por consulta porque son 19 y 22 facturas.
const ENLACES = [
  { lote: "Dist-0283", invs: ["I04928814-0", "I04928815-0"], nota: "Newport Beach 8-mar-2026" },
  { lote: "Dist-0287", invs: ["I04933075-0", "I04933076-0"], nota: "Newport Beach 15-mar-2026" },
  { lote: "Dist-0290", invs: ["I04947648-0", "I04950632-0", "I04950633-0"], nota: "Newport Beach 29-mar (memo) y 31-mar-2026 + resto de I04947647-0" },
  { lote: "Dist-0303", invs: ["I04983186-0", "I04983187-0"], nota: "Newport Beach 30-abr-2026 (antes en Dist-0302) + resto de I04979032-0", mover: true },
  { lote: "Dist-0234", invs: ["I04883181-0", "I04883182-0"], nota: "Fresno 18-ene-2026" },
  { lote: "Dist-0245", invs: ["I04900730-0", "I04900731-0"], nota: "Newport Beach 8-feb-2026" },
  { lote: "Dist-0250", invs: ["I04914492-0", "I04918763-0", "I04918764-0"], nota: "Windcrest 22-feb y 28-feb-2026" },
  { lote: "Dist-0334", invs: ["I05029261-0", "I05029262-0", "I05029263-0"], nota: "Texas 14-jun-2026 (le faltaba esa semana)" },
  { lote: "Dist-0282", texas: ["2026-03-01", "2026-03-31"], nota: "Texas marzo-2026 completo (Irving, Austin, Windcrest)" },
  { lote: "Dist-0301", texas: ["2026-04-01", "2026-04-30"], nota: "Texas abril-2026 completo (Irving, Austin, Windcrest)" },
];

// Facturas que un lote pagó solo en parte (el statement vive en un solo lote; el resto lo dice
// la lista de facturas del otro).
const PARCIALES = {
  "Dist-0289": { "I04947647-0": 2108.64 },
  "Dist-0290": { "I04947647-0": 1587.81 },
  "Dist-0302": { "I04979032-0": 2961.34 },
  "Dist-0303": { "I04979032-0": 296.87 },
  "Dist-0338": { "I05024764-0": 1415.57 }, // ya traía $1,500 abonados de antes (nota del lote)
};
// Facturas que aparecen en la lista de un lote aunque su statement esté amarrado a otro.
const EXTRAS = { "Dist-0290": ["I04947647-0"], "Dist-0303": ["I04979032-0"] };

async function invoicesDe(e) {
  if (e.invs) return e.invs;
  const r = await pool.query(
    `SELECT invoice_number FROM distributor_statement
      WHERE distributor ILIKE 'Mygrant%' AND active AND status = 'paid' AND issue_date BETWEEN $1 AND $2
        AND (branch ILIKE '%TX%' OR branch IS NULL)
        AND (payout_id IS NULL OR payout_id = (SELECT id FROM payouts WHERE payment_number = $3))
      ORDER BY issue_date, invoice_number`, [e.texas[0], e.texas[1], e.lote]);
  return r.rows.map((x) => x.invoice_number);
}

// Statements que le tocan a un lote: los ya amarrados más los de ENLACES (que en modo reporte
// todavía no lo están), menos los que ENLACES manda a otro lote.
async function statementsDelLote(lote) {
  const propios = (await pool.query("SELECT id, invoice_number FROM distributor_statement WHERE payout_id = $1 AND active", [lote.id])).rows;
  const ajenos = new Set();
  const nuevos = [];
  for (const e of ENLACES) {
    const invs = await invoicesDe(e);
    if (e.lote === lote.payment_number) nuevos.push(...invs);
    else invs.forEach((i) => ajenos.add(i));
  }
  const ids = new Set(propios.filter((s) => !ajenos.has(s.invoice_number)).map((s) => s.id));
  if (nuevos.length) (await pool.query("SELECT id FROM distributor_statement WHERE invoice_number = ANY($1) AND active", [nuevos])).rows.forEach((r) => ids.add(r.id));
  return [...ids];
}

async function respaldar() {
  const dir = path.join(__dirname, "..", "backups");
  fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const out = {};
  out.payouts = (await pool.query("SELECT * FROM payouts WHERE payment_number = ANY($1)", [LOTES])).rows;
  const ids = out.payouts.map((p) => p.id);
  out.statements = (await pool.query(
    "SELECT * FROM distributor_statement WHERE payout_id = ANY($1::int[]) OR distributor ILIKE 'Mygrant%'", [ids])).rows;
  out.lines = (await pool.query(
    "SELECT * FROM distributor_statement_line WHERE statement_id = ANY($1::bigint[])", [out.statements.map((s) => s.id)])).rows;
  out.payable = (await pool.query("SELECT * FROM payable WHERE kind = 'DISTRIBUTOR'")).rows;
  out.notes = (await pool.query("SELECT * FROM credit_debit_note WHERE entity_type = 'DISTRIBUTOR'")).rows;
  const file = path.join(dir, `cuadre-mygrant-${stamp}.json`);
  fs.writeFileSync(file, JSON.stringify(out));
  log(`Respaldo escrito: ${file} (${out.payouts.length} lotes, ${out.statements.length} statements, ${out.lines.length} renglones, ${out.payable.length} obligaciones, ${out.notes.length} notas)`);
}

// ---------------------------------------------------------------------------------------------
// 1. Correcciones puntuales encontradas en la revisión del 4-sep
// ---------------------------------------------------------------------------------------------
async function paso1_correcciones() {
  titulo("1. Correcciones puntuales (renglones en la orden equivocada, obligación fantasma)");

  // a) WKT D1843 $189 del 10-abr (req S73083709-2) se pegó a Wo-3315 por "parte + fecha", pero esa
  //    orden es de Import Glass (Dist-0240). Es de Wo-3431 (John Keck, Explorer 2015, cita 10-abr,
  //    Mygrant Anaheim, con obligación pendiente por exactamente $189).
  // b) DB08316 $85.36 del 21-may (req S73715296-1) está en Wo-3815 (Jeep de Miguel Vargas); la
  //    orden con esa parte es Wo-3816 (Chevrolet C2500 de James Anderson, obligación $85.36).
  const reasignar = [
    { req: "S73083709-2", inv: "I04964210-0", de: "Wo-3315", a: "Wo-3431" },
    { req: "S73715296-1", inv: "I05010230-0", de: "Wo-3815", a: "Wo-3816" },
  ];
  for (const r of reasignar) {
    const l = (await pool.query(
      `SELECT l.id, l.work_order_no, l.amount, l.part_number FROM distributor_statement_line l
         JOIN distributor_statement s ON s.id = l.statement_id WHERE s.invoice_number = $1 AND l.req_no = $2`, [r.inv, r.req])).rows[0];
    if (!l) { log(`  [a/b] ${r.inv} ${r.req}: renglón no encontrado`); continue; }
    if (l.work_order_no === r.a) { log(`  [a/b] ${r.inv} ${r.req} ya está en ${r.a}`); continue; }
    log(`  [a/b] ${r.inv} ${r.req} ${l.part_number} $${fmt(l.amount)}: ${l.work_order_no} -> ${r.a}`);
    if (APPLY) await pool.query(
      "UPDATE distributor_statement_line SET work_order_no = $2, match_source = $3, updated_at = now() WHERE id = $1",
      [l.id, r.a, `reasignado (${ACTOR}) — antes ${l.work_order_no}`]);
  }

  // c) Obligación fantasma #13658: $216.57 "DB08316" en Wo-4117, pagada en Dist-0318, sin ningún
  //    renglón de statement que la respalde. Se borra, y en su lugar entra a Dist-0318 la obligación
  //    real de Wo-3816 ($85.36). El monto pagado de Dist-0318 no cambia.
  const fantasma = (await pool.query("SELECT id, work_order_no, amount, payout_id FROM payable WHERE id = 13658")).rows[0];
  if (fantasma) {
    log(`  [c] borrar obligación fantasma #13658 ${fantasma.work_order_no} $${fmt(fantasma.amount)} (lote ${fantasma.payout_id})`);
    if (APPLY) await pool.query("DELETE FROM payable WHERE id = 13658");
  } else log("  [c] #13658 ya no existe");
  const real = (await pool.query("SELECT id, amount, payout_id FROM payable WHERE id = 11729")).rows[0];
  if (real && !real.payout_id) {
    const d318 = await payoutByNumber("Dist-0318");
    log(`  [c] enlazar #11729 Wo-3816 $${fmt(real.amount)} a Dist-0318`);
    if (APPLY) await paymentsStore.linkObligations(d318.id, [11729], ACTOR);
  }
}

// ---------------------------------------------------------------------------------------------
// 2. Obligaciones duplicadas por el import de statements del 31-ago
// ---------------------------------------------------------------------------------------------
// El import creó una obligación nueva (source statement_mygrant, una por renglón) en vez de reusar
// la de AppSheet, que quedó pendiente. AppSheet las trae POR PARTE (vidrio + clip + moldura), así
// que el duplicado de una orden es el CONJUNTO de pendientes cuya suma iguala lo pagado por
// statement. Solo se borra cuando cuadra al centavo (todas, o un subconjunto); lo demás se reporta.
async function paso2_duplicados() {
  titulo("2. Obligaciones duplicadas (AppSheet/auto pendiente vs statement pagada)");
  const r = await pool.query(`
    SELECT pb.work_order_no, w.part_number AS wo_parts,
           json_agg(json_build_object('id', pb.id, 'amount', pb.amount, 'source', pb.source, 'part', pb.part_number) ORDER BY pb.id)
             FILTER (WHERE pb.payout_id IS NULL AND pb.source <> 'statement_mygrant') AS pendientes,
           COALESCE(SUM(pb.amount) FILTER (WHERE pb.payout_id IS NOT NULL AND pb.source = 'statement_mygrant'), 0) AS pagado_stmt,
           string_agg(pb.part_number, ', ') FILTER (WHERE pb.payout_id IS NOT NULL AND pb.source = 'statement_mygrant') AS partes_stmt
      FROM payable pb LEFT JOIN work_orders w ON w.work_order_no = pb.work_order_no
     WHERE pb.kind = 'DISTRIBUTOR'
       AND pb.work_order_no IN (SELECT work_order_no FROM payable WHERE kind = 'DISTRIBUTOR' AND source = 'statement_mygrant' AND payout_id IS NOT NULL)
     GROUP BY pb.work_order_no, w.part_number
    HAVING count(*) FILTER (WHERE pb.payout_id IS NULL AND pb.source <> 'statement_mygrant') > 0
     ORDER BY 1`);
  // "FW04803 GTY SCM" y "FW04803 GTY" son la misma pieza: el núcleo es el primer token.
  const nucleo = (p) => String(p || "").trim().split(/\s+/)[0].toUpperCase();
  let borrar = [], monto = 0, sinCuadre = [];
  for (const wo of r.rows) {
    const pend = wo.pendientes || [];
    const objetivo = money(wo.pagado_stmt);
    const total = money(pend.reduce((s, x) => s + Number(x.amount), 0));
    const nucleosStmt = new Set(String(wo.partes_stmt || "").split(",").map(nucleo).filter(Boolean));
    let elegidas = null, motivo = `= statement $${fmt(objetivo)}`;
    if (eq(total, objetivo)) elegidas = pend;
    else {
      // subconjunto (n es chico: 1–4 partes por orden)
      const n = pend.length;
      for (let m = 1; m < (1 << n) && !elegidas; m++) {
        const sub = pend.filter((_, i) => m & (1 << i));
        if (eq(sub.reduce((s, x) => s + Number(x.amount), 0), objetivo)) elegidas = sub;
      }
    }
    if (!elegidas && total < objetivo) {
      // Mygrant cobró MÁS que el costo registrado (precio de lista distinto, o AppSheet sin los
      // accesorios). Es la misma pieza si el núcleo del número de parte coincide: la de AppSheet
      // sobra igual — lo que se pagó es lo que dice el statement. Una pieza distinta no se toca.
      const mismaPieza = pend.filter((x) => {
        const nx = nucleo(x.part);
        if (nx) return nucleosStmt.has(nx);
        // auto_sync no trae parte: vale si la orden tiene una sola obligación pendiente y la parte
        // del statement es la de la orden
        return pend.length === 1 && [...nucleosStmt].some((s) => String(wo.wo_parts || "").toUpperCase().includes(s));
      });
      if (mismaPieza.length) { elegidas = mismaPieza; motivo = `misma pieza, statement cobró $${fmt(objetivo)} > $${fmt(total)}`; }
    }
    if (elegidas) {
      borrar.push(...elegidas.map((x) => x.id));
      monto += elegidas.reduce((s, x) => s + Number(x.amount), 0);
      const resto = pend.filter((x) => !elegidas.includes(x));
      log(`  ${wo.work_order_no}: borrar ${elegidas.map((x) => `#${x.id} $${fmt(x.amount)} ${x.part || ""}`).join(", ")} (${motivo})` +
        (resto.length ? ` | quedan pendientes ${resto.map((x) => `#${x.id} $${fmt(x.amount)} ${x.part || ""}`).join(", ")}` : ""));
    } else {
      sinCuadre.push(wo);
      log(`  ${wo.work_order_no}: NO CUADRA — pendientes ${pend.map((x) => `#${x.id} $${fmt(x.amount)} ${x.part || ""}`).join(", ")} vs statement $${fmt(objetivo)} (${wo.partes_stmt})`);
    }
  }
  log(`  -> borrar ${borrar.length} obligaciones duplicadas por $${fmt(monto)}; ${sinCuadre.length} órdenes sin cuadre exacto quedan como están`);
  if (APPLY && borrar.length) await pool.query("DELETE FROM payable WHERE id = ANY($1::bigint[]) AND payout_id IS NULL", [borrar]);
  return sinCuadre;
}

// ---------------------------------------------------------------------------------------------
// 3. Lotes duplicados: el mismo cargo de tarjeta registrado dos veces
// ---------------------------------------------------------------------------------------------
// AppSheet registró el pago con sus órdenes pero sin método; el import de compras con tarjeta
// creó otro lote vacío con el cargo real. Se queda el que tiene las órdenes y hereda del otro lo
// que solo el otro sabía: método, transacción, conciliación, statements, notas y el monto que
// de verdad salió del banco. El de tarjeta se retira (active=false), no se borra.
//   Dist-0270 -> Dist-0249 (23-abr-2026, $4,695.01, mismo monto)
//   Dist-0269 -> Dist-0248 (Windcrest feb-2026): AppSheet $1,121.53, tarjeta $1,003.38 = menos memo $118.15
//   Dist-0272 -> Dist-0251 (Fresno feb-2026): AppSheet $4,085.67, tarjeta $4,976.80 = más cargos $890.21
const FUSIONES = [
  { tarjeta: "Dist-0270", queda: "Dist-0249" },
  { tarjeta: "Dist-0269", queda: "Dist-0248" },
  { tarjeta: "Dist-0272", queda: "Dist-0251" },
];
async function paso3_duplicados() {
  titulo("3. Lotes duplicados (AppSheet + import de tarjeta)");
  for (const f of FUSIONES) {
    const a = await payoutByNumber(f.queda);
    const b = await payoutByNumber(f.tarjeta);
    if (b.active === false) { log(`  ${f.tarjeta} ya está retirado en ${f.queda}`); continue; }
    const ob = (await pool.query("SELECT count(*)::int n, COALESCE(sum(amount),0)::float s FROM payable WHERE payout_id = $1", [a.id])).rows[0];
    const st = (await pool.query("SELECT count(*)::int n FROM distributor_statement WHERE payout_id = $1 AND active", [b.id])).rows[0].n;
    const nn = (await pool.query("SELECT count(*)::int n FROM credit_debit_note WHERE payout_id = $1", [b.id])).rows[0].n;
    if (!eq(ob.s, b.subtotal)) { log(`  ${f.queda}: sus obligaciones ($${fmt(ob.s)}) no son el subtotal de ${f.tarjeta} ($${fmt(b.subtotal)}); no se fusiona`); continue; }
    log(`  ${f.queda} (AppSheet $${fmt(a.total_amount)}, ${ob.n} órdenes) absorbe ${f.tarjeta} (tarjeta $${fmt(b.total_amount)}, ${st} statements, ${nn} notas): total pasa a $${fmt(b.total_amount)}`);
    if (!APPLY) continue;
    const nota = `${a.notes ? a.notes + " | " : ""}Fusionado con ${f.tarjeta} (${ACTOR}): mismo cargo de tarjeta registrado dos veces (AppSheet + import de compras). Método, transacción, conciliación, statements, notas y monto pagado vienen de ${f.tarjeta}.`;
    await pool.query(
      `UPDATE payouts SET payment_method = COALESCE(NULLIF(payment_method, ''), $2), transactions = $3::jsonb,
              reconciled_at = COALESCE(reconciled_at, $4), reconciled_by = COALESCE(reconciled_by, $5), notes = $6,
              total_amount = $8, net_amount = $8, subtotal = $9, base_amount = $9, debit_notes_total = $10, credit_notes_total = $11,
              invoices = CASE WHEN jsonb_array_length(COALESCE(invoices,'[]'::jsonb)) = 0 THEN $12::jsonb ELSE invoices END,
              invoice_total = CASE WHEN jsonb_array_length(COALESCE(invoices,'[]'::jsonb)) = 0 THEN $13 ELSE invoice_total END,
              audit_log = COALESCE(audit_log, '[]'::jsonb) || jsonb_build_array(jsonb_build_object('timestamp', now(), 'user', $7::text, 'action', 'Merged duplicate ' || $14 || ' into this payment')),
              updated_at = now(), updated_by = $7
        WHERE id = $1`,
      [a.id, b.payment_method, JSON.stringify(b.transactions || []), b.reconciled_at, b.reconciled_by, nota, ACTOR,
        money(b.total_amount), money(b.subtotal), money(b.debit_notes_total), money(b.credit_notes_total),
        JSON.stringify(b.invoices || []), money(b.invoice_total), f.tarjeta]);
    await pool.query("UPDATE distributor_statement SET payout_id = $2, updated_at = now() WHERE payout_id = $1", [b.id, a.id]);
    await pool.query("UPDATE credit_debit_note SET payout_id = $2, updated_at = now() WHERE payout_id = $1", [b.id, a.id]);
    await pool.query(
      `UPDATE payouts SET active = false, deleted_at = now(), notes = COALESCE(notes, '') || $2,
              audit_log = COALESCE(audit_log, '[]'::jsonb) || jsonb_build_array(jsonb_build_object('timestamp', now(), 'user', $3::text, 'action', 'Retired as duplicate of ' || $4)),
              updated_at = now(), updated_by = $3
        WHERE id = $1`,
      [b.id, ` | Retirado (${ACTOR}): duplicado de ${f.queda}, mismo cargo de tarjeta.`, ACTOR, f.queda]);
  }
}

// ---------------------------------------------------------------------------------------------
// 4. Órdenes de Dist-0338 sin distribuidor: sin él nunca nació la obligación
// ---------------------------------------------------------------------------------------------
// Se les pone el distribuidor que dice el statement (Newport Beach = Mygrant Anaheim) y el sync
// de la orden crea la obligación con el costo de vidrio de la orden. Un costo en $0 se completa
// con el renglón; uno distinto de cero no se toca y la diferencia se reporta.
async function paso4_ordenesSinDistribuidor() {
  titulo("4. Órdenes de statements Mygrant sin distribuidor en la orden (sin obligación)");
  const r = await pool.query(`
    SELECT l.work_order_no, w.id AS wo_id, w.distributor, w.glass_cost, s.branch, o.payment_number,
           SUM(l.amount) FILTER (WHERE l.classification = 'INSTALLED') AS instalado,
           string_agg(l.part_number || ' $' || l.amount::text || ' ' || l.classification, ', ') AS renglones
      FROM distributor_statement_line l
      JOIN distributor_statement s ON s.id = l.statement_id
      JOIN payouts o ON o.id = s.payout_id
      JOIN work_orders w ON w.work_order_no = l.work_order_no AND w.active <> false
     WHERE s.distributor ILIKE 'Mygrant%' AND o.payment_number = ANY($1)
       AND NOT EXISTS (SELECT 1 FROM payable pb WHERE pb.kind = 'DISTRIBUTOR' AND pb.work_order_no = l.work_order_no)
     GROUP BY 1, 2, 3, 4, 5, 6 ORDER BY 1`, [LOTES]);
  // La sucursal del statement dice quién vendió la parte. Sin sucursal conocida no se adivina.
  const porSucursal = {
    "Newport Beach": "Mygrant Anaheim", "Fresno": "Mygrant Hayward",
    "Irving, TX": "Mygrant Irving", "Austin, TX": "Mygrant Austin", "Windcrest, TX": "Mygrant San Antonio",
  };
  const difieren = [];
  for (const x of r.rows) {
    const dist = porSucursal[String(x.branch || "").replace(/s+d{5}$/, "")];
    if (!dist) { log(`  ${x.work_order_no} (${x.payment_number}): sucursal "${x.branch || "?"}" sin distribuidor conocido — se deja para revisar [${x.renglones}]`); continue; }
    const costo = money(x.glass_cost);
    const renglon = money(x.instalado);
    if (!renglon) { log(`  ${x.work_order_no} (${x.payment_number}): solo devoluciones/cargos, sin vidrio instalado — no se crea obligación [${x.renglones}]`); continue; }
    const data = { distributor: dist };
    let nota = "";
    if (costo === 0) { data.glassCost = renglon; nota = ` costo $0 -> $${fmt(renglon)} (del renglón)`; }
    else if (!eq(costo, renglon)) { difieren.push(x); nota = ` costo orden $${fmt(costo)} ≠ renglones $${fmt(renglon)} (se deja el de la orden)`; }
    log(`  ${x.work_order_no} (${x.payment_number}): distribuidor "" -> "${dist}"${nota}`);
    if (APPLY) {
      await workordersStore.update(x.wo_id, data);
      const ok = await pool.query("SELECT id, amount FROM payable WHERE kind = 'DISTRIBUTOR' AND work_order_no = $1", [x.work_order_no]);
      if (!ok.rows.length) log(`     !! no se creó obligación para ${x.work_order_no}`);
    }
  }
  return difieren;
}

// ---------------------------------------------------------------------------------------------
// 5. Statements -> lotes (los que cuadran al centavo y aún no estaban amarrados)
// ---------------------------------------------------------------------------------------------
async function paso5_statementsALotes() {
  titulo("5. Amarrar statements a lotes");
  for (const e of ENLACES) {
    const lote = await payoutByNumber(e.lote);
    const invs = await invoicesDe(e);
    const ids = [], mover = [];
    let suma = 0;
    for (const inv of invs) {
      const s = await statementByInvoice(inv);
      suma += Number(s.amount);
      if (s.payout_id === lote.id) continue;
      if (s.payout_id && !e.mover) throw new Error(`${inv} ya está en otro lote (${s.payout_id})`);
      if (s.payout_id) mover.push(s); else ids.push(s.id);
    }
    if (!ids.length && !mover.length) { log(`  ${e.lote}: ${invs.length} statements ya estaban (${e.nota})`); continue; }
    log(`  ${e.lote} <- ${invs.length} statements $${fmt(suma)} (${e.nota})${mover.length ? `, ${mover.length} vienen de otro lote` : ""}`);
    if (APPLY && ids.length) await statementsStore.applyToPayout(ids, lote.id, {});
    if (APPLY) for (const s of mover) await pool.query("UPDATE distributor_statement SET payout_id = $2, updated_at = now() WHERE id = $1", [s.id, lote.id]);
  }

  // Dist-0289 pagó $6,000 de los $7,587.81 de Newport 22-mar + 29-mar; el resto de I04947647-0
  // ($1,587.81) lo pagó Dist-0290. El statement sigue en 0289 (un solo payout_id) y queda saldado.
  const s47 = await statementByInvoice("I04947647-0");
  if (!eq(s47.paid_amount, s47.amount)) {
    log(`  I04947647-0: pagado $${fmt(s47.paid_amount)} -> $${fmt(s47.amount)} (resto $${fmt(Number(s47.amount) - Number(s47.paid_amount))} en Dist-0290)`);
    if (APPLY) await pool.query(
      `UPDATE distributor_statement SET paid_amount = amount, status = 'paid', updated_at = now(),
              notes = COALESCE(notes, '') || $2 WHERE id = $1`,
      [s47.id, ` | $2,108.64 en Dist-0289 y $1,587.81 en Dist-0290 (${ACTOR})`]);
  }

  // Dist-0302 ($8,000) + Dist-0303 ($2,249.14) pagaron juntos las 10 facturas de Newport abr-2026
  // ($10,249.14): dos cargos de tarjeta el 30-jun y el 1-jul. I04979032-0 queda partida:
  // $2,961.34 en 0302 y $296.87 en 0303.
  const s32 = await statementByInvoice("I04979032-0");
  if (APPLY && !/Dist-0303/.test(s32.notes || "")) await pool.query(
    "UPDATE distributor_statement SET notes = COALESCE(notes, '') || $2, updated_at = now() WHERE id = $1",
    [s32.id, ` | $2,961.34 en Dist-0302 y $296.87 en Dist-0303 (${ACTOR})`]);
}

// ---------------------------------------------------------------------------------------------
// 6. Obligaciones -> lotes, con la misma selección que usa "pagar por statement"
// ---------------------------------------------------------------------------------------------
async function paso6_obligaciones() {
  titulo("6. Enlazar obligaciones de las órdenes de cada statement a su lote");
  const lotes = LOTES.filter((n) => !["Dist-0311", "Dist-0318"].includes(n));
  const brechas = [];
  for (const num of lotes) {
    const lote = await payoutByNumber(num);
    if (lote.active === false || FUSIONES.some((f) => f.tarjeta === num)) continue;
    const ids = await statementsDelLote(lote);
    if (!ids.length) { log(`  ${num}: sin statements`); continue; }
    const sel = await statementsStore.selection(ids);
    const yaEnLote = (await pool.query("SELECT count(*)::int AS n, COALESCE(SUM(amount),0) AS s FROM payable WHERE payout_id = $1", [lote.id])).rows[0];
    // La selección marca como brecha toda orden sin obligación PENDIENTE, incluidas las que ya
    // están en este mismo lote (cuadradas en una corrida anterior). Esas no son brecha.
    const enEsteLote = new Set((await pool.query("SELECT DISTINCT work_order_no FROM payable WHERE payout_id = $1", [lote.id])).rows.map((r) => r.work_order_no));
    sel.gaps = sel.gaps.filter((g) => !(g.workOrderNo && enEsteLote.has(g.workOrderNo)));
    log(`  ${num}: ${ids.length} statements, ${sel.workOrders.length} órdenes, ${sel.payableIds.length} obligaciones pendientes $${fmt(sel.totals.payables)} (ya en el lote: ${yaEnLote.n} $${fmt(yaEnLote.s)}), brechas ${sel.gaps.length}`);
    for (const g of sel.gaps) {
      brechas.push({ lote: num, ...g });
      log(`     brecha: ${g.invoice} ${g.reqNo || ""} ${g.partNumber || ""} $${fmt(g.amount)} ${g.workOrderNo || ""} — ${g.reason}`);
    }
    if (APPLY && sel.payableIds.length) await paymentsStore.linkObligations(lote.id, sel.payableIds, ACTOR);
  }
  return brechas;
}

// ---------------------------------------------------------------------------------------------
// 7. Notas de débito de Dist-0337 (existen, aplicadas, pero sin lote)
// ---------------------------------------------------------------------------------------------
async function paso7_notas0337() {
  titulo("7. Notas de Dist-0337");
  const lote = await payoutByNumber("Dist-0337");
  const r = await pool.query(`
    SELECT DISTINCT n.id, n.note_number, n.kind, n.amount, n.status, n.payout_id
      FROM distributor_statement_line l
      JOIN distributor_statement s ON s.id = l.statement_id
      JOIN credit_debit_note n ON n.id = l.note_id
     WHERE s.payout_id = $1 AND n.active AND n.status NOT IN ('Void','Cancelled') AND n.entity_type = 'DISTRIBUTOR'`, [lote.id]);
  const sueltas = r.rows.filter((n) => !n.payout_id);
  const ajenas = r.rows.filter((n) => n.payout_id && n.payout_id !== lote.id);
  for (const n of sueltas) log(`  ${n.note_number} ${n.kind} $${fmt(n.amount)} ${n.status} -> Dist-0337`);
  for (const n of ajenas) log(`  !! ${n.note_number} está en otro lote (${n.payout_id}); no se toca`);
  if (APPLY && sueltas.length) await pool.query(
    `UPDATE credit_debit_note SET payout_id = $2, status = 'Applied', updated_at = now(),
            audit_log = COALESCE(audit_log, '[]'::jsonb) || jsonb_build_array(jsonb_build_object('timestamp', now(), 'user', $3::text, 'action', 'Linked to payment Dist-0337 (cuadre statements)'))
      WHERE id = ANY($1::bigint[])`, [sueltas.map((n) => n.id), lote.id, ACTOR]);
}

// ---------------------------------------------------------------------------------------------
// 8. Lista de facturas de cada lote = sus statements, sumando exactamente lo pagado
// ---------------------------------------------------------------------------------------------
async function paso8_facturas() {
  titulo("8. Lista de facturas por lote (invoices)");
  const parciales = PARCIALES, extras = EXTRAS;
  const lotes = LOTES.filter((n) => !["Dist-0311", "Dist-0318"].includes(n));
  for (const num of lotes) {
    const lote = await payoutByNumber(num);
    if (lote.active === false || FUSIONES.some((f) => f.tarjeta === num)) continue;
    const ids = await statementsDelLote(lote);
    if (!ids.length) { log(`  ${num}: sin statements, se deja como está`); continue; }
    const rows = (await pool.query(
      "SELECT invoice_number, issue_date, amount FROM distributor_statement WHERE id = ANY($1::bigint[]) ORDER BY issue_date, invoice_number", [ids])).rows;
    for (const inv of extras[num] || []) {
      const s = await statementByInvoice(inv);
      rows.push({ invoice_number: inv, issue_date: s.issue_date, amount: s.amount });
    }
    rows.sort((a, b) => a.issue_date - b.issue_date || a.invoice_number.localeCompare(b.invoice_number));
    const invoices = rows.map((r) => ({
      number: r.invoice_number, date: r.issue_date.toISOString().slice(0, 10),
      amount: money(parciales[num]?.[r.invoice_number] ?? r.amount),
    }));
    const suma = money(invoices.reduce((s, i) => s + i.amount, 0));
    const ok = eq(suma, lote.total_amount);
    log(`  ${num}: ${invoices.length} facturas suman $${fmt(suma)} vs pagado $${fmt(lote.total_amount)} ${ok ? "OK" : `DIFERENCIA $${fmt(suma - Number(lote.total_amount))}`}`);
    if (APPLY) {
      // conservar adjuntos ya cargados por número de factura
      const previas = Object.fromEntries((lote.invoices || []).map((i) => [i.number, i]));
      const conAdjunto = invoices.map((i) => (previas[i.number]?.attachment ? { ...i, attachment: previas[i.number].attachment } : i));
      await pool.query("UPDATE payouts SET invoices = $2::jsonb, invoice_total = $3, updated_at = now(), updated_by = $4 WHERE id = $1",
        [lote.id, JSON.stringify(conAdjunto), suma, ACTOR]);
    }
  }
}

// ---------------------------------------------------------------------------------------------
// 9. Fórmula del sistema: total = subtotal + débito − crédito, con débito/crédito = notas vivas
// ---------------------------------------------------------------------------------------------
// El total pagado es dinero del banco y no se toca: se ajusta el subtotal para que la fórmula
// cierre (así el lote sobrevive a recalculatePayment cuando se edite una nota).
async function paso9_formula() {
  titulo("9. Fórmula total = subtotal + débito − crédito");
  for (const num of LOTES) {
    const lote = await payoutByNumber(num);
    if (lote.active === false) continue;
    if (lote.legacy_adjustments) { log(`  ${num}: ajustes heredados de AppSheet (débito ${fmt(lote.debit_notes_total)} / crédito ${fmt(lote.credit_notes_total)} sin desglosar en notas) — no se toca`); continue; }
    const n = (await pool.query(
      `SELECT COALESCE(SUM(amount) FILTER (WHERE kind = 'DEBIT'), 0) AS d, COALESCE(SUM(amount) FILTER (WHERE kind = 'CREDIT'), 0) AS c
         FROM credit_debit_note WHERE payout_id = $1 AND active AND status NOT IN ('Void','Cancelled') AND entity_type = 'DISTRIBUTOR'`, [lote.id])).rows[0];
    const d = money(n.d), c = money(n.c);
    const total = money(lote.total_amount);
    // Una compra a Mygrant no lleva bono ni deducción: el backfill los usó para cuadrar la factura
    // partida entre Dist-0289 y Dist-0290 (−$1,587.81 y +$1,587.81). Ahora la lista de facturas
    // ya dice cuánto pagó cada lote, así que esos términos se van y el subtotal absorbe la cifra.
    const subtotal = money(total - d + c - money(lote.tax_amount));
    const cambia = !eq(lote.subtotal, subtotal) || !eq(lote.debit_notes_total, d) || !eq(lote.credit_notes_total, c)
      || money(lote.bonus) !== 0 || money(lote.deductions) !== 0;
    const extra = money(lote.tax_amount) ? ` + imp $${fmt(lote.tax_amount)}` : "";
    const antes = [["bono", lote.bonus], ["ded", lote.deductions]].filter(([, v]) => money(v) !== 0).map(([k, v]) => ` ${k} $${fmt(v)}`).join("");
    log(`  ${num}: total $${fmt(total)} = subtotal $${fmt(subtotal)} + déb $${fmt(d)} − créd $${fmt(c)}${extra}` +
      (cambia ? `  (antes: sub $${fmt(lote.subtotal)} déb $${fmt(lote.debit_notes_total)} créd $${fmt(lote.credit_notes_total)}${antes})` : "  sin cambio"));
    if (APPLY && cambia) await pool.query(
      `UPDATE payouts SET subtotal = $2, base_amount = $2, debit_notes_total = $3, credit_notes_total = $4, net_amount = $5,
              bonus = 0, deductions = 0, updated_at = now(), updated_by = $6 WHERE id = $1`,
      [lote.id, subtotal, d, c, total, ACTOR]);
  }
}

// ---------------------------------------------------------------------------------------------
// 10. Verificación final por lote
// ---------------------------------------------------------------------------------------------
async function paso10_verificacion() {
  titulo("10. Verificación: pagado vs facturas vs obligaciones vs notas");
  const r = await pool.query(`
    SELECT o.payment_number, o.payment_date, o.total_amount, o.invoice_total,
           (SELECT count(*) FROM distributor_statement s WHERE s.payout_id = o.id AND s.active) AS n_stmt,
           (SELECT COALESCE(SUM(s.amount),0) FROM distributor_statement s WHERE s.payout_id = o.id AND s.active) AS s_stmt,
           (SELECT count(*) FROM payable pb WHERE pb.payout_id = o.id) AS n_ob,
           (SELECT COALESCE(SUM(pb.amount),0) FROM payable pb WHERE pb.payout_id = o.id) AS s_ob,
           (SELECT count(DISTINCT pb.work_order_no) FROM payable pb WHERE pb.payout_id = o.id) AS n_wo,
           o.debit_notes_total, o.credit_notes_total, o.subtotal
      FROM payouts o WHERE o.payment_number = ANY($1) AND o.active <> false ORDER BY o.payment_number`, [LOTES]);
  log("  lote       fecha       pagado     facturas   statements(n)   obligaciones(n/WOs)   déb      créd     subtotal");
  for (const x of r.rows) {
    log(`  ${x.payment_number}  ${x.payment_date}  ${fmt(x.total_amount).padStart(9)}  ${fmt(x.invoice_total).padStart(9)}  ${fmt(x.s_stmt).padStart(9)}(${x.n_stmt})   ${fmt(x.s_ob).padStart(9)} (${x.n_ob}/${x.n_wo})   ${fmt(x.debit_notes_total).padStart(7)}  ${fmt(x.credit_notes_total).padStart(7)}  ${fmt(x.subtotal).padStart(9)}`);
  }
  const vacios = await pool.query(`
    SELECT o.payment_number, o.payment_date, o.total_amount, o.notes
      FROM payouts o WHERE o.type = 'DISTRIBUTOR' AND o.active <> false
       AND (o.company ILIKE 'Mygrant%' OR o.notes ILIKE '%MYGRANT%')
       AND NOT EXISTS (SELECT 1 FROM payable pb WHERE pb.payout_id = o.id) ORDER BY o.payment_date DESC`);
  log(`\n  Lotes de Mygrant que siguen sin órdenes: ${vacios.rows.length}`);
  for (const v of vacios.rows) log(`    ${v.payment_number} ${v.payment_date} $${fmt(v.total_amount)} — ${(v.notes || "").slice(0, 70)}`);
}

(async () => {
  log(`Cuadre de pagos Mygrant — ${APPLY ? "APLICANDO" : "SOLO REPORTE"} — ${new Date().toISOString()}`);
  if (APPLY) await respaldar();
  await paso1_correcciones();
  const sinCuadre = await paso2_duplicados();
  await paso3_duplicados();
  const difieren = await paso4_ordenesSinDistribuidor();
  await paso5_statementsALotes();
  const brechas = await paso6_obligaciones();
  await paso7_notas0337();
  await paso8_facturas();
  await paso9_formula();
  await paso10_verificacion();

  titulo("Pendientes que no se resuelven con los datos que hay");
  log(`  - ${sinCuadre.length} órdenes con obligaciones AppSheet que no cuadran contra lo pagado por statement (paso 2)`);
  log(`  - ${difieren.length} órdenes cuyo costo de vidrio difiere de los renglones del statement (paso 4)`);
  log(`  - ${brechas.length} renglones de statement sin obligación que enlazar (paso 6)`);
  log("  - Dist-0261 ($3,703.13, 5-feb) es el mismo día y la misma suma de statements que Dist-0222 ($3,743.03): probable duplicado, decide Antonio");
  log("  - Dist-0255, 0256: dos cargos de $1,814.84 en enero sin statement de Mygrant que cuadre");
  log("  - Dist-0261 ($3,703.13, 5-feb) es el mismo día y la misma suma de statements que Dist-0222 ($3,743.03): probable duplicado, decide Antonio");

  const out = path.join(__dirname, "..", "backups", `cuadre-mygrant-informe-${APPLY ? "apply" : "reporte"}-${new Date().toISOString().slice(0, 10)}.txt`);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, informe.join("\n"));
  console.log(`\nInforme guardado en ${out}`);
  await pool.end();
})().catch(async (e) => { console.error("\nERROR:", e.stack || e.message); try { await pool.end(); } catch {} process.exit(1); });
