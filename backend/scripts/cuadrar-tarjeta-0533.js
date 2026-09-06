require("dotenv").config();
const fs = require("fs");
const path = require("path");
const pool = require("../src/config/db");
const statementsStore = require("../src/store/statements.store");

// Cruce de los cargos de Mygrant en la tarjeta Business ...0533 (CSV del banco, 1-ene-2025 al
// 10-sep-2026) contra los lotes del sistema. Regla de Antonio (6-sep-2026): la tarjeta es la
// verdad; los montos distintos venían de AppSheet. 145 cargos ya cuadraban; esto corrige el resto.
//
//   node scripts/cuadrar-tarjeta-0533.js            -> reporta
//   node scripts/cuadrar-tarjeta-0533.js --apply    -> respalda y escribe
//
// No se toca: los 22 cargos de ene–feb 2025 (facturas de 2024, dijo Antonio), Dist-0163 (la nota
// de $358.12 se revisa con él antes), y los lotes pagados por Chase o Capital One.

const APPLY = process.argv.includes("--apply");
const ACTOR = "Cuadre tarjeta 0533 (2026-09-06)";
const CARD = "Business Credit Card ...ending with 0533";
const money = (n) => Math.round(Number(n || 0) * 100) / 100;
const fmt = (n) => money(n).toFixed(2);
const eq = (a, b) => Math.abs(money(a) - money(b)) < 0.005;
const informe = [];
function log(...a) { const s = a.join(" "); informe.push(s); console.log(s); }
function titulo(t) { log("\n" + "=".repeat(78) + "\n" + t + "\n" + "=".repeat(78)); }
async function lote(pn) { const r = await pool.query("SELECT * FROM payouts WHERE payment_number = $1", [pn]); if (!r.rows[0]) throw new Error(`No existe ${pn}`); return r.rows[0]; }
async function stByInv(inv) { const r = await pool.query("SELECT * FROM distributor_statement WHERE active AND invoice_number = $1", [inv]); if (!r.rows[0]) throw new Error(`No existe ${inv}`); return r.rows[0]; }
const tx = (fecha, monto, ref) => ({ id: 1, date: fecha, amount: money(monto), paymentMethod: CARD, paymentGateway: "Manual", transactionReference: ref || "" });

// Cada corrección: total real de la tarjeta (con sus cargos), statements que amarrar, facturas
// parciales para la lista del lote, y notas que cambian de lote.
const CORRECCIONES = [
  { pn: "Dist-0054", total: 3430.77, cargos: [["2025-05-30", 3430.77]], invs: ["I04580076-0", "I04580077-0", "I04580078-0", "I04580079-0"], nota: "Newport Beach y Fresno 9-mar-2025" },
  { pn: "Dist-0057", total: 3333.73, cargos: [["2025-06-02", 3333.73]], invs: ["I04592242-0", "I04592243-0"], nota: "Newport Beach 23-mar-2025", notasSalen: ["DN-0019"] },
  { pn: "Dist-0058", total: 4286.46, cargos: [["2025-06-06", 4286.46]], invs: ["I04595750-0", "I04595751-0", "I04595752-0", "I04597926-0", "I04597927-0", "I04597928-0", "I04597929-0"], nota: "Newport Beach y Fresno 30 y 31-mar-2025", notasEntran: [["DN-0019", "Dist-0057"]] },
  { pn: "Dist-0231", total: 1417.94, cargos: [["2026-03-19", 1417.94]], invs: ["I04870133-0", "I04873633-0"], nota: "Fresno 4-ene y 11-ene-2026" },
  { pn: "Dist-0137", total: 2070.05, cargos: [["2025-10-01", 2070.05]], parciales: { "I04709165-0": 207.18 }, nota: "Irving 20-jul y 31-jul-2025 más $207.18 de la I04709165 de Austin (el resto lo paga Dist-0141)" },
  { pn: "Dist-0141", total: 1041.99, cargos: [["2025-10-03", 520.99], ["2025-10-06", 521.00]], parciales: { "I04709165-0": 1078.92 }, nota: "Dos cargos; la I04709165 entra por $1,078.92 (los otros $207.18 en Dist-0137)" },
  { pn: "Dist-0162", total: 430.19, fecha: "2025-11-10", cargos: [["2025-11-10", 430.19]], nota: "La fecha estaba un mes corrida (10-oct); el cargo es del 10-nov" },
  { pn: "Dist-0032", total: 5523.14, cargos: [["2025-04-04", 5523.14]], nota: "Diez centavos de captura; los statements suman lo de la tarjeta" },
];

async function respaldar() {
  const dir = path.join(__dirname, "..", "backups");
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const nums = [...CORRECCIONES.map((c) => c.pn), "Dist-0203", "Dist-0255", "Dist-0256", "Dist-0003"];
  const out = {
    payouts: (await pool.query("SELECT * FROM payouts WHERE payment_number = ANY($1)", [nums])).rows,
    statements: (await pool.query("SELECT * FROM distributor_statement WHERE invoice_number = ANY($1) OR payout_id IN (SELECT id FROM payouts WHERE payment_number = ANY($2))", [CORRECCIONES.flatMap((c) => c.invs || []), nums])).rows,
    notes: (await pool.query("SELECT * FROM credit_debit_note WHERE note_number IN ('DN-0019')")).rows,
  };
  const file = path.join(dir, `tarjeta-0533-${stamp}.json`);
  fs.writeFileSync(file, JSON.stringify(out));
  log(`Respaldo: ${file} (${out.payouts.length} lotes, ${out.statements.length} statements)`);
}

async function paso1_fusion0203() {
  titulo("1. Dist-0255 + Dist-0256 son los dos cargos de Dist-0203");
  const a = await lote("Dist-0203"), b1 = await lote("Dist-0255"), b2 = await lote("Dist-0256");
  if (b1.active === false && b2.active === false) { log("  ya fusionados"); return; }
  if (!eq(Number(b1.total_amount) + Number(b2.total_amount), a.total_amount)) throw new Error("0255 + 0256 no suman 0203");
  log(`  Dist-0203 $${fmt(a.total_amount)} = $${fmt(b1.total_amount)} (15-ene) + $${fmt(b2.total_amount)} (20-ene); se retiran 0255 y 0256`);
  if (!APPLY) return;
  const trans = [{ ...tx("2026-01-15", b1.total_amount), id: 1 }, { ...tx("2026-01-20", b2.total_amount), id: 2 }];
  await pool.query(
    `UPDATE payouts SET payment_method = $2, transactions = $3::jsonb, reconciled_at = COALESCE(reconciled_at, now()), reconciled_by = COALESCE(reconciled_by, $4),
            notes = COALESCE(notes,'') || $5, audit_log = COALESCE(audit_log,'[]'::jsonb) || jsonb_build_array(jsonb_build_object('timestamp', now(), 'user', $4::text, 'action', 'Two card charges (Dist-0255 + Dist-0256) merged into this payment')),
            updated_at = now(), updated_by = $4 WHERE id = $1`,
    [a.id, CARD, JSON.stringify(trans), ACTOR, ` | Pagado en dos cargos de tarjeta, 15-ene y 20-ene-2026 ($1,814.84 cada uno), que el import registró como Dist-0255 y Dist-0256 (${ACTOR}).`]);
  for (const b of [b1, b2]) await pool.query(
    `UPDATE payouts SET active = false, deleted_at = now(), notes = COALESCE(notes,'') || $2,
            audit_log = COALESCE(audit_log,'[]'::jsonb) || jsonb_build_array(jsonb_build_object('timestamp', now(), 'user', $3::text, 'action', 'Retired: one of the two card charges of Dist-0203')),
            updated_at = now(), updated_by = $3 WHERE id = $1`, [b.id, ` | Retirado (${ACTOR}): es uno de los dos cargos de Dist-0203.`, ACTOR]);
}

async function paso2_correcciones() {
  titulo("2. Totales y statements según la tarjeta");
  for (const c of CORRECCIONES) {
    const L = await lote(c.pn);
    const ya = (await pool.query("SELECT invoice_number, issue_date::text d, amount::float amt FROM distributor_statement WHERE payout_id = $1 AND active ORDER BY issue_date, invoice_number", [L.id])).rows;
    const nuevos = [];
    for (const inv of c.invs || []) { const s = await stByInv(inv); if (s.payout_id && s.payout_id !== L.id) throw new Error(`${inv} ya está en otro lote`); if (!s.payout_id) nuevos.push(s); }
    let dn = Number(L.debit_notes_total), cn = Number(L.credit_notes_total);
    for (const n of c.notasSalen || []) { const x = (await pool.query("SELECT amount::float a, kind FROM credit_debit_note WHERE note_number = $1 AND active", [n])).rows[0]; if (x) { if (x.kind === "DEBIT") dn = money(dn - x.a); else cn = money(cn - x.a); } }
    for (const [n] of c.notasEntran || []) { const x = (await pool.query("SELECT amount::float a, kind FROM credit_debit_note WHERE note_number = $1 AND active", [n])).rows[0]; if (x) { if (x.kind === "DEBIT") dn = money(dn + x.a); else cn = money(cn + x.a); } }
    const sub = money(c.total - dn + cn);
    const lista = [...ya, ...nuevos.map((s) => ({ invoice_number: s.invoice_number, d: String(s.issue_date).slice(0, 10), amt: Number(s.amount) }))];
    for (const [inv, monto] of Object.entries(c.parciales || {})) { const i = lista.find((x) => x.invoice_number === inv); if (i) i.amt = monto; else { const s = await stByInv(inv); lista.push({ invoice_number: inv, d: String(s.issue_date).slice(0, 10), amt: monto }); } }
    lista.sort((a, b) => a.d.localeCompare(b.d) || a.invoice_number.localeCompare(b.invoice_number));
    const sumaInv = money(lista.reduce((s, x) => s + Number(x.amt), 0));
    log(`  ${c.pn}: total $${fmt(L.total_amount)} -> $${fmt(c.total)}${c.fecha ? `, fecha ${String(L.payment_date).slice(0, 10)} -> ${c.fecha}` : ""}; subtotal $${fmt(L.subtotal)} -> $${fmt(sub)} (déb $${fmt(dn)}, créd $${fmt(cn)}); statements ${ya.length}+${nuevos.length}; facturas suman $${fmt(sumaInv)} ${eq(sumaInv, c.total) ? "OK" : "DIFERENCIA " + fmt(sumaInv - c.total)} — ${c.nota}`);
    if (!APPLY) continue;
    if (nuevos.length) await statementsStore.applyToPayout(nuevos.map((s) => s.id), L.id, {});
    for (const n of c.notasSalen || []) { /* la nota se mueve en el lote que la recibe */ }
    for (const [n, desde] of c.notasEntran || []) {
      await pool.query("UPDATE credit_debit_note SET payout_id = $2, updated_at = now(), note = COALESCE(note,'') || $3 WHERE note_number = $1 AND active", [n, L.id, ` | Movida de ${desde} a ${c.pn}: la tarjeta cobró su parte aquí (${ACTOR}).`]);
      // El lote de origen ya descontó la nota en su propio paso (notasSalen); aquí no se toca.
      // La primera corrida la restó dos veces y Dist-0057 quedó con débito -53.63 (corregido a mano).
    }
    const invoices = lista.map((x) => ({ number: x.invoice_number, date: x.d, amount: money(x.amt) }));
    const trans = c.cargos.map(([d, m], i) => ({ ...tx(d, m), id: i + 1 }));
    await pool.query(
      `UPDATE payouts SET total_amount = $2::numeric, net_amount = $2::numeric, subtotal = $3, base_amount = $3, debit_notes_total = $4, credit_notes_total = $5, tax_amount = 0,
              invoices = $6::jsonb, invoice_total = $7, transactions = $8::jsonb, payment_method = $9, payment_date = COALESCE($10, payment_date),
              notes = COALESCE(notes,'') || $11,
              audit_log = COALESCE(audit_log,'[]'::jsonb) || jsonb_build_array(jsonb_build_object('timestamp', now(), 'user', $12::text, 'action', 'Total set to card charge ' || ($2::numeric)::text || ' (was ' || $13::text || ')')),
              updated_at = now(), updated_by = $12 WHERE id = $1`,
      [L.id, c.total, sub, dn, cn, JSON.stringify(invoices), sumaInv, JSON.stringify(trans), CARD, c.fecha || null,
        ` | ${ACTOR}: la tarjeta cobró $${fmt(c.total)}${eq(c.total, L.total_amount) ? "" : ` (AppSheet decía $${fmt(L.total_amount)})`}. ${c.nota}.`, ACTOR, fmt(L.total_amount)]);
  }
}

async function paso3_dist0003() {
  titulo("3. Dist-0003: parte de Dealer pagada con Capital One, no con la 0533");
  const L = await lote("Dist-0003");
  log(`  ${String(L.payment_date).slice(0, 10)} $${fmt(L.total_amount)} método "${L.payment_method}" -> "Capital One"`);
  if (APPLY && !/capital one/i.test(L.payment_method || "")) await pool.query(
    "UPDATE payouts SET payment_method = 'Capital One', notes = COALESCE(notes,'') || $2, updated_at = now(), updated_by = $3 WHERE id = $1",
    [L.id, ` | ${ACTOR}: pagado con Capital One (Antonio, 6-sep-2026); no es un cargo de la 0533.`, ACTOR]);
}

async function paso4_revisar0163() {
  titulo("4. Dist-0163: para revisar con Antonio (no se toca)");
  const L = await lote("Dist-0163");
  const ob = (await pool.query("SELECT work_order_no, party, amount::float a, part_number FROM payable WHERE payout_id = $1 ORDER BY work_order_no", [L.id])).rows;
  const notas = (await pool.query("SELECT note_number, amount::float a, part_number, issue_date::text d, charge_payout_id FROM credit_debit_note WHERE payout_id = $1 AND active", [L.id])).rows;
  log(`  Hoy: total $${fmt(L.total_amount)} = subtotal $${fmt(L.subtotal)} + déb $${fmt(L.debit_notes_total)}. La tarjeta cobró $430.19 el 12-nov-2025 (la I04758183 es $971.94; los otros $541.75 los pagó Dist-0167 el 17-nov).`);
  log(`  Órdenes: ${ob.map((o) => `${o.work_order_no} ${o.party} $${fmt(o.a)} ${o.part_number || ""}`).join("; ")} = $${fmt(ob.reduce((s, o) => s + o.a, 0))}`);
  log(`  Notas: ${notas.map((n) => `${n.note_number} $${fmt(n.a)} ${n.part_number} ${n.d}${n.charge_payout_id ? " (cargada a técnico)" : ""}`).join("; ")}`);
  log(`  Si el total pasa a $430.19 con las dos notas dentro, el subtotal queda en $${fmt(430.19 - Number(L.debit_notes_total))}; las órdenes suman $${fmt(ob.reduce((s, o) => s + o.a, 0))}.`);
}

async function verificacion() {
  titulo("Verificación");
  const r = await pool.query(`
    SELECT o.payment_number, o.payment_date::text d, o.total_amount::float tot, o.subtotal::float sub, o.debit_notes_total::float dn, o.credit_notes_total::float cn, o.invoice_total::float inv, o.active,
           (SELECT COALESCE(sum(amount),0)::float FROM distributor_statement s WHERE s.payout_id=o.id AND s.active) st
      FROM payouts o WHERE o.payment_number = ANY($1) ORDER BY o.payment_date`, [[...CORRECCIONES.map((c) => c.pn), "Dist-0203", "Dist-0255", "Dist-0256", "Dist-0003"]]);
  for (const x of r.rows) log(`  ${x.payment_number} ${x.d} ${x.active === false ? "RETIRADO" : `total $${fmt(x.tot)} | fórmula ${eq(x.sub + x.dn - x.cn, x.tot) ? "OK" : "REVISAR"} | facturas $${fmt(x.inv)} ${eq(x.inv, x.tot) ? "OK" : "≠"} | statements $${fmt(x.st)}`}`);
}

(async () => {
  log(`Tarjeta 0533 — ${APPLY ? "APLICANDO" : "SOLO REPORTE"} — ${new Date().toISOString()}`);
  if (APPLY) await respaldar();
  await paso1_fusion0203();
  await paso2_correcciones();
  await paso3_dist0003();
  await paso4_revisar0163();
  await verificacion();
  const out = path.join(__dirname, "..", "backups", `tarjeta-0533-informe-${APPLY ? "apply" : "reporte"}-${new Date().toISOString().slice(0, 10)}.txt`);
  fs.writeFileSync(out, informe.join("\n"));
  console.log(`\nInforme guardado en ${out}`);
  await pool.end();
})().catch(async (e) => { console.error("\nERROR:", e.stack || e.message); try { await pool.end(); } catch {} process.exit(1); });
