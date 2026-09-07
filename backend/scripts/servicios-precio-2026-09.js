require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
// Servicios cobrados por tier (Antonio, 7-sep-2026, Wo-2616): un chip repair o una calibración no
// llevan Price Tier; su precio es lo que se cobró por el servicio. El importador dejó ese precio en
// servicesAmount (SERVICES_AMOUNT de AppSheet), que la cotización NO suma. Aquí el renglón de
// servicio toma pricePart = servicesAmount (o el precio real de la orden si no lo trae), sin
// impuesto (los servicios no lo pagan) y la cotización en modo itemized; el tier se quita.
//   node scripts/servicios-precio-2026-09.js            -> reporte de todas las órdenes con servicio sin precio
//   node scripts/servicios-precio-2026-09.js --apply Wo-2616 Wo-3003   -> escribe solo esas
//   node scripts/servicios-precio-2026-09.js --apply --todas           -> escribe todas las que cierran
const fs = require("fs");
const pool = require("../src/config/db");
const qs = require("../src/store/quotes.store");
const jobTypes = require("../src/store/jobTypes.store");
const APPLY = process.argv.includes("--apply");
const TODAS = process.argv.includes("--todas");
const SOLO = process.argv.filter((a) => /^Wo-\d+$/.test(a));
const ACTOR = "Servicio con precio propio, sin Price Tier (Antonio, 2026-09-07)";
const money = (n) => Math.round(Number(n || 0) * 100) / 100;
const esServicio = (l) => jobTypes.findByName(l.jobType)?.type === "Services";
(async () => {
  const rows = (await pool.query(`SELECT q.id, w.work_order_no wo, w.appointment_date::date::text ad, w.customer_name cn, w.total_sale::float ts,
      COALESCE((w.payment->>'amount')::float,0) - COALESCE((w.payment->>'cashComeback')::float,0) cobrado, q.line_items li, q.upsell::float ups, q.invoice_mode mode
    FROM quotes q JOIN work_orders w ON w.quote_id=q.id AND w.active<>false AND w.status<>'Cancelled'
    WHERE EXISTS (SELECT 1 FROM jsonb_array_elements(q.line_items) l WHERE COALESCE((l->>'servicesAmount')::float,0) > 0 AND COALESCE((l->>'pricePart')::float,0) = 0)
       OR w.work_order_no = ANY($1) ORDER BY w.appointment_date`, [SOLO])).rows;
  const st = { n: 0, cierran: 0, sobra: 0, falta: 0 }; const plan = [];
  for (const r of rows) {
    if (SOLO.length && !TODAS && !SOLO.includes(r.wo)) continue;
    const q = await qs.get(r.id);
    const items = q.lineItems.map((l) => ({ ...l }));
    const notas = [];
    const servicios = items.filter((l) => esServicio(l) && !Number(l.pricePart));
    if (!servicios.length) continue;
    for (const l of servicios) {
      let precio = money(l.servicesAmount);
      // sin monto importado y es el único renglón con valor: el precio del servicio es lo cobrado
      if (!precio && items.every((x) => !Number(x.pricePart) && !Number(x.servicesAmount)) && servicios.length === 1) precio = money(r.cobrado);
      if (!precio) continue;
      notas.push(`${l.jobType}: precio $${precio}${l.priceTier ? " (tier " + l.priceTier + " quitado)" : ""}`);
      l.servicePriced = { from: Number(l.pricePart || 0), tier: l.priceTier || "", actor: ACTOR };
      l.pricePart = precio; l.isTaxable = false; l.priceTier = ""; l.priceTierAmount = 0; l.laborCharged = 0;
    }
    if (!notas.length) continue;
    const antes = money(q.totals.totalAmount);
    const tot = qs.__computeTotalsForTest({ ...q, lineItems: items, invoiceMode: "itemized" });
    const total = money(tot.totalAmount); const upsell = money(Math.max(0, money(r.cobrado) - total)); const saldo = money(Math.max(0, total - money(r.cobrado)));
    st.n++; if (Math.abs(total - money(r.ts)) <= 1) st.cierran++; else if (total > r.ts) st.sobra++; else st.falta++;
    const ok = Math.abs(total - money(r.ts)) <= 1 || SOLO.includes(r.wo);
    console.log(`${r.wo} ${r.ad} ${(r.cn || "").slice(0, 16).padEnd(16)} ${notas.join("; ")} | cotización $${antes} -> $${total} | precio orden $${r.ts} | cobrado $${r.cobrado} | upsell $${r.ups} -> $${upsell} | saldo $${saldo} ${ok ? "" : "≠ precio orden, NO se aplica"}`);
    if (ok) plan.push({ r, items, upsell });
  }
  console.log(`\nórdenes con servicio sin precio: ${st.n} | con el servicio cuadran al precio de la orden: ${st.cierran} | quedan arriba: ${st.sobra} | quedan abajo: ${st.falta}`);
  if (APPLY && (TODAS || SOLO.length)) {
    fs.writeFileSync(`backups/servicios-precio-respaldo-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(plan.map((p) => ({ id: p.r.id, wo: p.r.wo, line_items: p.r.li, upsell: p.r.ups, mode: p.r.mode })), null, 1));
    for (const p of plan) {
      await pool.query("UPDATE quotes SET line_items=$2::jsonb, upsell=$3, invoice_mode='itemized', updated_at=now(), updated_by=$4 WHERE id=$1", [p.r.id, JSON.stringify(p.items), p.upsell, ACTOR]);
      await pool.query("UPDATE work_orders SET invoice_mode='itemized', updated_at=now(), updated_by=$2 WHERE work_order_no=$1", [p.r.wo, ACTOR]);
    }
    console.log(`aplicado en ${plan.length} órdenes`);
  }
  await pool.end();
})().catch((e) => { console.error(e.stack); process.exit(1); });
