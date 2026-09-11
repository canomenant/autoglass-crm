require("dotenv").config();
const pool = require("../src/config/db");

// Radiografía de UN lote de pago, de lectura: quién lo creó, qué le fue pasando, qué obligaciones
// tiene dentro y cuáles NO son del proveedor al que se le pagó.
//
//   node scripts/analizar-pago.js Dist-0304
//
// Nació de la revisión de Dist-0304 (Antonio: "hay distributors en blanco y hay partes de Import
// Glass"). Las dos cosas se ven desde la pantalla del pago pero no se explican ahí: el "—" de la
// columna Distribuidor puede ser una obligación que llegó de AppSheet sin nombre, y una parte de
// otro proveedor entra porque al pagar por statement se enlazan TODAS las obligaciones de
// distribuidor pendientes de esas órdenes, sin mirar a quién se le deben (statements.store
// selection() + payments.store linkObligations(), que sólo valida el tipo). Este script dice
// cuál de los dos casos es cada renglón, con nombres y montos.
//
// No escribe nada: es para mirar antes de decidir si algo hay que mover.

const NUM = process.argv[2];
const money = (n) => "$" + Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
// A mano y no con toISOString(): pg entrega DATE como Date a medianoche LOCAL y toISOString lo
// corre un día entero según el huso — la misma trampa que ya documenta payable.store (fechaISO).
const fecha = (v) => {
  if (!v) return "—";
  if (v instanceof Date) return `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, "0")}-${String(v.getDate()).padStart(2, "0")}`;
  return String(v).slice(0, 10);
};
const eq = (a, b) => Math.abs(Number(a || 0) - Number(b || 0)) < 0.005;
// "Mygrant Anaheim", "Mygrant #011" y "MYGRANT GLASS" son el mismo proveedor con tres nombres: el
// comparador es la primera palabra, que es lo único que los tres comparten.
const marca = (s) => String(s || "").trim().toUpperCase().split(/[\s#,]+/)[0];
const titulo = (t) => console.log("\n" + "=".repeat(78) + "\n" + t + "\n" + "=".repeat(78));

(async () => {
  if (!NUM) {
    console.error("Uso: node scripts/analizar-pago.js Dist-0304");
    process.exit(1);
  }

  const lote = (await pool.query("SELECT * FROM payouts WHERE payment_number = $1", [NUM])).rows[0];
  if (!lote) {
    console.error(`No existe el lote ${NUM}`);
    process.exit(1);
  }

  titulo(`${lote.payment_number} — ${lote.type} — ${lote.status}${lote.active === false ? " (RETIRADO)" : ""}`);
  console.log(`  Fecha de pago : ${fecha(lote.payment_date)}`);
  console.log(`  Método        : ${lote.payment_method || "—"}`);
  console.log(`  Proveedor     : ${lote.company || "— (sin company)"}${lote.is_adhoc ? "   [lote adhoc: nació sin órdenes]" : ""}`);
  console.log(`  Total pagado  : ${money(lote.total_amount)}   (subtotal ${money(lote.subtotal)}, débito ${money(lote.debit_notes_total)}, crédito ${money(lote.credit_notes_total)}, impuesto ${money(lote.tax_amount)})`);
  console.log(`  Notas         : ${lote.notes || "—"}`);
  console.log(`  Creado por    : ${lote.created_by || "—"}  el ${fecha(lote.created_at)}`);
  console.log(`  Última edición: ${lote.updated_by || "—"}  el ${fecha(lote.updated_at)}`);
  console.log(`  Cotejado      : ${lote.reconciled_at ? `${fecha(lote.reconciled_at)} por ${lote.reconciled_by || "—"}` : "no"}`);

  // ---------------------------------------------------------------------------------------------
  // Bitácora: la respuesta a "quién hizo este pago". El created_by dice quién lo abrió; la
  // bitácora dice quién le fue metiendo las órdenes, que casi nunca es la misma mano.
  // ---------------------------------------------------------------------------------------------
  titulo("Bitácora");
  const bitacora = Array.isArray(lote.audit_log) ? lote.audit_log : [];
  if (!bitacora.length) console.log("  (vacía)");
  for (const e of bitacora) {
    const detalle = Array.isArray(e.changes) && e.changes.length
      ? " — " + e.changes.map((c) => `${c.field}: ${c.from ?? "∅"} → ${c.to ?? "∅"}`).join(", ")
      : e.newValue && typeof e.newValue === "object"
        ? " — " + JSON.stringify(e.newValue)
        : "";
    console.log(`  ${fecha(e.timestamp)}  ${String(e.user || "—").padEnd(32)} ${e.action}${detalle}`);
  }

  // ---------------------------------------------------------------------------------------------
  // Obligaciones: lo que el lote pagó, por orden y POR PARTE. `party` es quién vendió la pieza y
  // es lo que la pantalla pinta en la columna Distribuidor.
  // ---------------------------------------------------------------------------------------------
  titulo("Obligaciones dentro del lote");
  const obs = (await pool.query(
    `SELECT p.id, p.work_order_no, p.party, p.amount, p.source, p.external_id,
            COALESCE(NULLIF(btrim(p.part_number), ''), NULLIF(btrim(w.part_number), '')) AS part_number,
            w.distributor AS wo_distributor, w.customer_name
       FROM payable p
       LEFT JOIN work_orders w ON w.work_order_no = p.work_order_no AND w.active <> false
      WHERE p.payout_id = $1
      ORDER BY p.work_order_no, p.id`, [lote.id])).rows;

  // El proveedor al que se le pagó: el de los statements amarrados si los hay, y si no el company
  // que el import dejó escrito. Es la vara contra la que se mide cada obligación.
  const sts = (await pool.query(
    `SELECT id, invoice_number, distributor, branch, issue_date, amount, paid_amount, status
       FROM distributor_statement WHERE payout_id = $1 AND active ORDER BY issue_date, invoice_number`, [lote.id])).rows;
  const proveedor = marca(sts[0]?.distributor) || marca(lote.company);

  const enBlanco = [], ajenas = [], propias = [];
  for (const o of obs) {
    const p = String(o.party || "").trim();
    if (!p) enBlanco.push(o);
    else if (proveedor && marca(p) !== proveedor) ajenas.push(o);
    else propias.push(o);
  }

  for (const o of obs) {
    const p = String(o.party || "").trim();
    const bandera = !p ? "EN BLANCO" : proveedor && marca(p) !== proveedor ? "OTRO PROVEEDOR" : "";
    console.log(
      `  #${String(o.id).padEnd(6)} ${String(o.work_order_no || "(sin WO)").padEnd(9)} ` +
      `${(p || "—").padEnd(24)} ${String(o.part_number || "—").padEnd(18)} ${money(o.amount).padStart(11)}  ` +
      `${String(o.source || "—").padEnd(18)} ${bandera}`);
    if (bandera && o.wo_distributor) console.log(`         la orden dice distribuidor: "${o.wo_distributor}"`);
  }
  const suma = obs.reduce((s, o) => s + Number(o.amount), 0);
  console.log(`\n  ${obs.length} obligaciones, ${money(suma)}`);
  console.log(`  del proveedor del lote (${proveedor || "?"}): ${propias.length}, ${money(propias.reduce((s, o) => s + Number(o.amount), 0))}`);
  console.log(`  sin nombre (columna en blanco)             : ${enBlanco.length}, ${money(enBlanco.reduce((s, o) => s + Number(o.amount), 0))}`);
  console.log(`  de OTRO proveedor                          : ${ajenas.length}, ${money(ajenas.reduce((s, o) => s + Number(o.amount), 0))}`);

  // Una obligación sin nombre casi siempre es de las que llegaron de AppSheet sin party (payableSync
  // las rellena al guardar la orden, no antes). Si la orden sí sabe el distribuidor, ahí está el
  // nombre que le falta, y eso es lo que hay que mirar antes de moverla de lote.
  if (enBlanco.length) {
    console.log("\n  Sin nombre — lo que dice su orden:");
    for (const o of enBlanco) {
      console.log(`    ${String(o.work_order_no || "(sin WO)").padEnd(9)} orden: ${o.wo_distributor ? `"${o.wo_distributor}"` : "TAMPOCO tiene distribuidor"}` +
        `  ${o.external_id ? `(${o.external_id})` : ""}`);
    }
  }

  // Una obligación de otro proveedor entra cuando la orden tiene dos piezas de bodegas distintas:
  // el statement trae el vidrio, y al enlazar se va también el clip o la moldura que se le debe a
  // otro. Se ve comparando con los renglones del statement de ESA orden.
  if (ajenas.length) {
    console.log("\n  De otro proveedor — ¿está su pieza en algún statement de este lote?");
    for (const o of ajenas) {
      const r = (await pool.query(
        `SELECT l.part_number, l.amount, l.classification, s.invoice_number, s.distributor
           FROM distributor_statement_line l JOIN distributor_statement s ON s.id = l.statement_id
          WHERE s.payout_id = $1 AND l.work_order_no = $2`, [lote.id, o.work_order_no])).rows;
      const suya = r.find((x) => marca(x.part_number) === marca(o.part_number));
      console.log(`    ${String(o.work_order_no || "").padEnd(9)} ${String(o.party).padEnd(24)} ${String(o.part_number || "—").padEnd(18)} ${money(o.amount).padStart(11)}  ` +
        (suya ? `SÍ: ${suya.invoice_number} (${suya.distributor}) ${money(suya.amount)}`
              : r.length ? `NO — el statement de esa orden trae ${r.map((x) => `${x.part_number} ${money(x.amount)}`).join(", ")}`
                         : "NO — esa orden no tiene renglón en ningún statement del lote"));
    }
  }

  // ---------------------------------------------------------------------------------------------
  // Statements y notas: el respaldo del monto.
  // ---------------------------------------------------------------------------------------------
  titulo("Statements amarrados");
  if (!sts.length) console.log("  (ninguno)");
  for (const s of sts) {
    const lineas = (await pool.query(
      `SELECT count(*)::int n, COALESCE(sum(amount),0)::float s,
              count(*) FILTER (WHERE work_order_no IS NULL)::int sin_wo
         FROM distributor_statement_line WHERE statement_id = $1`, [s.id])).rows[0];
    console.log(`  ${s.invoice_number.padEnd(14)} ${fecha(s.issue_date)} ${String(s.distributor || "—").padEnd(22)} ${String(s.branch || "—").padEnd(16)} ` +
      `${money(s.amount).padStart(11)} (pagado ${money(s.paid_amount)}, ${s.status})  ${lineas.n} renglones ${money(lineas.s)}${lineas.sin_wo ? `, ${lineas.sin_wo} sin orden` : ""}`);
  }
  const sumaSt = sts.reduce((a, s) => a + Number(s.amount), 0);

  const notas = (await pool.query(
    `SELECT note_number, kind, amount, status FROM credit_debit_note
      WHERE payout_id = $1 AND active AND status NOT IN ('Void','Cancelled') AND entity_type = 'DISTRIBUTOR'
      ORDER BY note_number`, [lote.id])).rows;
  titulo("Notas de crédito / débito");
  if (!notas.length) console.log("  (ninguna)");
  for (const n of notas) console.log(`  ${n.note_number.padEnd(10)} ${n.kind.padEnd(7)} ${money(n.amount).padStart(11)} ${n.status}`);

  // ---------------------------------------------------------------------------------------------
  // Cuadre: las tres cuentas que deberían dar lo mismo.
  // ---------------------------------------------------------------------------------------------
  titulo("Cuadre");
  const facturas = Array.isArray(lote.invoices) ? lote.invoices : [];
  const sumaFact = facturas.reduce((a, f) => a + Number(f.amount || 0), 0);
  const filas = [
    ["Pagado (total del lote)", Number(lote.total_amount)],
    ["Obligaciones enlazadas", suma],
    ["Statements amarrados", sumaSt],
    ["Lista de facturas", sumaFact],
  ];
  for (const [nombre, v] of filas) {
    const dif = v - Number(lote.total_amount);
    console.log(`  ${nombre.padEnd(26)} ${money(v).padStart(13)}${eq(dif, 0) ? "" : `   diferencia ${money(dif)}`}`);
  }

  await pool.end();
})().catch(async (err) => {
  console.error(err);
  await pool.end().catch(() => {});
  process.exit(1);
});
