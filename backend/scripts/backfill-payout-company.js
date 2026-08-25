// PASO 14: el pago de agente recupera a que COMPANIA se le pago.
//
//   cd backend && node scripts/backfill-payout-company.js          # dry-run, ROLLBACK
//   cd backend && node scripts/backfill-payout-company.js --apply
//
// BD_PAYMENTAGENT.csv trae ID_COMPANY y COMPANY_LABEL, y el import los ignoro. No es un adorno: la
// comision no se le paga al agente, se le paga a la compania para la que trabaja, y una compania
// puede tener varios agentes. Agent-0234 es a Digiclique Digital Marketing Services e incluye
// comisiones de David Cruz, Ashley Diaz, Kayla Lopez y Alex Reyes.
//
// Por eso la columna "Pagado a" listaba cuatro nombres: sale de las obligaciones, que si saben de
// que agente es cada work order, pero ninguno de los cuatro es quien recibio el dinero.
//
// Seis companias en total. Cuatro llevan el nombre de un solo agente — Jose Reyes, Richard
// Salgado, Edgar Medina, Alex Reyes — y ahi compania y agente coinciden. Digiclique es la que hace
// visible la diferencia, con 62 pagos.
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
const nulo = (v) => { const s = String(v ?? "").trim(); return s === "" ? null : s; };
const etiqueta = (i) => "Agent-" + String(i).padStart(4, "0");

(async () => {
  const pAg = parseCSV(fs.readFileSync(path.join(DIR, "BD_PAYMENTAGENT.csv"), "utf8"));

  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    await c.query("ALTER TABLE payouts ADD COLUMN IF NOT EXISTS company TEXT");
    // El agente titular del pago. Se conserva aparte de la compania porque no es lo mismo: es el
    // contacto con el que se trato, no necesariamente el dueno de todas las comisiones incluidas.
    await c.query("ALTER TABLE payouts ADD COLUMN IF NOT EXISTS primary_agent TEXT");

    // Despues de renumerar, la posicion en el archivo ES el numero del lote.
    let escritos = 0;
    const problemas = [];
    for (let i = 0; i < pAg.length; i++) {
      const r = pAg[i];
      const numero = etiqueta(i + 1);
      const res = await c.query(
        `UPDATE payouts SET company = $2, primary_agent = $3, updated_at = now()
          WHERE payment_number = $1 AND type = 'AGENT' AND active <> false
            AND abs(subtotal - $4) < 0.005 RETURNING id`,
        [numero, nulo(r.COMPANY_LABEL), nulo(r.AGENT_LABEL), num(r.SUBTOTAL)]);
      if (res.rowCount) escritos++;
      else problemas.push(`${numero}: no caso por numero + subtotal`);
    }

    console.log(APPLY ? "=== APLICANDO ===" : "=== DRY-RUN (termina en ROLLBACK) ===");
    console.log(`lotes de agente con compania: ${escritos} de ${pAg.length}`);
    if (problemas.length) {
      console.log(`\nNO casaron (${problemas.length}):\n  ${problemas.slice(0, 15).join("\n  ")}`);
      throw new Error("hay lotes que no casan; no se escribe nada");
    }

    console.log("");
    console.table((await c.query(
      `SELECT company, primary_agent, count(*)::int pagos, round(SUM(commission_amount),2) total
         FROM payouts WHERE type = 'AGENT' AND active <> false
        GROUP BY 1, 2 ORDER BY 3 DESC`)).rows);

    console.log("--- Agent-0234 ---");
    console.table((await c.query(
      "SELECT payment_number, company, primary_agent, payment_date, subtotal, bonus, commission_amount FROM payouts WHERE payment_number = 'Agent-0234'")).rows);

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
