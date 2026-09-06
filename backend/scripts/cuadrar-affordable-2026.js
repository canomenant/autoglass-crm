require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
// Cuadre Affordable Glass 2026: los lotes "WOs por vincular" de la tarjeta 0533 (importación de compras)
// contra las facturas/devoluciones PDF (Documents/Affordable statements PDF/_docs.json) y las obligaciones
// pendientes de las órdenes.
//
//   node scripts/cuadrar-affordable-2026.js            -> solo reporte
//   node scripts/cuadrar-affordable-2026.js --apply    -> escribe
//
// Regla (Antonio): el costo de la pieza en la orden es lo que se pagó al distribuidor (la factura).
const fs = require("fs");
const path = require("path");
const pool = require("../src/config/db");
const statementsStore = require("../src/store/statements.store");

const APPLY = process.argv.includes("--apply");
const ACTOR = "Cuadre Affordable 2026 (2026-09-06)";
const D = "C:/Users/Antonio Cano/OneDrive - 5l3mgq/Documents/Affordable statements PDF/";
const money = (n) => Math.round(Number(n || 0) * 100) / 100;
const fmt = (n) => money(n).toFixed(2);
const c = (n) => Math.round(n * 100);
const key = (s) => String(s || "").toUpperCase().replace(/\s+/g, "").slice(0, 7);
const dias = (a, b) => Math.abs(new Date(a) - new Date(b)) / 86400000;
const informe = [];
function log(...a) { const s = a.join(" "); informe.push(s); console.log(s); }
function titulo(t) { log("\n" + "=".repeat(78) + "\n" + t + "\n" + "=".repeat(78)); }

(async () => {
  log(`Affordable 2026 — ${APPLY ? "APLICANDO" : "SOLO REPORTE"} — ${new Date().toISOString()}`);
  const docs = JSON.parse(fs.readFileSync(D + "_docs.json", "utf8"))
    .filter((d) => (d.kind === "INVOICE" || d.kind === "RETURN") && d.subtotal != null && d.date >= "2026-02-01")
    .map((d) => ({ ...d, amt: d.kind === "RETURN" ? -d.subtotal : d.subtotal }))
    .sort((a, b) => a.date.localeCompare(b.date) || a.num.localeCompare(b.num));
  const yaUsados = new Set((await pool.query("SELECT invoice_number FROM distributor_statement WHERE active AND distributor='Affordable Glass' AND payout_id IS NOT NULL")).rows.map((r) => r.invoice_number));
  const libres = docs.filter((d) => !yaUsados.has(d.num));

  titulo("1. Lotes Affordable 2026 sin órdenes (importación de tarjeta)");
  const lots = (await pool.query(`SELECT o.id, o.payment_number pn, o.payment_date::text d, o.total_amount::float tot, o.invoices
    FROM payouts o WHERE o.type='DISTRIBUTOR' AND o.active<>false AND o.status<>'Cancelled' AND o.payment_date::date>='2026-02-15'
      AND o.notes ILIKE '%AFFORDABLE%' AND NOT EXISTS (SELECT 1 FROM payable pb WHERE pb.payout_id=o.id) ORDER BY o.payment_date`)).rows;
  for (const L of lots) log(`  ${L.pn} ${L.d} $${fmt(L.tot)}`);
  log(`  ${lots.length} lotes, $${fmt(lots.reduce((s, l) => s + l.tot, 0))} | documentos libres desde feb-2026: ${libres.length}`);

  const pend = (await pool.query(`SELECT p.id, p.work_order_no wo, p.amount::float a, p.part_number part, w.appointment_date::text ad, w.customer_name cn, w.part_number wpart
    FROM payable p LEFT JOIN work_orders w ON w.work_order_no=p.work_order_no
    WHERE p.kind='DISTRIBUTOR' AND p.payout_id IS NULL AND p.party ILIKE 'Afford%' AND p.work_order_no IS NOT NULL ORDER BY w.appointment_date`)).rows;

  titulo("2. Composición de cada lote y cruce renglón por renglón con las órdenes");
  const usados = new Set(); const tomadas = new Set();
  const plan = []; const dudas = [];
  for (const L of lots) {
    const cand = libres.filter((d) => !usados.has(d.num) && d.date <= L.d);
    const T = c(L.tot);
    const sols = [];
    for (let i = 0; i < cand.length; i++) { let s = 0; for (let j = i; j < cand.length && j < i + 25; j++) { s += c(cand[j].amt); if (Math.abs(s - T) <= 1) sols.push({ r: cand.slice(i, j + 1), dif: s - T }); } }
    let sol = null;
    let tipo = "contiguo";
    if (sols.length) sol = sols.sort((a, b) => Math.abs(a.dif) - Math.abs(b.dif) || Math.abs(new Date(a.r[a.r.length - 1].date) - new Date(L.d)) - Math.abs(new Date(b.r[b.r.length - 1].date) - new Date(L.d)))[0];
    if (!sol) {
      const ult = cand.slice(-30); const subs = [];
      (function rec(i, s, ch) { if (subs.length > 1) return; if (s === T && ch.length) { subs.push([...ch]); return; } if (i >= ult.length || ch.length >= 6) return; ch.push(ult[i]); rec(i + 1, s + c(ult[i].amt), ch); ch.pop(); rec(i + 1, s, ch); })(0, 0, []);
      if (subs.length === 1) { sol = { r: subs[0], dif: 0 }; tipo = "salteado"; }
    }
    if (!sol) { log(`\n  ${L.pn} ${L.d} $${fmt(L.tot)} — SIN CUADRE`); dudas.push(`${L.pn} $${fmt(L.tot)}: ningún grupo de facturas suma el cargo`); continue; }
    sol.r.forEach((d) => usados.add(d.num));
    log(`\n  ${L.pn} ${L.d} $${fmt(L.tot)} = ${sol.r.map((d) => d.num + " " + d.date + " $" + fmt(d.amt)).join(" + ")}${sol.dif ? ` (${sol.dif > 0 ? "+" : ""}${sol.dif}¢)` : ""}`);
    const item = { L, docs: sol.r, tipo, links: [], sinOrden: [], devol: [] };
    // renglones netos por pieza dentro del lote (compra − devolución de la misma pieza)
    const net = {};
    const consumidos = new Set();
    for (const d of sol.r.filter((d) => d.kind === "INVOICE")) {
      const o = pend.filter((p) => !tomadas.has(p.id) && Math.abs(p.a - d.subtotal) < 0.005 && dias(p.ad, d.date) <= 21 && (!p.part || d.items.some((it) => key(it.part) === key(p.part)))).sort((a, b) => dias(a.ad, d.date) - dias(b.ad, d.date))[0];
      if (!o) continue;
      tomadas.add(o.id); consumidos.add(d.num);
      const n = { part: d.items.map((it) => it.part).join(" + ") || o.part || "(factura sin renglones)", ext: money(d.subtotal), docs: [d.num] };
      item.links.push({ o, n });
      log(`     factura completa ${d.num} ${fmt(d.subtotal).padStart(8)}  -> ${o.wo} ${o.ad.slice(0, 10)} ${o.cn || ""} oblig ${fmt(o.a)} (${n.part})`);
    }
    for (const d of sol.r) for (const it of d.items) { if (consumidos.has(d.num)) continue; const k = key(it.part); net[k] = net[k] || { part: it.part, ext: 0, docs: [] }; net[k].ext += d.kind === "RETURN" ? -it.ext : it.ext; net[k].docs.push(d.num); }
    for (const d of sol.r.filter((d) => d.kind === "RETURN")) item.devol.push(d);
    for (const [k, n] of Object.entries(net)) {
      n.ext = money(n.ext);
      if (n.ext <= 0) { log(`     ${n.part.padEnd(14)} $${fmt(n.ext).padStart(8)}  comprada y devuelta (${n.docs.join(", ")}) — sin orden`); continue; }
      const dmax = sol.r[sol.r.length - 1].date;
      const o = pend.filter((p) => !tomadas.has(p.id) && key(p.part) === k && dias(p.ad, dmax) <= 21).sort((a, b) => Math.abs(a.a - n.ext) - Math.abs(b.a - n.ext))[0]
        || pend.filter((p) => !tomadas.has(p.id) && !p.part && Math.abs(p.a - n.ext) < 0.005 && dias(p.ad, dmax) <= 21)[0];
      if (o) { tomadas.add(o.id); item.links.push({ o, n }); log(`     ${n.part.padEnd(14)} $${fmt(n.ext).padStart(8)}  -> ${o.wo} ${o.ad.slice(0, 10)} ${o.cn || ""} oblig $${fmt(o.a)}${Math.abs(o.a - n.ext) > 0.005 ? " (≠, se ajusta al precio de factura)" : ""}`); continue; }
      // sin obligación pendiente: ¿orden con esa pieza cerca de la fecha?
      const w = (await pool.query(`SELECT w.work_order_no wo, w.appointment_date::text ad, w.distributor, w.customer_name cn, w.glass_cost::float gc,
          (SELECT string_agg(coalesce(o.payment_number,'pend')||' '||p.party||' $'||p.amount, '; ') FROM payable p LEFT JOIN payouts o ON o.id=p.payout_id WHERE p.work_order_no=w.work_order_no AND p.kind='DISTRIBUTOR') ob
        FROM work_orders w WHERE upper(replace(w.part_number,' ','')) LIKE $1 AND w.appointment_date BETWEEN $2::date - 21 AND $2::date + 21 ORDER BY abs(w.appointment_date - $2::date)`, ["%" + k + "%", dmax])).rows;
      item.sinOrden.push({ n, w });
      log(`     ${n.part.padEnd(14)} $${fmt(n.ext).padStart(8)}  SIN OBLIGACIÓN PENDIENTE ${w.length ? "| órdenes con esa pieza: " + w.map((x) => `${x.wo} ${x.ad.slice(0, 10)} ${x.cn || ""} (${x.distributor || "-"}; ${x.ob || "sin obligación"})`).join("; ") : "| ninguna orden con esa pieza ±21 días"}`);
    }
    for (const d of sol.r.filter((d) => d.kind === "INVOICE" && !d.items.length)) log(`     ${d.num} $${fmt(d.amt)} sin renglones legibles en el PDF (${d.file})`);
    plan.push(item);
  }
  // piezas pagadas sin orden que se devolvieron después en otro lote => "devuelta" (débito aquí, crédito allá); lo demás es duda
  for (const item of plan) {
    for (const s of item.sinOrden) s.devuelta = plan.some((p2) => p2 !== item && p2.docs.some((d) => d.kind === "RETURN" && d.date > item.docs[item.docs.length - 1].date && d.items.some((it) => key(it.part) === key(s.n.part))));
    const pendientes = item.sinOrden.filter((s) => !s.devuelta);
    item.ok = item.tipo === "contiguo" && !pendientes.length;
    log(`  ${item.L.pn}: ${item.ok ? "SE APLICA" : "DUDA — " + (item.tipo !== "contiguo" ? "combinación salteada de facturas; " : "") + pendientes.map((s) => s.n.part + " $" + fmt(s.n.ext) + " sin orden").join(", ")}`);
  }
  const sobran = libres.filter((d) => !usados.has(d.num));
  log(`\n  documentos 2026 que no entraron en ningún lote: ${sobran.length} ($${fmt(sobran.reduce((s, d) => s + d.amt, 0))})`);
  for (const d of sobran) log(`     ${d.num} ${d.date} $${fmt(d.amt)} PO:${d.po || "-"} ${d.items.map((i) => i.part).join(", ")}`);
  const quedan = pend.filter((p) => !tomadas.has(p.id));
  log(`\n  obligaciones Affordable pendientes que siguen sin lote: ${quedan.length} ($${fmt(quedan.reduce((s, p) => s + p.a, 0))})`);
  for (const p of quedan) log(`     ${p.wo} ${(p.ad || "").slice(0, 10)} ${p.part || "(sin pieza)"} $${fmt(p.a)}`);

  if (!APPLY) { guardar(); await pool.end(); return; }

  titulo("3. Aplicar");
  const aplicar = plan.filter((x) => x.ok);
  const respaldo = { payouts: (await pool.query("SELECT * FROM payouts WHERE id = ANY($1)", [aplicar.map((x) => x.L.id)])).rows, payable: (await pool.query("SELECT * FROM payable WHERE id = ANY($1)", [aplicar.flatMap((x) => x.links.map((l) => l.o.id))])).rows, work_orders: (await pool.query("SELECT * FROM work_orders WHERE work_order_no = ANY($1)", [aplicar.flatMap((x) => x.links.map((l) => l.o.wo))])).rows };
  fs.writeFileSync(path.join(__dirname, "..", "backups", `affordable-2026-respaldo-${new Date().toISOString().slice(0, 10)}.json`), JSON.stringify(respaldo, null, 1));
  let registrados = 0;
  for (const item of plan.filter((x) => x.ok)) {
    const { L } = item;
    for (const { o, n } of item.links) {
      await pool.query("UPDATE payable SET payout_id=$2, status='pagado', amount=$3, party='Affordable Glass', part_number=COALESCE(NULLIF(part_number,''),$4), part_description=COALESCE(part_description,'')||$5, updated_at=now() WHERE id=$1",
        [o.id, L.id, n.ext, n.part, ` | Factura ${n.docs.join("/")} de Affordable, pagada en ${L.pn} (${ACTOR})${Math.abs(o.a - n.ext) > 0.005 ? `; antes $${fmt(o.a)}` : ""}`]);
      await pool.query("UPDATE work_orders w SET glass_cost=(SELECT COALESCE(sum(amount),0) FROM payable WHERE work_order_no=w.work_order_no AND kind='DISTRIBUTOR'), glass_cost_source='obligaciones', distributor=CASE WHEN distributor IS NULL OR distributor='' THEN 'Affordable Glass' ELSE distributor END, updated_at=now(), updated_by=$2 WHERE work_order_no=$1", [o.wo, ACTOR]);
    }
    const ob = money(item.links.reduce((s, x) => s + x.n.ext, 0));
    const dn = money(item.sinOrden.reduce((s, x) => s + x.n.ext, 0)); // piezas pagadas sin orden (pendientes de decidir)
    const cn = money(-item.devol.reduce((s, d) => s + d.amt, 0) - item.docs.filter((d) => d.kind === "INVOICE").reduce((s, d) => s + d.subtotal, 0) + ob + dn); // devoluciones de piezas de otro lote
    const cnFinal = Math.max(0, money(cn));
    const total = money(ob + dn - cnFinal);
    if (Math.abs(total - L.tot) > 0.011) { log(`  ${L.pn}: no cierra (${fmt(ob)} + ${fmt(dn)} − ${fmt(cnFinal)} = ${fmt(total)} vs ${fmt(L.tot)}); se deja el subtotal = obligaciones y la diferencia como débito`); }
    const dnFinal = money(L.tot - ob + cnFinal);
    await pool.query(`UPDATE payouts SET subtotal=$2, base_amount=$2, debit_notes_total=$3, credit_notes_total=$4, legacy_adjustments=$5, notes=COALESCE(notes,'')||$6, updated_at=now(), updated_by=$7 WHERE id=$1`,
      [L.id, ob, dnFinal, cnFinal, dnFinal > 0 || cnFinal > 0, ` | ${ACTOR}: ${item.docs.map((d) => d.num).join(", ")}; órdenes $${fmt(ob)}${dnFinal ? `; piezas compradas y devueltas después ${fmt(dnFinal)} (débito)` : ""}${cnFinal ? `; devoluciones de piezas de otro pago $${fmt(cnFinal)} (crédito)` : ""}.`, ACTOR]);
    const ids = [];
    for (const d of item.docs) {
      const ex = (await pool.query("SELECT id, payout_id FROM distributor_statement WHERE active AND upper(invoice_number) = upper($1)", [d.num])).rows[0];
      if (ex) { if (!ex.payout_id) ids.push(ex.id); continue; }
      const ins = await pool.query(
        `INSERT INTO distributor_statement (invoice_number, distributor, branch, kind, issue_date, due_date, amount, paid_amount, status, terms_days, source, notes)
         VALUES ($1,'Affordable Glass','Houston, TX',$2,$3::date,$3::date + 7,$4,0,'paid',7,'pdf_affordable',$5) RETURNING id`,
        [d.num, d.kind === "RETURN" ? "CREDIT_MEMO" : "INVOICE", d.date, d.amt, `Del PDF ${d.file} (${ACTOR})${d.po ? "; PO " + d.po : ""}`]);
      ids.push(ins.rows[0].id); registrados++;
      for (const it of d.items || []) {
        const link = item.links.find((x) => x.n.docs.includes(d.num) && x.n.part.split(" + ").some((pp) => key(pp) === key(it.part))) || item.links.find((x) => key(x.n.part) === key(it.part));
        await pool.query(
          `INSERT INTO distributor_statement_line (statement_id, req_no, line_date, qty, part_number, amount, customer_name, work_order_no, classification, match_source)
           VALUES ($1,$2,$3::date,$4,$5,$6,$7,$8,$9,'pdf_affordable')`,
          [ins.rows[0].id, d.num, d.date, it.qty, it.part, d.kind === "RETURN" ? -it.ext : it.ext, it.desc, link ? link.o.wo : null, d.kind === "RETURN" ? "CREDIT" : link ? "INSTALLED" : "UNDECIDED"]);
      }
    }
    if (ids.length) await statementsStore.applyToPayout(ids, L.id, {});
    const inv = item.docs.map((d) => ({ number: d.num, date: d.date, amount: money(d.amt) }));
    await pool.query("UPDATE payouts SET invoices = $2::jsonb, invoice_total = $3, updated_at = now() WHERE id = $1", [L.id, JSON.stringify(inv), money(inv.reduce((s, i) => s + i.amount, 0))]);
    log(`  ${L.pn}: ${item.links.length} órdenes ($${fmt(ob)}), débito $${fmt(dnFinal)}, crédito $${fmt(cnFinal)}, ${item.docs.length} statements`);
  }
  log(`  statements nuevos: ${registrados}`);

  titulo("Verificación");
  const v = (await pool.query(`SELECT o.payment_number pn, o.payment_date::text d, o.total_amount::float t, o.subtotal::float s, o.debit_notes_total::float dn, o.credit_notes_total::float cn,
      (SELECT COALESCE(sum(amount),0)::float FROM payable WHERE payout_id=o.id) ob, (SELECT COALESCE(sum(amount),0)::float FROM distributor_statement s WHERE s.payout_id=o.id AND s.active) st
    FROM payouts o WHERE o.id = ANY($1) ORDER BY o.payment_date`, [plan.filter((x) => x.ok).map((x) => x.L.id)])).rows;
  let ok = 0;
  for (const x of v) { const f1 = Math.abs(x.s + x.dn - x.cn - x.t) < 0.005, f2 = Math.abs(x.ob - x.s) < 0.005, f3 = Math.abs(x.st - x.t) <= 0.011; if (f1 && f2 && f3) ok++; else log(`  ${x.pn} ${x.d} pagado $${fmt(x.t)} | fórmula ${f1 ? "ok" : "≠"} | oblig $${fmt(x.ob)} vs sub $${fmt(x.s)} ${f2 ? "ok" : "≠"} | statements $${fmt(x.st)} ${f3 ? "ok" : "≠"}`); }
  log(`  ${ok} de ${v.length} lotes cierran en las tres pruebas`);
  guardar();
  await pool.end();

  function guardar() {
    const out = path.join(__dirname, "..", "backups", `affordable-2026-informe-${APPLY ? "apply" : "reporte"}-${new Date().toISOString().slice(0, 10)}.txt`);
    fs.writeFileSync(out, informe.join("\n"));
    console.log(`\nInforme guardado en ${out}`);
  }
})().catch(async (e) => { console.error("\nERROR:", e.stack || e.message); try { await pool.end(); } catch {} process.exit(1); });
