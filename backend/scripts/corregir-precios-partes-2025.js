require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
// Cierre de saldos 2025 (Antonio, 7-sep-2026). Las órdenes importadas de AppSheet pintan un
// "Remaining Balance" que no existe, por dos causas medidas contra el precio real de AppSheet
// (work_orders.total_sale) en las 2,547 órdenes 2025 importadas:
//
//  PASO 1  El importador dejó en cada renglón de pieza el costo TOTAL de la orden (Wo-0865:
//          374.72 + 233.02 cuando la orden costó 374.72). Regla de Antonio: el precio de la
//          pieza en la cotización es lo que se pagó al distribuidor por ESA pieza (la obligación).
//  PASO 2  La cotización cobra impuesto sobre piezas + labor; AppSheet lo cobraba SOLO sobre las
//          piezas (tier + piezas × (1 + tax)). Esa fórmula reproduce el precio real en 2,167 de
//          2,547 órdenes con ±$1; con la fórmula actual solo 4. El CRM ya la tiene: modo de
//          factura "itemized". Se marca así la cotización y su orden.
//  PASO 3  El upsell (lo cobrado por encima del precio) se recalcula con el precio corregido:
//          se había anotado contra el precio inflado. La venta del P&L no cambia (usa lo cobrado).
//
//   node scripts/corregir-precios-partes-2025.js                 -> reporte de los tres pasos
//   node scripts/corregir-precios-partes-2025.js --apply-paso1   -> escribe el paso 1
//   node scripts/corregir-precios-partes-2025.js --apply-paso2   -> escribe pasos 2 y 3
const fs = require("fs");
const path = require("path");
const pool = require("../src/config/db");
const quotesStore = require("../src/store/quotes.store");
const YEAR = Number((process.argv.find((a) => a.startsWith('--year=')) || '--year=2025').slice(7));
const TODAS = process.argv.includes("--todas"); // también las creadas en la web, no solo las importadas
const APPLY1 = process.argv.includes("--apply-paso1");
const APPLY2 = process.argv.includes("--apply-paso2");
const ACTOR = "Cierre 2025: precio de pieza = costo pagado, impuesto solo sobre piezas (2026-09-07)";
const HOY = new Date().toISOString().slice(0, 10);
const money = (n) => Math.round(Number(n || 0) * 100) / 100;
const fmt = (n) => money(n).toFixed(2);
const key = (s) => String(s || "").toUpperCase().replace(/[\s-]+/g, "").slice(0, 7);
const informe = [];
const log = (...a) => { const s = a.join(" "); informe.push(s); console.log(s); };
const esPieza = (l) => l.partNumber || Number(l.pricePart) > 0;

(async () => {
  const rows = (await pool.query(`SELECT w.work_order_no wo, w.appointment_date::text ad, w.customer_name cn, w.total_sale::float ts, w.invoice_mode wim,
      COALESCE((w.payment->>'amount')::float,0) - COALESCE((w.payment->>'cashComeback')::float,0) AS cobrado,
      q.id qid, q.line_items li, q.invoice_mode qim, q.upsell::float ups, q.payment_type ptype,
      (SELECT json_agg(json_build_object('part', p.part_number, 'a', p.amount::float, 'party', p.party) ORDER BY p.id) FROM payable p WHERE p.work_order_no=w.work_order_no AND p.kind='DISTRIBUTOR' AND p.status<>'retirada') ob
    FROM work_orders w JOIN quotes q ON q.id=w.quote_id
    WHERE w.active<>false AND w.status<>'Cancelled' AND w.appointment_date>='${YEAR}-01-01' AND w.appointment_date<'${YEAR+1}-01-01' ORDER BY w.appointment_date, w.work_order_no`)).rows;

  // ---------- PASO 1: precio de pieza = obligación ----------
  const st = { revisadas: 0, importadas: 0, sinPiezas: 0, sinOblig: 0, iguales: 0, cambian: 0, manual: 0, delta: 0 };
  const cambios = []; const manuales = []; const sinCostoLista = []; const dejadas = [];
  const nuevosItems = new Map(); // qid -> line items tras el paso 1 (para simular el paso 2)
  for (const r of rows) {
    st.revisadas++;
    const items = r.li || [];
    if (!TODAS && !items.some((l) => l.source === "appsheet_import")) continue;
    if (r.ptype === "Insurance") continue; // aseguranza no se toca (Antonio, 7-sep-2026)
    st.importadas++;
    const conParte = items.filter(esPieza);
    if (!conParte.length) { st.sinPiezas++; continue; }
    const todas = r.ob || [];
    const ob = todas.filter((o) => Number(o.a) > 0);
    const sinCosto = todas.filter((o) => !(Number(o.a) > 0));
    if (!ob.length) { st.sinOblig++; if (sinCosto.length) sinCostoLista.push({ r, li: conParte, ob: todas }); continue; }
    const sumLi = money(conParte.reduce((s, l) => s + Number(l.pricePart || 0), 0));
    // la obligación viene consolidada (una sola fila sin número de parte con el total de la orden): si la suma de renglones ya es igual, no hay nada que corregir
    if (Math.abs(sumLi - money(ob.reduce((s, o) => s + Number(o.a), 0))) < 0.005) { st.iguales++; continue; }
    const usadas = new Set(); const nuevo = conParte.map((l) => ({ l, precio: null }));
    for (const n of nuevo) { const i = ob.findIndex((o, idx) => !usadas.has(idx) && key(o.part) === key(n.l.partNumber)); if (i >= 0) { usadas.add(i); n.precio = money(ob[i].a); } }
    const sobrantesOb = ob.filter((_, idx) => !usadas.has(idx));
    const sinPrecio = nuevo.filter((n) => n.precio == null);
    // un solo renglón sin cruzar y obligaciones sobrantes: ese renglón se lleva lo que falta
    if (sinPrecio.length === 1 && sobrantesOb.length) { sinPrecio[0].precio = money(sobrantesOb.reduce((s, o) => s + Number(o.a), 0)); sobrantesOb.length = 0; sinPrecio.length = 0; }
    if (sobrantesOb.length) { st.manual++; manuales.push({ r, li: conParte, ob }); continue; }
    // renglón sin costo pagado (pieza del técnico, $0 en el lote): se deja como está y se lista
    for (const n of sinPrecio) { n.precio = money(n.l.pricePart); n.igual = true; dejadas.push({ wo: r.wo, part: n.l.partNumber, precio: n.precio, sinCosto: sinCosto.map((o) => `${o.part || "?"} $0 (${o.party})`).join(", ") }); }
    if (nuevo.every((n) => n.igual || Math.abs(n.precio - Number(n.l.pricePart || 0)) < 0.005)) { st.iguales++; continue; }
    const nuevaSuma = money(nuevo.reduce((s, n) => s + n.precio, 0));
    st.cambian++; st.delta += sumLi - nuevaSuma;
    const li2 = items.map((l) => { const x = nuevo.find((y) => y.l === l); return x && !x.igual ? { ...l, pricePart: x.precio, priceCorrected: { from: Number(l.pricePart || 0), actor: ACTOR } } : l; });
    nuevosItems.set(r.qid, li2);
    cambios.push({ r, nuevo, sumLi, sumOb: nuevaSuma });
  }

  // ---------- PASO 2 + 3: simulación con la fórmula "itemized" ----------
  const p2 = { n: 0, dentro1: 0, dentro5: 0, fuera5: 0, saldoHoy: 0, conSaldoHoy: 0, saldoDespues: 0, conSaldoDespues: 0, upsHoy: 0, upsNuevo: 0, conUpsHoy: 0, conUpsNuevo: 0, ceroInsurance: 0, ceroSinRenglones: 0 };
  const fuera = []; const conSaldo = []; const plan2 = [];
  for (const r of rows) {
    const items = r.li || [];
    if (!items.some((l) => l.source === "appsheet_import")) continue;
    const q = await quotesStore.get(r.qid); if (!q) continue;
    p2.n++;
    const hoy = money(q.totals.finalSalePrice);
    p2.saldoHoy += Math.max(0, hoy - money(r.cobrado)); if (hoy - r.cobrado > 0.005) p2.conSaldoHoy++;
    const tot = quotesStore.__computeTotalsForTest({ ...q, lineItems: nuevosItems.get(r.qid) || q.lineItems, invoiceMode: "itemized" });
    const fin = money(tot.totalAmount); const real = money(r.ts); const dif = money(fin - real);
    const upsNuevo = Math.max(0, money(r.cobrado) - fin);
    p2.upsHoy += Number(r.ups || 0); p2.upsNuevo += upsNuevo; if (Number(r.ups) > 0) p2.conUpsHoy++; if (upsNuevo > 0.005) p2.conUpsNuevo++;
    if (Math.abs(dif) <= 1) p2.dentro1++; else if (Math.abs(dif) <= 5) p2.dentro5++; else {
      p2.fuera5++;
      if (fin === 0 && q.paymentType === "Insurance") p2.ceroInsurance++; else if (fin === 0) p2.ceroSinRenglones++;
      fuera.push({ r, real, fin, dif, tot, tipo: q.paymentType });
    }
    const saldo = Math.max(0, fin - money(r.cobrado)); p2.saldoDespues += saldo; if (saldo > 0.005) { p2.conSaldoDespues++; conSaldo.push({ r, real, fin, saldo: money(saldo) }); }
    plan2.push({ r, upsNuevo: money(upsNuevo), fin });
  }

  // ---------- informe ----------
  log(`Órdenes 2025 con cotización: ${st.revisadas} | importadas de AppSheet: ${st.importadas} | sin piezas en la cotización: ${st.sinPiezas} | sin obligación con costo: ${st.sinOblig} | ya iguales: ${st.iguales}`);
  log(`\nPASO 1 — precio de pieza = costo pagado al distribuidor`);
  log(`  Cambian ${st.cambian} órdenes; el precio de partes baja en total $${fmt(st.delta)} | revisión manual: ${st.manual}`);
  log(`\nPASO 2 — impuesto solo sobre piezas (modo itemized) + PASO 3 — upsell recalculado`);
  log(`  Cotización vs precio real de AppSheet (${p2.n} órdenes): ±$1: ${p2.dentro1} | ±$5: ${p2.dentro5} | fuera de $5: ${p2.fuera5} (de ellas ${p2.ceroInsurance} son Insurance sin datos del reclamo → $0, y ${p2.ceroSinRenglones} sin renglones → $0)`);
  log(`  Remaining Balance en pantalla: hoy ${p2.conSaldoHoy} órdenes / $${fmt(p2.saldoHoy)}  →  después ${p2.conSaldoDespues} órdenes / $${fmt(p2.saldoDespues)}`);
  log(`  Upsell anotado: hoy ${p2.conUpsHoy} órdenes / $${fmt(p2.upsHoy)}  →  después ${p2.conUpsNuevo} órdenes / $${fmt(p2.upsNuevo)} (la venta del P&L no cambia: usa lo cobrado)`);

  log("\n== PASO 1, orden por orden (partes antes->después | renglones) ==");
  for (const c of cambios) log(`  ${c.r.wo} ${c.r.ad.slice(0, 10)} ${(c.r.cn || "").slice(0, 18).padEnd(18)} $${fmt(c.sumLi)}->$${fmt(c.sumOb)} | ` + c.nuevo.map((n) => `${n.l.partNumber || "?"} $${fmt(n.l.pricePart)}->$${fmt(n.precio)}`).join("; "));
  log(`\nRenglones que se dejan igual por no tener costo pagado (${dejadas.length}):`);
  for (const d of dejadas) log(`  ${d.wo} ${d.part || "?"} $${fmt(d.precio)}${d.sinCosto ? " | en el lote: " + d.sinCosto : ""}`);
  log(`\nÓrdenes cuya única obligación está en $0 (${sinCostoLista.length}):`);
  for (const m of sinCostoLista) log(`  ${m.r.wo} ${m.r.ad.slice(0, 10)} renglones: ${m.li.map((l) => `${l.partNumber || "?"} $${fmt(l.pricePart)}`).join(" + ")} | obligaciones: ${m.ob.map((o) => `${o.part || "?"} $${fmt(o.a)} (${o.party})`).join(" + ")}`);
  log(`\nRevisión manual (${manuales.length}):`);
  for (const m of manuales) log(`  ${m.r.wo} ${m.r.ad.slice(0, 10)} renglones: ${m.li.map((l) => `${l.partNumber || "?"} $${fmt(l.pricePart)}`).join(" + ")} | obligaciones: ${m.ob.map((o) => `${o.part || "?"} $${fmt(o.a)} (${o.party})`).join(" + ")}`);

  log(`\n== PASO 2, órdenes que seguirían con Remaining Balance (${conSaldo.length}, $${fmt(conSaldo.reduce((s, x) => s + x.saldo, 0))}) ==`);
  conSaldo.sort((a, b) => b.saldo - a.saldo);
  for (const c of conSaldo) log(`  ${c.r.wo} ${c.r.ad.slice(0, 10)} ${(c.r.cn || "").slice(0, 18).padEnd(18)} precio AppSheet $${fmt(c.real)} | cotización $${fmt(c.fin)} | cobrado $${fmt(c.r.cobrado)} | saldo $${fmt(c.saldo)}`);
  log(`\n== PASO 2, cotización fuera de ±$5 del precio AppSheet (${fuera.length}) ==`);
  fuera.sort((a, b) => Math.abs(b.dif) - Math.abs(a.dif));
  for (const f of fuera) log(`  ${f.r.wo} ${f.r.ad.slice(0, 10)} ${(f.r.cn || "").slice(0, 18).padEnd(18)} ${String(f.tipo || "").padEnd(9)} precio AppSheet $${fmt(f.real)} | cotización $${fmt(f.fin)} (dif ${fmt(f.dif)}) | cobrado $${fmt(f.r.cobrado)} | tier $${fmt(f.tot.priceTierTotal)} piezas $${fmt(f.tot.subtotalParts)} tax ${f.tot.taxAmount ? fmt(f.tot.taxAmount) : "0"}`);

  const out = path.join(__dirname, "..", "backups", `precios-cotizacion-2025-${APPLY1 ? "paso1" : APPLY2 ? "paso2" : "reporte"}-${HOY}.txt`);
  if (!APPLY1 && !APPLY2) { fs.writeFileSync(out, informe.join("\n")); console.log("\nInforme:", out); await pool.end(); return; }

  if (APPLY1) {
    fs.writeFileSync(path.join(__dirname, "..", "backups", `precios-cotizacion-2025-paso1-respaldo-${HOY}.json`),
      JSON.stringify({ quotes: (await pool.query("SELECT id, line_items FROM quotes WHERE id = ANY($1)", [cambios.map((c) => c.r.qid)])).rows }, null, 1));
    let n = 0;
    for (const c of cambios) { await pool.query("UPDATE quotes SET line_items=$2::jsonb, updated_at=now(), updated_by=$3 WHERE id=$1", [c.r.qid, JSON.stringify(nuevosItems.get(c.r.qid)), ACTOR]); n++; }
    log(`\nPASO 1 aplicado: ${n} cotizaciones. El precio real de la orden (total_sale) no se toca.`);
  }
  if (APPLY2) {
    const ids = plan2.map((p) => p.r.qid); const wos = plan2.map((p) => p.r.wo);
    fs.writeFileSync(path.join(__dirname, "..", "backups", `precios-cotizacion-2025-paso2-respaldo-${HOY}.json`),
      JSON.stringify({ quotes: (await pool.query("SELECT id, invoice_mode, upsell FROM quotes WHERE id = ANY($1)", [ids])).rows, work_orders: (await pool.query("SELECT work_order_no, invoice_mode FROM work_orders WHERE work_order_no = ANY($1)", [wos])).rows }, null, 1));
    let n = 0;
    for (const p of plan2) {
      await pool.query("UPDATE quotes SET invoice_mode='itemized', upsell=$2, updated_at=now(), updated_by=$3 WHERE id=$1", [p.r.qid, p.upsNuevo, ACTOR]);
      await pool.query("UPDATE work_orders SET invoice_mode='itemized', updated_at=now(), updated_by=$2 WHERE work_order_no=$1", [p.r.wo, ACTOR]);
      n++;
    }
    log(`\nPASO 2+3 aplicados: ${n} cotizaciones en modo itemized con su upsell recalculado.`);
  }
  fs.writeFileSync(out, informe.join("\n")); console.log("Informe:", out);
  await pool.end();
})().catch(async (e) => { console.error(e.stack); try { await pool.end(); } catch {} process.exit(1); });
