// Recupera bonus y descuento en los lotes de distribuidor y agente importados de AppSheet.
//
//   cd backend && node scripts/backfill-payout-adjustments.js          # dry-run, no escribe nada
//   cd backend && node scripts/backfill-payout-adjustments.js --apply
//
// El import (scripts/import-appsheet-payouts.js) pasa `extra` sin bonus ni discount en las ramas
// DIST y AGENT, asi que `extra.bonus || 0` y `extra.discount || 0` escribieron cero en los 505
// lotes. El total_amount quedo correcto porque vino de la columna TOTAL del export; lo que se
// perdio es la composicion: subtotal + bonus - descuento no reconstruye el total, y queda un
// hueco de $16,927.56 en distribuidor y $11,270.99 en agente sin explicacion en la UI.
//
// Esto NO mueve un solo total. Solo rellena los dos componentes que faltan, y solo cuando la
// identidad contable cierra exacto contra el total ya guardado. Un lote que no cierre no se toca
// y se reporta, porque escribir un componente que no reconstruye el total es peor que dejarlo en
// cero: convierte un hueco visible en un numero que miente.
//
// La rama TECHNICIAN si importo sus cinco componentes y aqui solo se verifica.
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const pool = require("../src/config/db");

const APPLY = process.argv.includes("--apply");
const DIR = path.join(__dirname, "..", "imports", "appsheet", "csv");

// Mismos helpers que import-appsheet-payouts.js: el emparejamiento tiene que reproducir
// exactamente lo que hizo aquel script, sobre todo la numeracion generada de agente.
function parseCSV(t) {
  const R = [];
  let r = [], f = "", q = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (q) {
      if (c === '"') { if (t[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c;
    } else if (c === '"') q = true;
    else if (c === ",") { r.push(f); f = ""; }
    else if (c === "\n") { r.push(f); R.push(r); r = []; f = ""; }
    else if (c !== "\r") f += c;
  }
  if (f || r.length) { r.push(f); R.push(r); }
  const h = R.shift().map((x) => x.trim());
  return R.filter((x) => x.length > 1).map((x) => Object.fromEntries(h.map((k, i) => [k, (x[i] ?? "").trim()])));
}
const num = (v) => { const n = Number(String(v ?? "").replace(/[$,]/g, "")); return Number.isFinite(n) ? n : 0; };
const money = (n) => "$" + Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fecha = (v) => {
  const s = String(v ?? "").trim();
  if (!s) return null;
  if (/^\d+$/.test(s)) {
    const d = new Date(Date.UTC(1899, 11, 30) + Number(s) * 86400000);
    return isNaN(d) ? null : d.toISOString().slice(0, 10);
  }
  const d = new Date(s);
  return isNaN(d) ? null : d.toISOString().slice(0, 10);
};
const col = (row, re) => Object.keys(row).find((k) => re.test(k));
const load = (f) => parseCSV(fs.readFileSync(path.join(DIR, f), "utf8"));
const cerca = (a, b) => Math.abs(Number(a) - Number(b)) < 0.005;

(async () => {
  const pDist = load("BD_PAYMENTDISTRIBUTOR.csv");
  const pAg = load("BD_PAYMENTAGENT.csv");
  const pTech = load("BD_PAYMENTTECH.csv");

  // --- llaves del CSV, iguales a las que uso el import ---
  const cNumD = col(pDist[0], /CONSECUTIVE DISTRIBUTOR/i);
  const csvDist = new Map();
  for (const r of pDist) csvDist.set(r[cNumD] || null, r);

  // Agente no trae numeracion: el import genero Agent-0001.. ordenando por (DATE PAYMENT, ID).
  // Hay que repetir el mismo orden o el emparejamiento sale corrido.
  const cFechaA = col(pAg[0], /DATE.*PAYMENT/i) || "DATE PAYMENT";
  const csvAg = new Map();
  [...pAg]
    .sort((a, b) =>
      String(fecha(a[cFechaA]) ?? "").localeCompare(String(fecha(b[cFechaA]) ?? "")) ||
      String(a.ID).localeCompare(String(b.ID)))
    .forEach((r, i) => csvAg.set("Agent-" + String(i + 1).padStart(4, "0"), r));

  const cNumT = col(pTech[0], /Consecutive Payment Tech/i);
  const csvTech = new Map();
  for (const r of pTech) csvTech.set(r[cNumT], r);

  const filas = (await pool.query(
    `SELECT id, payment_number, type, payment_date, subtotal, bonus, deductions, total_amount, net_amount,
            cash_advance, parts_deduction, parts_return, gross_amount, commission_amount
       FROM payouts WHERE active <> false AND created_by = 'appsheet_import' ORDER BY type, id`
  )).rows;

  const plan = [];
  const agentes = [];
  const problemas = [];
  const resumen = {};

  for (const p of filas) {
    const R = (resumen[p.type] = resumen[p.type] ||
      { lotes: 0, sinCsv: 0, subtotalDistinto: 0, cuadra: 0, noCuadra: 0, yaTenia: 0, agenteEnCero: 0, bonus: 0, desc: 0 });
    R.lotes++;

    const r = p.type === "DISTRIBUTOR" ? csvDist.get(p.payment_number)
      : p.type === "AGENT" ? csvAg.get(p.payment_number)
      : csvTech.get(p.payment_number);
    if (!r) {
      R.sinCsv++;
      problemas.push({ lote: p.payment_number || "id " + p.id, tipo: p.type, que: "sin fila en el CSV" });
      continue;
    }

    // Prueba de que emparejamos la fila correcta: el subtotal guardado tiene que ser el del CSV.
    if (!cerca(p.subtotal, num(r.SUBTOTAL))) {
      R.subtotalDistinto++;
      problemas.push({
        lote: p.payment_number || "id " + p.id, tipo: p.type,
        que: "subtotal no coincide: base " + money(p.subtotal) + " vs csv " + money(num(r.SUBTOTAL)),
      });
      continue;
    }

    const bonus = num(r.BONUS), desc = num(r.DISCOUNT);

    if (p.type === "TECHNICIAN") {
      // Solo verificacion: esta rama si importo sus componentes.
      const esperado = num(r.SUBTOTAL) + bonus - desc - num(r.CASH) - num(r.PARTS) + num(r.PARTS_SUMA ?? r["PARTS SUMA"]);
      if (cerca(p.net_amount, esperado) && cerca(p.bonus, bonus) && cerca(p.deductions, desc)) R.cuadra++;
      else {
        R.noCuadra++;
        problemas.push({
          lote: p.payment_number, tipo: p.type,
          que: "neto " + money(p.net_amount) + " vs formula " + money(esperado),
        });
      }
      continue;
    }

    // AGENT: el import nunca escribio gross_amount ni commission_amount — insertarLote solo llena
    // net_amount, total_amount y subtotal. Y withComputed() lee commissionAmount para este tipo,
    // asi que los 251 lotes de agente se muestran en $0.00 en la app: $59,516.66 invisibles.
    // gross = subtotal del export, commission = total del export.
    if (p.type === "AGENT" && cerca(p.gross_amount, 0) && cerca(p.commission_amount, 0)) {
      R.agenteEnCero++;
      agentes.push({ id: p.id, numero: p.payment_number, gross: Number(p.subtotal), commission: Number(p.total_amount) });
    }

    if (!cerca(p.bonus, 0) || !cerca(p.deductions, 0)) { R.yaTenia++; continue; }

    // La condicion para escribir: los componentes tienen que reconstruir el total ya guardado.
    const reconstruido = Number(p.subtotal) + bonus - desc;
    if (!cerca(reconstruido, p.total_amount)) {
      R.noCuadra++;
      problemas.push({
        lote: p.payment_number || "id " + p.id, tipo: p.type,
        que: money(p.subtotal) + " + " + money(bonus) + " - " + money(desc) + " = " + money(reconstruido) +
             ", total guardado " + money(p.total_amount),
      });
      continue;
    }
    R.cuadra++; R.bonus += bonus; R.desc += desc;
    if (bonus || desc) plan.push({ id: p.id, numero: p.payment_number, tipo: p.type, bonus, desc });
  }

  console.log(APPLY ? "=== APLICANDO ===" : "=== DRY-RUN (no se escribe nada) ===");
  console.log("Lotes de appsheet_import revisados: " + filas.length + "\n");
  console.table(Object.fromEntries(Object.entries(resumen).map(([k, v]) => [k, {
    lotes: v.lotes, "sin csv": v.sinCsv, "subtotal!=": v.subtotalDistinto, cuadra: v.cuadra,
    "NO cuadra": v.noCuadra, "ya tenia": v.yaTenia, "agente en $0": v.agenteEnCero,
    "bonus a escribir": money(v.bonus), "desc a escribir": money(v.desc),
  }])));

  console.log("Lotes a actualizar: " + plan.length);
  console.log("  bonus total     " + money(plan.reduce((s, x) => s + x.bonus, 0)));
  console.log("  descuento total " + money(plan.reduce((s, x) => s + x.desc, 0)));
  console.log("Lotes de agente con gross/commission en cero: " + agentes.length +
    "  ->  commission " + money(agentes.reduce((s, x) => s + x.commission, 0)));

  if (problemas.length) {
    console.log("\n--- " + problemas.length + " lote(s) que NO se tocan ---");
    problemas.slice(0, 40).forEach((x) => console.log("  [" + x.tipo + "] " + x.lote + ": " + x.que));
    if (problemas.length > 40) console.log("  ... y " + (problemas.length - 40) + " mas");
  }

  if (!APPLY) {
    console.log("\nNada escrito. Corre con --apply para aplicar.");
    await pool.end();
    return;
  }

  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    const antes = (await c.query(
      "SELECT sum(total_amount) t, sum(subtotal) s FROM payouts WHERE active <> false AND type <> 'TECHNICIAN'")).rows[0];
    for (const x of plan) {
      await c.query("UPDATE payouts SET bonus = $2, deductions = $3, updated_at = now() WHERE id = $1", [x.id, x.bonus, x.desc]);
    }
    for (const x of agentes) {
      await c.query("UPDATE payouts SET gross_amount = $2, commission_amount = $3, updated_at = now() WHERE id = $1",
        [x.id, x.gross, x.commission]);
    }
    const desp = (await c.query(
      "SELECT sum(total_amount) t, sum(subtotal) s FROM payouts WHERE active <> false AND type <> 'TECHNICIAN'")).rows[0];
    // Ningun total puede haberse movido: solo tocamos bonus y deductions.
    if (!cerca(antes.t, desp.t) || !cerca(antes.s, desp.s)) {
      throw new Error("los totales se movieron: " + money(antes.t) + " -> " + money(desp.t));
    }
    await c.query("COMMIT");
    console.log("\nOK. " + plan.length + " lotes con bonus/descuento y " + agentes.length +
      " de agente con gross/commission. Totales intactos: " + money(desp.t));
  } catch (e) {
    await c.query("ROLLBACK");
    console.error("ROLLBACK:", e.message);
    process.exitCode = 1;
  } finally {
    c.release();
    await pool.end();
  }
})().catch((e) => { console.error(e); process.exit(1); });
