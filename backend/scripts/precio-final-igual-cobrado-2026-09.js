require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
// Regla de Antonio (7-sep-2026): en toda orden marcada PAGADA, el Final Sale Price de la web es la
// suma de lo cobrado y el upsell es la diferencia contra el total de la cotización, positiva o
// negativa. Nada de "Remaining Balance" en órdenes cerradas. Las cotizaciones sin total (sin
// renglones / Insurance sin datos) se saltan: ahí falta el precio, no el upsell.
//   node scripts/precio-final-igual-cobrado-2026-09.js          -> reporte
//   node scripts/precio-final-igual-cobrado-2026-09.js --apply  -> escribe upsell y total_sale
const fs = require("fs");
const pool = require("../src/config/db");
const qs = require("../src/store/quotes.store");
const APPLY = process.argv.includes("--apply");
const ACTOR = "Precio final = cobrado en órdenes pagadas (Antonio, 2026-09-07)";
const money = (n) => Math.round(Number(n || 0) * 100) / 100;
(async () => {
  const rows = (await pool.query(`SELECT w.work_order_no wo, extract(year FROM w.appointment_date)::int y, w.total_sale::float ts,
      COALESCE((w.payment->>'amount')::float,0) - COALESCE((w.payment->>'cashComeback')::float,0) cobrado, q.id qid, q.upsell::float ups
    FROM work_orders w JOIN quotes q ON q.id=w.quote_id
    WHERE w.active<>false AND w.status<>'Cancelled' AND (w.payment->>'paid')::boolean = true ORDER BY w.appointment_date`)).rows;
  const por = {}; const plan = []; const saltadas = [];
  for (const r of rows) {
    const q = await qs.get(r.qid); if (!q) continue;
    const y = r.y || "sin fecha"; const s = por[y] = por[y] || { pagadas: 0, yaIguales: 0, cambian: 0, upsellSube: 0, upsellBaja: 0, sinTotal: 0, negativoMonto: 0, positivoMonto: 0 };
    s.pagadas++;
    const total = money(q.totals.totalAmount); const cobrado = money(r.cobrado);
    if (total <= 0 || cobrado <= 0) { s.sinTotal++; saltadas.push(`${r.wo} total $${total} cobrado $${cobrado}`); continue; }
    const upsell = money(cobrado - total);
    if (Math.abs(upsell - money(r.ups)) < 0.005 && Math.abs(money(r.ts) - cobrado) < 0.005) { s.yaIguales++; continue; }
    s.cambian++; if (upsell > money(r.ups)) s.upsellSube++; else s.upsellBaja++;
    if (upsell < 0) s.negativoMonto += upsell; else s.positivoMonto += upsell;
    plan.push({ r, upsell, cobrado, total });
  }
  for (const [y, s] of Object.entries(por)) console.log(y, JSON.stringify({ ...s, negativoMonto: money(s.negativoMonto), positivoMonto: money(s.positivoMonto) }));
  console.log(`\ncambian ${plan.length} órdenes | saltadas sin total o sin cobro: ${saltadas.length}`);
  const neg = plan.filter((p) => p.upsell < 0).sort((a, b) => a.upsell - b.upsell);
  console.log(`\nupsell negativo (${neg.length}), los 15 mayores:`); for (const p of neg.slice(0, 15)) console.log(`  ${p.r.wo} total $${p.total} cobrado $${p.cobrado} upsell $${p.r.ups} -> $${p.upsell}`);
  console.log(`\nsaltadas (${saltadas.length}), primeras 10:`); for (const s of saltadas.slice(0, 10)) console.log("  " + s);
  if (!APPLY) { await pool.end(); return; }
  fs.writeFileSync(`backups/precio-final-cobrado-respaldo-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(plan.map((p) => ({ wo: p.r.wo, qid: p.r.qid, upsell: p.r.ups, total_sale: p.r.ts })), null, 1));
  for (const p of plan) {
    await pool.query("UPDATE quotes SET upsell=$2, updated_at=now(), updated_by=$3 WHERE id=$1", [p.r.qid, p.upsell, ACTOR]);
    await pool.query("UPDATE work_orders SET total_sale=$2, updated_at=now(), updated_by=$3 WHERE work_order_no=$1", [p.r.wo, p.cobrado, ACTOR]);
  }
  console.log(`\naplicado en ${plan.length} órdenes`);
  await pool.end();
})().catch((e) => { console.error(e.stack); process.exit(1); });
