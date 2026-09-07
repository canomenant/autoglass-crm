require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
// Órdenes Personal PAGADAS cuya cotización vale $0 (Antonio, 7-sep-2026: "enfoquémonos en las
// personales"). Son trabajos sin pieza de distribuidor: chip repair, trip, labor, instalación de
// vidrio del cliente. Regla de la web: el precio final es lo cobrado. El renglón del trabajo toma
// pricePart = cobrado, sin impuesto (no hay pieza), sin tier, cotización en modo itemized,
// upsell 0 y total_sale = cobrado. Las de aseguranza quedan fuera.
//   node scripts/personales-sin-precio-2026-09.js          -> reporte
//   node scripts/personales-sin-precio-2026-09.js --apply  -> escribe
const fs = require("fs");
const crypto = require("crypto");
const pool = require("../src/config/db");
const qs = require("../src/store/quotes.store");
const APPLY = process.argv.includes("--apply");
const ACTOR = "Precio del trabajo = cobrado, orden Personal sin pieza (Antonio, 2026-09-07)";
const money = (n) => Math.round(Number(n || 0) * 100) / 100;
(async () => {
  const rows = (await pool.query(`SELECT w.work_order_no wo, w.appointment_date::date::text ad, w.customer_name cn, w.job_type jt, w.total_sale::float ts,
      COALESCE((w.payment->>'amount')::float,0) - COALESCE((w.payment->>'cashComeback')::float,0) cobrado, q.id qid, q.line_items li, q.upsell::float ups, q.invoice_mode mode
    FROM work_orders w JOIN quotes q ON q.id=w.quote_id
    WHERE w.active<>false AND w.status<>'Cancelled' AND (w.payment->>'paid')::boolean = true AND q.payment_type <> 'Insurance' ORDER BY w.appointment_date`)).rows;
  const plan = [];
  for (const r of rows) {
    const q = await qs.get(r.qid); if (!q) continue;
    if (q.totals.totalAmount > 0 || money(r.cobrado) <= 0) continue;
    const items = (q.lineItems || []).map((l) => ({ ...l, priceTier: "", priceTierAmount: 0 }));
    const tipoWo = String(r.jt || "").split(",").map((s) => s.trim()).filter(Boolean)[0] || "Labor";
    let linea = items.find((l) => l.jobType) || items[0];
    if (!linea) { linea = { id: crypto.randomUUID(), jobType: tipoWo, partNumber: "", nagsDescription: "", calibrationType: "", priceTier: "", distributor: "", orderNumber: "", source: "" }; items.push(linea); }
    if (!linea.jobType) linea.jobType = tipoWo;
    linea.pricePart = money(r.cobrado); linea.isTaxable = false;
    linea.servicePriced = { from: 0, actor: ACTOR };
    const tot = qs.__computeTotalsForTest({ ...q, lineItems: items, invoiceMode: "itemized" });
    plan.push({ r, items, total: money(tot.totalAmount) });
    console.log(`${r.wo} ${(r.ad || "s/f").slice(0, 10)} ${(r.cn || "").slice(0, 16).padEnd(16)} ${linea.jobType.padEnd(22)} cobrado $${money(r.cobrado)} -> cotización $${money(tot.totalAmount)} | upsell $${r.ups} -> $0`);
  }
  console.log(`\n${plan.length} órdenes`);
  if (!APPLY) { await pool.end(); return; }
  fs.writeFileSync(`backups/personales-sin-precio-respaldo-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(plan.map((p) => ({ wo: p.r.wo, qid: p.r.qid, line_items: p.r.li, upsell: p.r.ups, mode: p.r.mode, total_sale: p.r.ts })), null, 1));
  for (const p of plan) {
    await pool.query("UPDATE quotes SET line_items=$2::jsonb, upsell=0, invoice_mode='itemized', updated_at=now(), updated_by=$3 WHERE id=$1", [p.r.qid, JSON.stringify(p.items), ACTOR]);
    await pool.query("UPDATE work_orders SET invoice_mode='itemized', total_sale=$2, updated_at=now(), updated_by=$3 WHERE work_order_no=$1", [p.r.wo, money(p.r.cobrado), ACTOR]);
  }
  console.log(`aplicado en ${plan.length} órdenes`);
  await pool.end();
})().catch((e) => { console.error(e.stack); process.exit(1); });
