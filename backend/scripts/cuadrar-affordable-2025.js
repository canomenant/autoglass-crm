require("dotenv").config();
const fs = require("fs");
const path = require("path");
const pool = require("../src/config/db");
const statementsStore = require("../src/store/statements.store");

// Affordable Auto Glass 2025: sus facturas (INV) y devoluciones (RTN) salen de los PDF que Antonio
// exportó de Outlook (carpeta "INVOICE AFFORDABLE", 6-sep-2026) y ya están leídos en
// Documents/Affordable statements PDF/_docs.json. Affordable cobra a 7 días con la tarjeta 0533
// (en feb–mar 2025 como "SQ *PAYLESS GLASS LP"), así que cada lote es el rango de documentos
// seguidos que suma exactamente lo cobrado.
//
//   node scripts/cuadrar-affordable-2025.js            -> reporta
//   node scripts/cuadrar-affordable-2025.js --apply    -> escribe
//
// Lo que hace: registra cada documento como statement y lo amarra a su lote; corrige los tres
// lotes cuyo total no era lo que cobró la tarjeta (Dist-0007, Dist-0169) o no tenía órdenes
// (Dist-0142); y borra las obligaciones sin orden que eran las partes de las notas de AppSheet.

const APPLY = process.argv.includes("--apply");
const ACTOR = "Cuadre Affordable 2025 (2026-09-06)";
const CARD = "Business Credit Card ...ending with 0533";
const D = "C:/Users/Antonio Cano/OneDrive - 5l3mgq/Documents/Affordable statements PDF/";
const money = (n) => Math.round(Number(n || 0) * 100) / 100;
const fmt = (n) => money(n).toFixed(2);
const c = (n) => Math.round(n * 100);
const informe = [];
function log(...a) { const s = a.join(" "); informe.push(s); console.log(s); }
function titulo(t) { log("\n" + "=".repeat(78) + "\n" + t + "\n" + "=".repeat(78)); }
const tx = (d, m) => [{ id: 1, date: d, amount: money(m), paymentMethod: CARD, paymentGateway: "Manual", transactionReference: "" }];

(async () => {
  log(`Affordable 2025 — ${APPLY ? "APLICANDO" : "SOLO REPORTE"} — ${new Date().toISOString()}`);
  const docs = JSON.parse(fs.readFileSync(D + "_docs.json", "utf8"))
    .filter((d) => (d.kind === "INVOICE" || d.kind === "RETURN") && d.subtotal != null && d.date >= "2024-12-01" && d.date < "2026-03-01")
    .map((d) => ({ ...d, amt: d.kind === "RETURN" ? -d.subtotal : d.subtotal })).sort((a, b) => a.date.localeCompare(b.date) || a.num.localeCompare(b.num));

  // ---------------------------------------------------------------------------------------
  titulo("1. Totales que la tarjeta y las facturas corrigen");
  const fijos = [
    { pn: "Dist-0007", total: 875.94, fecha: "2025-02-11", nota: "11 documentos del 6-ene al 8-feb (9 facturas y 2 devoluciones); la tarjeta cobró $875.94 el 11-feb, AppSheet decía $897.46" },
    { pn: "Dist-0169", total: 465.10, fecha: "2025-11-18", nota: "la tarjeta cobró $465.10 el 18-nov: las 6 facturas del estado del 16-nov ($431.13) más la INV2247387 del 17-nov ($33.97, DD13334)" },
  ];
  for (const x of fijos) {
    const L = (await pool.query("SELECT id, total_amount::float t, subtotal::float s, debit_notes_total::float dn, credit_notes_total::float cn FROM payouts WHERE payment_number = $1", [x.pn])).rows[0];
    if (Math.abs(L.t - x.total) < 0.005) { log(`  ${x.pn} ya está en $${fmt(x.total)}`); continue; }
    const sub = money(x.total - L.dn + L.cn);
    log(`  ${x.pn}: $${fmt(L.t)} -> $${fmt(x.total)} (subtotal $${fmt(L.s)} -> $${fmt(sub)}) — ${x.nota}`);
    if (APPLY) await pool.query(`UPDATE payouts SET total_amount = $2, net_amount = $2, subtotal = $3, base_amount = $3, transactions = $4::jsonb, notes = COALESCE(notes,'') || $5, updated_at = now(), updated_by = $6 WHERE id = $1`,
      [L.id, x.total, sub, JSON.stringify(tx(x.fecha, x.total)), ` | ${ACTOR}: ${x.nota}.`, ACTOR]);
  }

  // ---------------------------------------------------------------------------------------
  titulo("2. Dist-0142: sus dos partes con orden (facturas INV2230796 e INV2232638)");
  const d142 = (await pool.query("SELECT id FROM payouts WHERE payment_number = 'Dist-0142'")).rows[0].id;
  for (const [id, wo, monto, part] of [[9707, "Wo-1968", 136.00, "FW06091 GTY"], [9770, "Wo-2020", 133.00, "FW05462 GTY"]]) {
    const o = (await pool.query("SELECT amount::float a, payout_id FROM payable WHERE id = $1", [id])).rows[0];
    if (o.payout_id) { log(`  ${wo} ya está en el lote`); continue; }
    log(`  ${wo} ${part}: obligación $${fmt(o.a)} -> $${fmt(monto)} (Affordable Glass), al lote Dist-0142`);
    if (APPLY) {
      await pool.query("UPDATE payable SET amount = $2, party = 'Affordable Glass', status = 'pagado', payout_id = $3, updated_at = now() WHERE id = $1", [id, monto, d142]);
      await pool.query("UPDATE work_orders SET distributor = 'Affordable Glass', glass_cost = $2, glass_cost_source = 'obligaciones', updated_at = now(), updated_by = $3 WHERE work_order_no = $1", [wo, monto, ACTOR]);
    }
  }

  // ---------------------------------------------------------------------------------------
  titulo("3. Obligaciones sin orden de Affordable: son las partes de las notas de AppSheet (débitos ya en los lotes)");
  const huerf = (await pool.query(`SELECT id, amount::float a, part_number FROM payable WHERE kind='DISTRIBUTOR' AND btrim(party) ILIKE 'Affordable%' AND work_order_no IS NULL
      AND (payout_id IS NULL OR payout_id = (SELECT id FROM payouts WHERE payment_number='Dist-0010')) AND id IN (7152,7153,7165,7215,7247,7283,7414,7176)`)).rows;
  log(`  ${huerf.length} obligaciones: ${huerf.map((h) => `#${h.id} $${fmt(h.a)} ${h.part_number}`).join(", ")}`);
  if (APPLY && huerf.length) await pool.query("DELETE FROM payable WHERE id = ANY($1::bigint[])", [huerf.map((h) => h.id)]);
  // Dist-0010: al quitar la DD12500 ($34.33, que era una devolución) el subtotal vuelve a ser el total cobrado
  if (APPLY) await pool.query("UPDATE payouts SET subtotal = 340.19, base_amount = 340.19, updated_at = now() WHERE payment_number = 'Dist-0010'");

  // ---------------------------------------------------------------------------------------
  titulo("4. Registrar facturas y devoluciones como statements y amarrarlas a su lote");
  const lots = (await pool.query(`SELECT o.id, o.payment_number pn, o.payment_date::text d, o.total_amount::float tot, o.invoices
    FROM payouts o WHERE o.type='DISTRIBUTOR' AND o.active<>false AND o.status<>'Cancelled' AND o.payment_date::date>='2025-01-01' AND o.payment_date::date<'2026-02-15'
      AND (EXISTS (SELECT 1 FROM payable pb WHERE pb.payout_id=o.id AND btrim(pb.party) ILIKE 'Affordable%') OR o.payment_number IN ('Dist-0142','Dist-0181'))
      AND NOT EXISTS (SELECT 1 FROM payable pb WHERE pb.payout_id=o.id AND pb.party ILIKE 'Mygrant%') ORDER BY o.payment_date`)).rows;
  for (const L of lots) if (fijos.some((x) => x.pn === L.pn)) L.tot = fijos.find((x) => x.pn === L.pn).total;
  const usados = new Set();
  let amarrados = 0, registrados = 0, sinCuadre = [];
  for (const L of lots) {
    const cand = docs.filter((d) => !usados.has(d.num) && d.date <= L.d);
    const T = c(L.tot);
    const sols = [];
    for (let i = 0; i < cand.length; i++) { let s = 0; for (let j = i; j < cand.length && j < i + 25; j++) { s += c(cand[j].amt); if (Math.abs(s - T) <= 1) sols.push({ r: cand.slice(i, j + 1), dif: s - T }); } }
    let sol = null;
    if (sols.length) sol = sols.sort((a, b) => Math.abs(a.dif) - Math.abs(b.dif) || Math.abs(new Date(a.r[a.r.length - 1].date) - new Date(L.d)) - Math.abs(new Date(b.r[b.r.length - 1].date) - new Date(L.d)))[0];
    if (!sol) {
      const ult = cand.slice(-30); const subs = [];
      (function rec(i, s, ch) { if (subs.length > 1) return; if (s === T && ch.length) { subs.push([...ch]); return; } if (i >= ult.length || ch.length >= 6) return; ch.push(ult[i]); rec(i + 1, s + c(ult[i].amt), ch); ch.pop(); rec(i + 1, s, ch); })(0, 0, []);
      if (subs.length === 1) sol = { r: subs[0], dif: 0 };
    }
    if (!sol) { sinCuadre.push(L); log(`  ${L.pn} ${L.d} $${fmt(L.tot)} — SIN CUADRE`); continue; }
    sol.r.forEach((d) => usados.add(d.num));
    log(`  ${L.pn} ${L.d} $${fmt(L.tot)} = ${sol.r.length} documentos (${sol.r[0].date} a ${sol.r[sol.r.length - 1].date})${sol.dif ? ` con ${sol.dif > 0 ? "+" : ""}${sol.dif}¢ de redondeo` : ""}`);
    amarrados++;
    if (!APPLY) continue;
    const ids = [];
    for (const d of sol.r) {
      const ex = (await pool.query("SELECT id, payout_id FROM distributor_statement WHERE active AND upper(invoice_number) = upper($1)", [d.num])).rows[0];
      if (ex) { if (!ex.payout_id) ids.push(ex.id); continue; }
      const ins = await pool.query(
        `INSERT INTO distributor_statement (invoice_number, distributor, branch, kind, issue_date, due_date, amount, paid_amount, status, terms_days, source, notes)
         VALUES ($1,'Affordable Glass','Houston, TX',$2,$3::date,$3::date + 7,$4,0,'paid',7,'pdf_affordable',$5) RETURNING id`,
        [d.num, d.kind === "RETURN" ? "CREDIT_MEMO" : "INVOICE", d.date, d.amt, `Del PDF ${d.file} (${ACTOR})${d.po ? "; PO " + d.po : ""}`]);
      ids.push(ins.rows[0].id); registrados++;
      if (d.items?.length) {
        for (const it of d.items) await pool.query(
          `INSERT INTO distributor_statement_line (statement_id, req_no, line_date, qty, part_number, amount, customer_name, work_order_no, classification, match_source)
           VALUES ($1,$2,$3::date,$4,$5,$6,$7,NULL,$8,'pdf_affordable')`,
          [ins.rows[0].id, d.num, d.date, it.qty, it.part, d.kind === "RETURN" ? -it.ext : it.ext, it.desc, d.kind === "RETURN" ? "CREDIT" : "UNDECIDED"]);
      }
    }
    if (ids.length) await statementsStore.applyToPayout(ids, L.id, {});
    if (!Array.isArray(L.invoices) || !L.invoices.length) {
      const inv = sol.r.map((d) => ({ number: d.num, date: d.date, amount: money(d.amt) }));
      await pool.query("UPDATE payouts SET invoices = $2::jsonb, invoice_total = $3, updated_at = now(), updated_by = $4 WHERE id = $1", [L.id, JSON.stringify(inv), money(inv.reduce((s, i) => s + i.amount, 0)), ACTOR]);
    }
  }
  const sobran = docs.filter((d) => !usados.has(d.num) && d.date >= "2025-01-01" && d.date < "2026-01-01");
  log(`  -> ${amarrados} lotes amarrados, ${registrados} statements nuevos; documentos 2025 sin lote: ${sobran.length} ($${fmt(sobran.reduce((s, d) => s + d.amt, 0))})`);
  for (const d of sobran) log(`     ${d.num} ${d.date} $${fmt(d.amt)} ${d.items.map((i) => i.part).join(", ")}`);

  // ---------------------------------------------------------------------------------------
  titulo("Verificación");
  const v = (await pool.query(`SELECT o.payment_number pn, o.payment_date::text d, o.total_amount::float t, o.subtotal::float s, o.debit_notes_total::float dn, o.credit_notes_total::float cn,
      (SELECT COALESCE(sum(amount),0)::float FROM payable WHERE payout_id=o.id) ob, (SELECT COALESCE(sum(amount),0)::float FROM distributor_statement s WHERE s.payout_id=o.id AND s.active) st
    FROM payouts o WHERE o.id = ANY($1) ORDER BY o.payment_date`, [lots.map((l) => l.id)])).rows;
  let ok = 0;
  for (const x of v) { const f1 = Math.abs(x.s + x.dn - x.cn - x.t) < 0.005, f2 = Math.abs(x.ob - x.s) < 0.005, f3 = Math.abs(x.st - x.t) <= 0.011; if (f1 && f2 && f3) ok++; else log(`  ${x.pn} ${x.d} pagado $${fmt(x.t)} | fórmula ${f1 ? "ok" : "≠"} | oblig $${fmt(x.ob)} vs sub $${fmt(x.s)} ${f2 ? "ok" : "≠"} | statements $${fmt(x.st)} ${f3 ? "ok" : "≠"}`); }
  log(`  ${ok} de ${v.length} lotes cierran en las tres pruebas`);
  const out = path.join(__dirname, "..", "backups", `affordable-2025-informe-${APPLY ? "apply" : "reporte"}-${new Date().toISOString().slice(0, 10)}.txt`);
  fs.writeFileSync(out, informe.join("\n"));
  console.log(`\nInforme guardado en ${out}`);
  await pool.end();
})().catch(async (e) => { console.error("\nERROR:", e.stack || e.message); try { await pool.end(); } catch {} process.exit(1); });
