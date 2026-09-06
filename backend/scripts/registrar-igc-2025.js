require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
// Import Glass Corporation: registra como statements los pedidos del historial del portal
// (Documents/igc_orders.json, exportado de IGC el 23-may-2025) y los amarra a los pagos que
// cuadran exactos con ellos. Por ahora solo Dist-0048 (Capital One 8-may-2025 = marzo + abril).
//   node scripts/registrar-igc-2025.js          -> reporte
//   node scripts/registrar-igc-2025.js --apply  -> escribe
const fs = require("fs");
const pool = require("../src/config/db");
const statementsStore = require("../src/store/statements.store");
const APPLY = process.argv.includes("--apply");
const ACTOR = "Cuadre IGC 2025 (2026-09-06)";
const money = (n) => Math.round(Number(n || 0) * 100) / 100, fmt = (n) => money(n).toFixed(2);
const key = (s) => String(s || "").toUpperCase().replace(/[\s-]+/g, "").slice(0, 7);
const LOTES = [{ pn: "Dist-0048", desde: "2025-03-01", hasta: "2025-04-30" }];
(async () => {
  const orders = JSON.parse(fs.readFileSync("C:/Users/Antonio Cano/OneDrive - 5l3mgq/Documents/igc_orders.json", "utf8"));
  for (const cfg of LOTES) {
    const L = (await pool.query("SELECT id, payment_number pn, payment_date::text d, total_amount::float t FROM payouts WHERE payment_number=$1", [cfg.pn])).rows[0];
    const ob = (await pool.query("SELECT p.id, p.work_order_no wo, p.amount::float a, p.part_number part, w.appointment_date::text ad FROM payable p JOIN work_orders w ON w.work_order_no=p.work_order_no WHERE p.payout_id=$1", [L.id])).rows;
    const docs = orders.filter((o) => o.date >= cfg.desde && o.date <= cfg.hasta && o.total !== 0).sort((a, b) => a.date.localeCompare(b.date) || a.order.localeCompare(b.order));
    const suma = money(docs.reduce((s, o) => s + o.total, 0));
    console.log(`${L.pn} ${L.d} pagado $${fmt(L.t)} | pedidos IGC ${cfg.desde}..${cfg.hasta}: ${docs.length} por $${fmt(suma)} ${Math.abs(suma - L.t) < 0.005 ? "EXACTO" : "NO CUADRA"} | obligaciones ${ob.length} $${fmt(ob.reduce((s, x) => s + x.a, 0))}`);
    if (Math.abs(suma - L.t) > 0.005) continue;
    const usadas = new Set(); let sinOrden = 0;
    const lineas = docs.flatMap((o) => o.items.map((it) => ({ o, it, wo: null })));
    for (const ln of lineas) { if (ln.it.amt <= 0) continue; const m = ob.find((x) => !usadas.has(x.id) && key(x.part) === key(ln.it.part) && Math.abs(x.a - ln.it.amt) < 0.005); if (m) { usadas.add(m.id); ln.wo = m.wo; } else sinOrden++; }
    console.log(`  renglones de compra amarrados a orden: ${lineas.filter((l) => l.wo).length}; compras sin orden (devueltas después): ${sinOrden}; obligaciones sin renglón: ${ob.filter((x) => !usadas.has(x.id)).map((x) => x.wo + " " + x.part).join(", ") || "ninguna"}`);
    if (!APPLY) continue;
    const ids = [];
    for (const o of docs) {
      const ex = (await pool.query("SELECT id, payout_id FROM distributor_statement WHERE active AND upper(invoice_number)=upper($1) AND distributor='Import Glass Corporation'", [String(o.order)])).rows[0];
      if (ex) { if (!ex.payout_id) ids.push(ex.id); continue; }
      const ins = await pool.query(`INSERT INTO distributor_statement (invoice_number, distributor, branch, kind, issue_date, due_date, amount, paid_amount, status, terms_days, source, notes)
        VALUES ($1,'Import Glass Corporation','Santa Ana, CA',$2,$3::date,$3::date,$4,0,'paid',0,'igc_order_history',$5) RETURNING id`,
        [String(o.order), o.total < 0 ? "CREDIT_MEMO" : "INVOICE", o.date, o.total, `Pedido ${o.order} del historial del portal IGC (${ACTOR})${o.po ? "; PO " + o.po : ""}`]);
      ids.push(ins.rows[0].id);
      for (const ln of lineas.filter((l) => l.o === o)) await pool.query(`INSERT INTO distributor_statement_line (statement_id, req_no, line_date, qty, part_number, amount, customer_name, work_order_no, classification, match_source)
        VALUES ($1,$2,$3::date,$4,$5,$6,'',$7,$8,'igc_order_history')`, [ins.rows[0].id, String(o.order), o.date, ln.it.qty, ln.it.part, ln.it.amt, ln.wo, ln.it.amt < 0 ? "CREDIT" : ln.wo ? "INSTALLED" : "UNDECIDED"]);
    }
    if (ids.length) await statementsStore.applyToPayout(ids, L.id, {});
    await pool.query("UPDATE payouts SET invoices=$2::jsonb, invoice_total=$3, notes=COALESCE(notes,'')||$4, updated_at=now(), updated_by=$5 WHERE id=$1", [L.id, JSON.stringify(docs.map((o) => ({ number: String(o.order), date: o.date, amount: money(o.total) }))), suma, ` | ${ACTOR}: ${docs.length} pedidos IGC de marzo y abril 2025 (historial del portal), exactos con el pago.`, ACTOR]);
    const st = (await pool.query("SELECT COALESCE(sum(amount),0)::float s, count(*)::int n FROM distributor_statement WHERE payout_id=$1 AND active", [L.id])).rows[0];
    console.log(`  aplicado: ${st.n} statements por $${fmt(st.s)}`);
  }
  await pool.end();
})().catch(async (e) => { console.error(e.stack); try { await pool.end(); } catch {} process.exit(1); });
