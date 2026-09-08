require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
// Antonio (7-sep-2026): todas las órdenes PERSONAL (no aseguranza), 2025 y 2026, servicios
// incluidos, en modo "Simplified (Lump-Sum)": impuesto completo sobre piezas y labor. En las
// pagadas, Final Sale Price = suma de lo cobrado y el upsell se recalcula (positivo o negativo).
//   node scripts/simplified-personales-2026-09.js          -> reporte
//   node scripts/simplified-personales-2026-09.js --apply  -> escribe
const fs = require("fs");
const pool = require("../src/config/db");
const qs = require("../src/store/quotes.store");
const APPLY = process.argv.includes("--apply");
const ACTOR = "Modo Simplified, impuesto sobre piezas y labor (Antonio, 2026-09-07)";
const m = (n) => Math.round(Number(n || 0) * 100) / 100;
(async () => {
  const rows = (await pool.query(`SELECT w.work_order_no wo, extract(year FROM w.appointment_date)::int y, w.total_sale::float ts, w.invoice_mode wim,
      (w.payment->>'paid')::boolean paid, COALESCE((w.payment->>'amount')::float,0) - COALESCE((w.payment->>'cashComeback')::float,0) cobrado,
      q.id qid, q.invoice_mode qim, q.upsell::float ups, q.line_items li
    FROM work_orders w JOIN quotes q ON q.id=w.quote_id
    WHERE w.active<>false AND w.status<>'Cancelled' AND q.payment_type<>'Insurance' AND COALESCE(w.work_order_type,'Personal')<>'Insurance'
    ORDER BY w.appointment_date NULLS LAST, w.work_order_no`)).rows;
  const st = {}; const plan = []; const resp = [];
  for (const r of rows) {
    const q = await qs.get(r.qid); if (!q) continue;
    const y = r.y || "s/f"; const s = st[y] = st[y] || { n: 0, cambianModo: 0, servicios: 0, taxAntes: 0, taxDespues: 0, upsAntes: 0, upsDespues: 0, saldoAntes: 0, saldoDespues: 0, negativos: 0 };
    s.n++;
    const items = (q.lineItems || []).map((l) => (l.isTaxable === false ? { ...l, isTaxable: true, taxableForced: ACTOR } : l));
    if (items.some((l, i) => l !== q.lineItems[i])) s.servicios++;
    const antes = q.totals;
    const tot = qs.__computeTotalsForTest({ ...q, lineItems: items, invoiceMode: "lump_sum" });
    const total = m(tot.totalAmount); const cobrado = m(r.cobrado);
    const upsell = r.paid && cobrado > 0 && total > 0 ? m(cobrado - total) : m(r.ups);
    const finalAntes = m(antes.finalSalePrice), finalDespues = m(total + upsell);
    s.taxAntes += m(antes.taxAmount); s.taxDespues += m(tot.taxAmount);
    s.upsAntes += m(r.ups); s.upsDespues += upsell; if (upsell < 0) s.negativos++;
    s.saldoAntes += Math.max(0, finalAntes - cobrado); s.saldoDespues += Math.max(0, finalDespues - cobrado);
    if (r.qim !== "lump_sum" || r.wim !== "lump_sum") s.cambianModo++;
    resp.push({ qid: r.qid, wo: r.wo, invoice_mode: r.qim, wim: r.wim, upsell: r.ups, total_sale: r.ts, line_items: r.li });
    plan.push({ r, items, upsell, total, paid: r.paid && cobrado > 0 && total > 0, cobrado });
  }
  for (const [y, s] of Object.entries(st)) console.log(y, JSON.stringify({ ordenes: s.n, cambianModo: s.cambianModo, serviciosAhoraGravados: s.servicios, impuesto: `${m(s.taxAntes)} -> ${m(s.taxDespues)}`, upsell: `${m(s.upsAntes)} -> ${m(s.upsDespues)}`, upsellNegativos: s.negativos, saldoPantalla: `${m(s.saldoAntes)} -> ${m(s.saldoDespues)}` }));
  if (!APPLY) { await pool.end(); return; }
  fs.writeFileSync(`backups/simplified-personales-respaldo-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(resp, null, 1));
  let n = 0;
  for (const p of plan) {
    await pool.query("UPDATE quotes SET invoice_mode='lump_sum', line_items=$2::jsonb, upsell=$3, updated_at=now(), updated_by=$4 WHERE id=$1", [p.r.qid, JSON.stringify(p.items), p.upsell, ACTOR]);
    await pool.query("UPDATE work_orders SET invoice_mode='lump_sum', total_sale=$2, updated_at=now(), updated_by=$3 WHERE work_order_no=$1", [p.r.wo, p.paid ? p.cobrado : m(p.total + p.upsell), ACTOR]);
    n++;
  }
  console.log("aplicado en", n, "órdenes");
  await pool.end();
})().catch((e) => { console.error(e.stack); process.exit(1); });
