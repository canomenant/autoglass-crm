require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
// Affordable Glass: re-enlaza cada obligación de orden a la factura que la cobró y desglosa las
// diferencias en notas reales, como en Mygrant. Cubre todos los lotes con statements de Affordable
// (2025 y 2026). Por cada lote:  pagado = instalado + débito − crédito, nota por nota.
//
//   node scripts/relinkear-affordable.js            -> solo reporte
//   node scripts/relinkear-affordable.js --apply    -> escribe
//
// Reglas (Antonio): el costo de la pieza en la orden es lo que se pagó (la factura); la tarjeta
// manda sobre el PDF cuando difieren en centavos; las piezas facturadas sin orden son notas de
// débito (devuelta → crédito enlazado; si no, queda abierta para que él decida pérdida o técnico).
const fs = require("fs");
const path = require("path");
const pool = require("../src/config/db");
const notesStore = require("../src/store/notes.store");

const APPLY = process.argv.includes("--apply");
const ACTOR = "Re-enlace Affordable (2026-09-06)";
const money = (n) => Math.round(Number(n || 0) * 100) / 100;
const fmt = (n) => money(n).toFixed(2);
const key = (s) => String(s || "").toUpperCase().replace(/[\s-]+/g, "").slice(0, 7);
const dias = (a, b) => (new Date(a) - new Date(b)) / 86400000; // a − b en días
const informe = [];
function log(...a) { const s = a.join(" "); informe.push(s); console.log(s); }
function titulo(t) { log("\n" + "=".repeat(78) + "\n" + t + "\n" + "=".repeat(78)); }

(async () => {
  log(`Affordable — re-enlace factura por factura — ${APPLY ? "APLICANDO" : "SOLO REPORTE"} — ${new Date().toISOString()}`);
  const lots = (await pool.query(`SELECT o.id, o.payment_number pn, o.payment_date::text d, o.total_amount::float t, o.subtotal::float s, o.debit_notes_total::float dn, o.credit_notes_total::float cn, o.legacy_adjustments leg
    FROM payouts o WHERE o.active<>false AND EXISTS (SELECT 1 FROM distributor_statement st WHERE st.payout_id=o.id AND st.active AND st.distributor='Affordable Glass') ORDER BY o.payment_date, o.payment_number`)).rows;
  const lotPorId = Object.fromEntries(lots.map((l) => [l.id, l]));
  const docs = (await pool.query(`SELECT s.id sid, s.payout_id lot, s.invoice_number inv, s.issue_date::text d, s.kind, s.amount::float sa,
      COALESCE(json_agg(json_build_object('lid', l.id, 'part', l.part_number, 'a', l.amount::float, 'descr', l.customer_name) ORDER BY l.id) FILTER (WHERE l.id IS NOT NULL), '[]') items
    FROM distributor_statement s LEFT JOIN distributor_statement_line l ON l.statement_id=s.id
    WHERE s.active AND s.distributor='Affordable Glass' AND s.payout_id = ANY($1) GROUP BY s.id ORDER BY s.issue_date, s.invoice_number`, [lots.map((l) => l.id)])).rows;
  const ob = (await pool.query(`SELECT p.id, p.work_order_no wo, p.amount::float a, p.part_number part, p.payout_id lot, w.appointment_date::text ad, w.customer_name cn
    FROM payable p JOIN work_orders w ON w.work_order_no=p.work_order_no
    WHERE p.kind='DISTRIBUTOR' AND p.party ILIKE 'Afford%' AND w.appointment_date >= '2024-12-01' ORDER BY w.appointment_date`)).rows;
  const notasExistentes = (await pool.query("SELECT id, note_number, kind, amount::float a, part_number part, invoice_number inv, payout_id lot FROM credit_debit_note WHERE active AND status NOT IN ('Void','Cancelled') AND entity_name='Affordable Glass'")).rows;
  log(`lotes: ${lots.length} | documentos: ${docs.length} | obligaciones Affordable: ${ob.length} | notas existentes: ${notasExistentes.map((n) => n.note_number).join(", ") || "-"}`);

  // ---- cruce global: cada renglón de factura busca su orden por pieza y fecha
  const usadas = new Map(); // ob.id -> { lot, amount, lines: [] }
  const libre = (o) => !usadas.has(o.id);
  const enVentana = (o, d, holgura = 7) => { const x = dias(o.ad, d); return x >= -holgura && x <= 30; }; // el trabajo va de una semana antes a un mes después de la factura
  const mejor = (cands, d) => cands.sort((x, y) => Math.abs(dias(x.ad, d)) - Math.abs(dias(y.ad, d)))[0];
  const tomar = (o, doc, lines, amount) => { usadas.set(o.id, { lot: doc.lot, amount: money(amount), lines, doc }); lines.forEach((ln) => (ln.wo = o.wo)); };

  const invDocs = docs.filter((d) => d.kind !== "CREDIT_MEMO");
  // pasada A: factura completa contra una obligación (monto igual; pieza igual o sin pieza; sin renglones legibles → 2¢ de tolerancia)
  for (const doc of invDocs) {
    const tol = doc.items.length ? 0.005 : 0.025;
    const c = ob.filter((o) => libre(o) && Math.abs(o.a - doc.sa) < tol && enVentana(o, doc.d) && (!o.part || !doc.items.length || doc.items.some((it) => key(it.part) === key(o.part))));
    if (c.length) tomar(mejor(c, doc.d), doc, doc.items, doc.sa);
  }
  // pasada B1: renglón por pieza y monto exacto (hasta dos semanas de holgura entre factura y trabajo)
  for (const doc of invDocs) for (const it of doc.items.filter((it) => !it.wo)) {
    const c = ob.filter((o) => libre(o) && key(o.part) === key(it.part) && enVentana(o, doc.d, 14) && Math.abs(o.a - it.a) < 0.005);
    if (c.length) tomar(mejor(c, doc.d), doc, [it], it.a);
  }
  // pasada E: el PDF no dejó leer todos los renglones: lo que falta para el subtotal es una pieza; se busca por monto exacto
  for (const doc of invDocs.filter((d) => d.items.length)) {
    const resto = money(doc.sa - doc.items.reduce((s, it) => s + it.a, 0));
    if (resto < 0.005) continue;
    const c = ob.filter((o) => libre(o) && Math.abs(o.a - resto) < 0.005 && enVentana(o, doc.d, 14));
    if (!c.length) continue;
    const o = mejor(c, doc.d);
    const it = { lid: null, part: o.part, a: resto, descr: "", virtual: true }; doc.items.push(it);
    tomar(o, doc, [it], resto);
  }
  // pasada B2: monto exacto aunque la pieza sea otra (la orden dice una pieza y Affordable facturó otra); se reporta
  for (const doc of invDocs) for (const it of doc.items.filter((it) => !it.wo)) {
    const c = ob.filter((o) => libre(o) && Math.abs(o.a - it.a) < 0.005 && enVentana(o, doc.d, 14));
    if (c.length) { const o = mejor(c, doc.d); it.piezaDistinta = o.part; tomar(o, doc, [it], it.a); }
  }
  // pasada C: dos renglones del mismo lote que suman una obligación cuya pieza es una de las dos
  for (const L of lots) {
    const rest = () => invDocs.filter((d) => d.lot === L.id).flatMap((d) => d.items.filter((it) => !it.wo).map((it) => ({ it, doc: d })));
    for (const o of ob.filter((o) => libre(o))) {
      const r = rest(); let hecho = false;
      for (let i = 0; i < r.length && !hecho; i++) for (let j = i + 1; j < r.length && !hecho; j++) {
        if (Math.abs(r[i].it.a + r[j].it.a - o.a) < 0.005 && enVentana(o, r[i].doc.d, 14) && (key(o.part) === key(r[i].it.part) || key(o.part) === key(r[j].it.part))) {
          usadas.set(o.id, { lot: L.id, amount: money(o.a), lines: [r[i].it, r[j].it], doc: r[i].doc }); r[i].it.wo = o.wo; r[j].it.wo = o.wo; hecho = true;
        }
      }
    }
  }
  // pasada D: obligación sin pieza, por monto exacto y fecha
  for (const doc of invDocs) for (const it of doc.items.filter((it) => !it.wo)) {
    const c = ob.filter((o) => libre(o) && !o.part && Math.abs(o.a - it.a) < 0.005 && enVentana(o, doc.d, 14));
    if (c.length) tomar(mejor(c, doc.d), doc, [it], it.a);
  }
  // pasada B3: misma pieza, otro monto (AppSheet traía otro precio): se ajusta al de factura
  for (const doc of invDocs) for (const it of doc.items.filter((it) => !it.wo)) {
    const c = ob.filter((o) => libre(o) && key(o.part) === key(it.part) && enVentana(o, doc.d, 7));
    if (c.length) tomar(mejor(c, doc.d), doc, [it], it.a);
  }

  // ---- por lote
  titulo("Por lote");
  const plan = []; let todoCuadra = true; let movidas = 0;
  for (const L of lots) {
    const asignadas = [...usadas.entries()].filter(([, v]) => v.lot === L.id).map(([id, v]) => ({ o: ob.find((x) => x.id === id), ...v }));
    const debitos = [], creditos = [];
    for (const doc of docs.filter((d) => d.lot === L.id)) {
      if (doc.kind === "CREDIT_MEMO") { if (doc.items.length) doc.items.forEach((it) => creditos.push({ part: it.part, a: -it.a, inv: doc.inv, d: doc.d, descr: it.descr })); else creditos.push({ part: "", a: -doc.sa, inv: doc.inv, d: doc.d, descr: "" }); continue; }
      if (!doc.items.length) {
        if (asignadas.some((x) => x.doc.sid === doc.sid)) continue;
        const n = notasExistentes.find((x) => x.kind === "DEBIT" && x.inv === doc.inv);
        // sin renglones legibles: si una devolución posterior trae el mismo monto, esa es la pieza
        const dev = docs.find((x) => x.kind === "CREDIT_MEMO" && x.d >= doc.d && x.items.some((it) => Math.abs(it.a - doc.sa) < 0.005));
        const parte = dev ? dev.items.find((it) => Math.abs(it.a - doc.sa) < 0.005).part : "(sin renglón legible)";
        debitos.push(n ? { part: n.part, a: n.a, inv: doc.inv, d: doc.d, existente: n } : { part: parte, a: doc.sa, inv: doc.inv, d: doc.d, descr: "" });
        continue;
      }
      for (const it of doc.items.filter((it) => !it.wo)) debitos.push({ part: it.part, a: it.a, inv: doc.inv, d: doc.d, descr: it.descr, existente: notasExistentes.find((x) => x.kind === "DEBIT" && key(x.part) === key(it.part) && Math.abs(x.a - it.a) < 0.005 && x.lot === L.id) });
    }
    let S = money(asignadas.reduce((s, x) => s + x.amount, 0)), D = money(debitos.reduce((s, x) => s + x.a, 0)), C = money(creditos.reduce((s, x) => s + x.a, 0));
    let dif = money(L.t - (S + D - C));
    let ajusteCent = null;
    if (Math.abs(dif) > 0.004 && Math.abs(dif) <= 0.02 && asignadas.length) { // la tarjeta manda: el centavo va a la factura sin renglones si la hay, si no a la última obligación
      const x = asignadas.find((a) => !a.doc.items.length) || asignadas[asignadas.length - 1];
      x.amount = money(x.amount + dif); ajusteCent = x; S = money(S + dif); dif = 0;
    }
    const cuadra = Math.abs(dif) < 0.005;
    if (!cuadra) todoCuadra = false;
    log(`\n${L.pn} ${L.d} pagado $${fmt(L.t)} = instalado $${fmt(S)} (${asignadas.length}) + débito $${fmt(D)} − crédito $${fmt(C)} ${cuadra ? "CUADRA" : "NO CUADRA: dif $" + fmt(dif)}${ajusteCent ? ` (1¢ en ${ajusteCent.o.wo})` : ""}`);
    for (const x of asignadas.sort((a, b) => a.o.ad.localeCompare(b.o.ad))) {
      const mov = x.o.lot !== L.id, cambio = Math.abs(x.o.a - x.amount) > 0.004;
      if (mov) movidas++;
      log(`   ${x.o.wo} ${x.o.ad.slice(0, 10)} ${String(x.lines.map((l) => l.part).join("+") || x.o.part || "").padEnd(22)} ${fmt(x.amount).padStart(8)} ${x.doc.inv}${cambio ? ` (antes ${fmt(x.o.a)})` : ""}${x.lines.some((l) => l.virtual) ? " (renglón no leído en el PDF)" : ""}${x.lines.some((l) => l.piezaDistinta) ? ` (la orden dice ${x.lines.find((l) => l.piezaDistinta).piezaDistinta})` : ""}${mov ? ` <- venía de ${x.o.lot ? lotPorId[x.o.lot]?.pn || "otro lote" : "pendiente"}` : ""}`);
    }
    for (const x of debitos) log(`   DÉBITO  ${String(x.part).padEnd(22)} $${fmt(x.a).padStart(8)} ${x.inv} ${x.d}${x.existente ? " (ya existe " + x.existente.note_number + ")" : ""}`);
    for (const x of creditos) log(`   CRÉDITO ${String(x.part).padEnd(22)} $${fmt(x.a).padStart(8)} ${x.inv} ${x.d}`);
    plan.push({ L, asignadas, debitos, creditos, S, D, C });
  }
  const huérfanas = ob.filter((o) => libre(o) && o.lot && lotPorId[o.lot]);
  const pendientesSin = ob.filter((o) => libre(o) && !o.lot);
  titulo("Resumen");
  log(`obligaciones movidas de lote: ${movidas}`);
  log(`obligaciones que estaban en un lote de Affordable y ninguna factura las respalda (pasan a pendientes): ${huérfanas.length} ($${fmt(huérfanas.reduce((s, o) => s + o.a, 0))})`);
  for (const o of huérfanas) log(`   ${o.wo} ${o.ad.slice(0, 10)} ${o.part || "(sin pieza)"} $${fmt(o.a)} estaba en ${lotPorId[o.lot].pn}`);
  log(`obligaciones pendientes que siguen sin factura: ${pendientesSin.length} ($${fmt(pendientesSin.reduce((s, o) => s + o.a, 0))})`);
  for (const o of pendientesSin) log(`   ${o.wo} ${o.ad.slice(0, 10)} ${o.part || "(sin pieza)"} $${fmt(o.a)}`);
  log(`\n${lots.length} lotes; ${todoCuadra ? "todos cuadran" : "HAY LOTES QUE NO CUADRAN — no se aplica"}`);
  if (!APPLY || !todoCuadra) { guardar(); await pool.end(); return; }

  // ---- aplicar
  titulo("Aplicar");
  fs.writeFileSync(path.join(__dirname, "..", "backups", `affordable-relink-respaldo-${new Date().toISOString().slice(0, 10)}.json`),
    JSON.stringify({ payouts: (await pool.query("SELECT * FROM payouts WHERE id = ANY($1)", [lots.map((l) => l.id)])).rows, payable: (await pool.query("SELECT * FROM payable WHERE id = ANY($1)", [ob.map((o) => o.id)])).rows,
      lines: (await pool.query("SELECT * FROM distributor_statement_line WHERE statement_id = ANY($1)", [docs.map((d) => d.sid)])).rows, notes: notasExistentes }, null, 1));
  for (const o of huérfanas) await pool.query("UPDATE payable SET payout_id=NULL, status='pendiente', part_description=COALESCE(part_description,'')||$2, updated_at=now() WHERE id=$1", [o.id, ` | Sacada de ${lotPorId[o.lot].pn}: ninguna factura de Affordable en ese pago respalda esta pieza (${ACTOR})`]);
  const debitosCreados = [];
  let nd = 0, nc = 0;
  for (const { L, asignadas, debitos, creditos, S, D, C } of plan) {
    for (const x of asignadas) {
      const partes = x.lines.map((l) => l.part).filter(Boolean).join(" + ") || x.o.part;
      await pool.query("UPDATE payable SET payout_id=$2, status='pagado', amount=$3, party='Affordable Glass', part_number=$4, part_description=COALESCE(part_description,'')||$5, updated_at=now() WHERE id=$1",
        [x.o.id, L.id, x.amount, partes, (x.o.lot !== L.id || Math.abs(x.o.a - x.amount) > 0.004) ? ` | ${x.doc.inv} de Affordable pagada en ${L.pn}${Math.abs(x.o.a - x.amount) > 0.004 ? `; precio de factura (antes $${fmt(x.o.a)})` : ""} (${ACTOR})` : ""]);
      await pool.query("UPDATE work_orders w SET glass_cost=(SELECT COALESCE(sum(amount),0) FROM payable WHERE work_order_no=w.work_order_no AND kind='DISTRIBUTOR'), glass_cost_source='obligaciones', updated_at=now(), updated_by=$2 WHERE work_order_no=$1", [x.o.wo, ACTOR]);
      for (const l of x.lines) if (l.lid) await pool.query("UPDATE distributor_statement_line SET work_order_no=$2, classification='INSTALLED', match_source='relink_affordable' WHERE id=$1", [l.lid, x.o.wo]);
    }
    // el lote: subtotal = instalado; totales de notas en bruto; bandera heredada hasta que las notas cuadren
    await pool.query("UPDATE payouts SET subtotal=$2, base_amount=$2, debit_notes_total=$3, credit_notes_total=$4, legacy_adjustments=$5, updated_at=now(), updated_by=$6 WHERE id=$1", [L.id, S, D, C, D > 0 || C > 0, ACTOR]);
    for (const x of debitos) {
      if (x.existente) { debitosCreados.push({ id: Number(x.existente.id), part: x.part, d: L.d }); continue; }
      const n = await notesStore.create("DEBIT", { entityType: "DISTRIBUTOR", entityName: "Affordable Glass", relatedPaymentId: L.id, amount: x.a, reason: "Part Returned", partNumber: x.part, invoiceNumber: x.inv, issueDate: x.d, partDescription: x.descr || "",
        description: `Pieza facturada por Affordable y pagada en ${L.pn} sin orden que la instale (${ACTOR})` }, ACTOR);
      debitosCreados.push({ id: Number(n.id), part: x.part, d: L.d }); nd++;
    }
    for (const x of creditos) {
      const cand = debitosCreados.filter((dd) => key(dd.part) === key(x.part) && dd.d <= L.d && !dd.usado).sort((a, b) => b.d.localeCompare(a.d))[0];
      if (cand) cand.usado = true;
      await notesStore.create("CREDIT", { entityType: "DISTRIBUTOR", entityName: "Affordable Glass", relatedPaymentId: L.id, amount: x.a, reason: "Returned Material", partNumber: x.part, invoiceNumber: x.inv, issueDate: x.d, partDescription: x.descr || "",
        description: cand ? `Devolución acreditada por Affordable en ${L.pn} (${ACTOR})` : `Devolución acreditada por Affordable en ${L.pn}; la compra no está en un pago de la tarjeta 0533 (${ACTOR})`, debitNoteId: cand ? cand.id : null }, ACTOR);
      nc++;
    }
    const v = (await pool.query(`SELECT legacy_adjustments leg, debit_notes_total::float dn, credit_notes_total::float cn, total_amount::float t, subtotal::float s, (SELECT COALESCE(sum(amount),0)::float FROM payable WHERE payout_id=$1) ob FROM payouts WHERE id=$1`, [L.id])).rows[0];
    const ok = Math.abs(v.s + v.dn - v.cn - v.t) < 0.005 && Math.abs(v.ob - v.s) < 0.005 && !v.leg;
    log(`  ${L.pn}: instalado $${fmt(v.ob)} + débito $${fmt(v.dn)} − crédito $${fmt(v.cn)} = $${fmt(v.ob + v.dn - v.cn)} vs pagado $${fmt(v.t)} ${ok ? "OK" : "REVISAR" + (v.leg ? " (sigue heredado)" : "")}`);
  }
  log(`\nNotas creadas: ${nd} de débito, ${nc} de crédito`);
  const abiertas = (await pool.query("SELECT n.note_number, n.amount::float a, n.part_number, n.invoice_number, o.payment_number FROM credit_debit_note n JOIN payouts o ON o.id=n.payout_id WHERE n.active AND n.kind='DEBIT' AND n.resolution IS NULL AND n.entity_name='Affordable Glass' ORDER BY o.payment_date")).rows;
  log(`Débitos de Affordable sin destino (Antonio decide pérdida o técnico): ${abiertas.length} ($${fmt(abiertas.reduce((s, x) => s + x.a, 0))})`);
  for (const x of abiertas) log(`   ${x.note_number} ${x.payment_number} ${x.part_number} $${fmt(x.a)} ${x.invoice_number}`);
  guardar();
  await pool.end();

  function guardar() {
    const out = path.join(__dirname, "..", "backups", `affordable-relink-informe-${APPLY ? "apply" : "reporte"}-${new Date().toISOString().slice(0, 10)}.txt`);
    fs.writeFileSync(out, informe.join("\n"));
    console.log(`\nInforme guardado en ${out}`);
  }
})().catch(async (e) => { console.error("\nERROR:", e.stack || e.message); try { await pool.end(); } catch {} process.exit(1); });
