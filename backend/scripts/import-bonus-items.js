// PASO 19: importa los renglones de bono de AppSheet y los clasifica.
//
//   cd backend && node scripts/import-bonus-items.js          # dry-run, ROLLBACK
//   cd backend && node scripts/import-bonus-items.js --apply
//
// BONUS_DISCOUNT_AGENT.csv (502 renglones) y BONUS_DISCOUNT_TECH.csv (15) son la tabla hija que
// faltaba. Traen el numero de pago de AppSheet en PAYMENTAGENT_LABEL, asi que ademas verifican la
// renumeracion que se hizo por posicion de archivo.
//
// El NOTE es la categoria, pero escrita a mano durante dos anos: 75 variantes para muchas menos
// ideas. "RUN CC", "CHARGE CARD", "GET CC", "GOT CC", "GATHERED CC", "CC COLLECTED", "PROCESS CC",
// "CREDIT CRAD COLLECTED"... todas son lo mismo — conseguir o procesar la tarjeta del cliente — y
// separadas no responden nada. Se normalizan a un tipo, y el texto original se conserva intacto en
// note: el tipo agrupa, la nota no pierde nada.
//
// Lo que no cae en un patron claro queda en OTHER con su texto. Es preferible a forzar una
// categoria: un bono descrito como "MON-AUG 11 WRONG PART TRIP TO TECH JOB CANCELLED IVAN JI" no
// pertenece a ningun cajon, y meterlo en uno haria mentir al sumario.
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const pool = require("../src/config/db");

const APPLY = process.argv.includes("--apply");
const DIR = path.join(__dirname, "..", "imports", "appsheet", "csv");

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
  if (/^\d+(\.\d+)?$/.test(s)) { const d = new Date(Date.UTC(1899, 11, 30) + Number(s) * 86400000); return isNaN(d) ? null : d.toISOString().slice(0, 10); }
  const d = new Date(s);
  return isNaN(d) ? null : d.toISOString().slice(0, 10);
};

// El orden importa: la primera que casa gana. CC va antes que CALLING_SERVICE porque
// "CALLING SERVICE GET CC" es una llamada para conseguir la tarjeta, y lo que se premia es la
// tarjeta.
const REGLAS = [
  [/\bC(C|RAD|ARD)\b|CREDIT ?CARD|CHARGE CARD|CHANGE CARD|GET PAYEMNT|ZELLE/, "CC_HANDLING"],
  [/REVIEW/, "REVIEWS"],
  [/ITEMIZ|INOVICE|INVOICE/, "ITEMIZED_INVOICE"],
  [/ADMIN FEE/, "ADMIN_FEE"],
  [/SPIFF/, "SPIFF"],
  [/INSURANCE/, "INSURANCE_PROCESSED"],
  [/CALLING SERVICE|CALLING/, "CALLING_SERVICE"],
  [/SALARY/, "SALARY"],
  [/WARRANT/, "WARRANTY"],
  [/TRIP/, "TRIP_CANCELLED"],
  [/2024|LAST YEAR|LAST WEEK|WEEKS AGO|UNPAID WEEK|PENDING TO (PAY|APPLY)|BALANCE FROM|NEXT WEEK|PAYMENT ADVANCE|OVER ?PAY/, "PRIOR_BALANCE"],
];

function clasificar(note) {
  const s = String(note || "").toUpperCase().replace(/\s+/g, " ").trim();
  if (!s) return null;
  for (const [re, tipo] of REGLAS) if (re.test(s)) return tipo;
  return "OTHER";
}

(async () => {
  const ag = parseCSV(fs.readFileSync(path.join(DIR, "BONUS_DISCOUNT_AGENT.csv"), "utf8"));
  const te = parseCSV(fs.readFileSync(path.join(DIR, "BONUS_DISCOUNT_TECH.csv"), "utf8"));
  const filas = [...ag.map((x) => ({ ...x, lote: x.PAYMENTAGENT_LABEL })), ...te.map((x) => ({ ...x, lote: x.PAYMENTTECH_LABEL }))];

  const c = await pool.connect();
  try {
    await c.query("BEGIN");

    const lotes = new Map((await c.query(
      "SELECT id, payment_number, type, bonus, deductions FROM payouts WHERE active <> false AND payment_number IS NOT NULL"))
      .rows.map((x) => [x.payment_number, x]));

    let insertados = 0, sinLote = 0, descuentos = 0, sinTipo = 0;
    const noCasan = [];
    const cobertura = {};
    const tocados = new Set();

    for (const f of filas) {
      const lote = lotes.get(f.lote);
      if (!lote) { sinLote++; noCasan.push(f.lote); continue; }
      // Sin TYPE_LABEL no se puede saber si suma o resta, y la columna del pago no lo respalda:
      // el unico caso, Agent-0131, tiene un renglon de $10.00 contra un BONUS de $0.00. Se salta
      // en vez de suponer, que es lo que dejaria el bono del lote sin cuadrar con sus renglones.
      if (!String(f.TYPE_LABEL || "").trim()) { sinTipo++; continue; }
      // Los descuentos van a otra columna del lote; aca solo se guardan los bonos, o el bono del
      // lote dejaria de ser la suma de sus renglones.
      const esDescuento = /discount/i.test(f.TYPE_LABEL || "");
      if (esDescuento) { descuentos++; continue; }
      tocados.add(lote.id);

      const tipo = clasificar(f.NOTE);
      cobertura[tipo || "(sin nota)"] = (cobertura[tipo || "(sin nota)"] || 0) + num(f.AMOUNT);
      const r = await c.query(
        `INSERT INTO payout_bonus_item (payout_id, bonus_type, amount, note, item_date, source, external_id)
         VALUES ($1,$2,$3,$4,$5::date,'appsheet',$6) ON CONFLICT (external_id) DO NOTHING RETURNING 1`,
        [lote.id, tipo, num(f.AMOUNT), f.NOTE || null, fecha(f.DATE), "bonus:" + f.ID]);
      if (r.rowCount) insertados++;
    }

    // Los renglones de AJUSTE se crearon cuando el lote no tenia ningun otro, asi que se llevaron
    // el bono entero. Ahora que llegan los reales, el ajuste vale solo su parte: lo que el bono del
    // lote tiene de mas sobre la suma de los importados. Si no le queda nada, se borra.
    let ajustados = 0, ajustesBorrados = 0;
    for (const payoutId of tocados) {
      const a = (await c.query(
        "SELECT id, amount FROM payout_bonus_item WHERE payout_id = $1 AND bonus_type = 'ADJUSTMENT'", [payoutId])).rows[0];
      if (!a) continue;
      const reales = Number((await c.query(
        "SELECT COALESCE(SUM(amount),0)::numeric s FROM payout_bonus_item WHERE payout_id = $1 AND bonus_type <> 'ADJUSTMENT'",
        [payoutId])).rows[0].s);
      const lote = (await c.query("SELECT bonus FROM payouts WHERE id = $1", [payoutId])).rows[0];
      const resto = Math.round((Number(lote.bonus) - reales) * 100) / 100;
      if (Math.abs(resto) < 0.005) { await c.query("DELETE FROM payout_bonus_item WHERE id = $1", [a.id]); ajustesBorrados++; }
      else if (Math.abs(resto - Number(a.amount)) > 0.005) {
        await c.query("UPDATE payout_bonus_item SET amount = $2, updated_at = now() WHERE id = $1", [a.id, resto]);
        ajustados++;
      }
    }

    console.log(APPLY ? "=== APLICANDO ===" : "=== DRY-RUN (termina en ROLLBACK) ===");
    console.log(`renglones en los CSV: ${filas.length}`);
    console.log(`  insertados como bono: ${insertados}`);
    console.log(`  descuentos (van en otra columna): ${descuentos}`);
    console.log(`  sin TYPE_LABEL, se saltan: ${sinTipo}`);
    console.log(`  sin lote que coincida: ${sinLote}${sinLote ? " -> " + [...new Set(noCasan)].slice(0, 8).join(", ") : ""}`);
    console.log(`  renglones de ajuste recalculados: ${ajustados}, borrados por quedar en cero: ${ajustesBorrados}`);

    console.log("\n--- que clase de bonos se estan dando ---");
    console.table(Object.entries(cobertura).sort((a, b) => b[1] - a[1])
      .map(([k, v]) => ({ tipo: k, monto: money(v) })));

    // El bono del lote tiene que ser la suma de sus renglones. Los lotes SIN renglones conservan
    // el suyo; los que ahora tienen, se recalculan.
    const conRenglones = (await c.query(
      `SELECT o.id, o.payment_number, o.bonus, i.s, i.n
         FROM payouts o JOIN (SELECT payout_id, SUM(amount) s, count(*)::int n FROM payout_bonus_item GROUP BY 1) i ON i.payout_id = o.id
        WHERE o.active <> false`)).rows;
    const difieren = conRenglones.filter((x) => Math.abs(Number(x.bonus) - Number(x.s)) > 0.005);

    console.log(`\nlotes con renglones: ${conRenglones.length}`);
    console.log(`  donde el bono del lote NO es su suma: ${difieren.length}`);
    if (difieren.length) {
      console.table(difieren.slice(0, 12).map((x) => ({
        lote: x.payment_number, "bono del lote": money(x.bonus), "suman los renglones": money(x.s),
        renglones: x.n, dif: money(Number(x.bonus) - Number(x.s)),
      })));
    }

    if (APPLY) { await c.query("COMMIT"); console.log("\nCOMMIT"); }
    else { await c.query("ROLLBACK"); console.log("\nROLLBACK: nada quedo escrito. Corre con --apply."); }
  } catch (e) {
    await c.query("ROLLBACK");
    console.error("ROLLBACK:", e.message);
    process.exitCode = 1;
  } finally {
    c.release();
    await pool.end();
  }
})().catch((e) => { console.error(e); process.exit(1); });
