require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
// Regla de Antonio (7-sep-2026): el Price Tier solo va en los vidrios (y en los reguladores de
// ventana cuando son el trabajo). Revisión de las 22 órdenes con tier en renglones que no son
// vidrio:
//   - 7 renglones donde el tier sobra (Rain Sensor Pad, Gasket, Chip Repair, Calibration): la
//     cotización lo cobra por el NOMBRE del catálogo aunque el renglón diga $0 → se quita.
//   - 15 renglones que SÍ son vidrio pero el importador etiquetó como Delivery Surcharge / Labor /
//     Windshield Cowling / sin tipo: se les pone el tipo de vidrio que trae la orden (work_orders.job_type).
// En todas se recalcula el upsell = cobrado − total de la cotización.
//   node scripts/tier-solo-vidrios-2026-09.js          -> reporte
//   node scripts/tier-solo-vidrios-2026-09.js --apply  -> escribe
const fs = require("fs");
const pool = require("../src/config/db");
const qs = require("../src/store/quotes.store");
const APPLY = process.argv.includes("--apply");
const ACTOR = "Price Tier solo en vidrios (Antonio, 2026-09-07)";
const money = (n) => Math.round(Number(n || 0) * 100) / 100;
const GLASS = /glass|windshield replacement/i;
// Wo-2616 y Wo-3003 (Chip Repair) y Wo-4309 (Calibration) se dejan fuera: el tier era su ÚNICO
// precio; quitarlo deja la cotización en $0 y todo lo cobrado como upsell. Necesitan que el precio
// del servicio se capture como tal (decisión de Antonio pendiente).
const QUITAR = { "Wo-3986": /rain sensor/i, "Wo-4054": /rain sensor/i, "Wo-4115": /rain sensor/i, "Wo-4178": /gasket/i };
const RELABEL = ["Wo-0476", "Wo-0491", "Wo-0627", "Wo-0679", "Wo-1803", "Wo-2295", "Wo-2327", "Wo-3148", "Wo-3187", "Wo-3281", "Wo-0785", "Wo-0940", "Wo-4244", "Wo-0251"];
const porPrefijo = (part) => /^(FW|DW)/i.test(part) ? "Windshield Replacement" : /^(FB|DB)/i.test(part) ? "Back Glass" : /^(FD|DD)/i.test(part) ? "Door Glass Replacement" : null;
(async () => {
  const wos = [...Object.keys(QUITAR), ...RELABEL];
  const rows = (await pool.query(`SELECT q.id, w.work_order_no wo, w.job_type wjob, w.total_sale::float ts, COALESCE((w.payment->>'amount')::float,0) - COALESCE((w.payment->>'cashComeback')::float,0) cobrado, q.line_items li, q.upsell::float ups
    FROM quotes q JOIN work_orders w ON w.quote_id=q.id AND w.active<>false WHERE w.work_order_no = ANY($1) ORDER BY w.appointment_date`, [wos])).rows;
  if (APPLY) fs.writeFileSync(`backups/tier-solo-vidrios-respaldo-2026-09-07.json`, JSON.stringify(rows, null, 1));
  for (const r of rows) {
    const items = r.li.map((l) => ({ ...l }));
    const notas = [];
    if (QUITAR[r.wo]) for (const l of items) if (l.priceTier && QUITAR[r.wo].test(l.jobType || "")) { notas.push(`quitar tier a ${l.jobType} (${l.priceTier})`); l.priceTier = ""; l.priceTierAmount = 0; l.laborCharged = 0; l.tierRemoved = { actor: ACTOR }; }
    if (RELABEL.includes(r.wo)) {
      const tiposWo = String(r.wjob || "").split(",").map((s) => s.trim()).filter((s) => GLASS.test(s));
      for (const l of items) {
        if (!l.priceTier || GLASS.test(l.jobType || "") || !l.partNumber) continue;
        let tipo = null;
        if (r.wo === "Wo-0251") tipo = "Rear Right Door Glass"; // FD21573 YPY, NAGS "R/R"
        else if (tiposWo.length === 1) tipo = tiposWo[0];
        else tipo = porPrefijo(l.partNumber);
        if (!tipo) { notas.push(`SIN TIPO para ${l.partNumber}`); continue; }
        notas.push(`${l.jobType || "(sin tipo)"} -> ${tipo} (${l.partNumber})`);
        l.jobTypeCorrected = { from: l.jobType || "", actor: ACTOR }; l.jobType = tipo; l.isTaxable = true;
      }
    }
    const q = await qs.get(r.id);
    const antes = money(q.totals.totalAmount);
    const tot = qs.__computeTotalsForTest({ ...q, lineItems: items });
    const upsell = money(Math.max(0, money(r.cobrado) - money(tot.totalAmount)));
    console.log(`${r.wo}: ${notas.join("; ")} | cotización $${antes} -> $${money(tot.totalAmount)} | precio orden $${r.ts} | cobrado $${r.cobrado} | upsell $${r.ups} -> $${upsell} | saldo $${money(Math.max(0, tot.totalAmount - r.cobrado))}`);
    if (APPLY) await pool.query("UPDATE quotes SET line_items=$2::jsonb, upsell=$3, updated_at=now(), updated_by=$4 WHERE id=$1", [r.id, JSON.stringify(items), upsell, ACTOR]);
  }
  await pool.end();
})().catch((e) => { console.error(e.stack); process.exit(1); });
