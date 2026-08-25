// PASO 13: los pagos de agente recuperan el numero que tienen en AppSheet.
//
//   cd backend && node scripts/renumber-agent-payouts.js          # dry-run, ROLLBACK
//   cd backend && node scripts/renumber-agent-payouts.js --apply
//
// BD_PAYMENTAGENT.csv no trae columna de consecutivo — tech trae "Consecutive Payment Tech" y
// distribuidor "CONSECUTIVE DISTRIBUTOR", agente no trae nada — asi que el import genero
// Agent-0001.. ordenando por (DATE PAYMENT, ID). AppSheet SI los numera: se ven como Agent0251,
// Agent0250... en la columna #, y no siguen la fecha. Agent0248 es del 8 de abril y Agent0247 del
// 22, asi que ordenar por fecha corre la numeracion entera.
//
// El efecto es peor que no tener numero: Agent-0234 en la web era Edgar Medina, $190.00 del 24 de
// marzo, mientras que Agent0234 en AppSheet es David Cruz, $456.48 del 3 de abril. La etiqueta
// parecia coincidir y no coincidia, que es la unica forma de equivocacion que nadie revisa.
//
// El numero real es la POSICION EN EL ARCHIVO: el export conserva el orden de creacion. Verificado
// contra once numeros leidos de la pantalla de AppSheet — los once casan en agente y fecha.
//
// Esto solo renombra. Ningun monto se mueve, y las relaciones no dependen del numero: las
// obligaciones y las notas cuelgan de payout_id.
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
  if (/^\d+$/.test(s)) { const d = new Date(Date.UTC(1899, 11, 30) + Number(s) * 86400000); return isNaN(d) ? null : d.toISOString().slice(0, 10); }
  const d = new Date(s);
  return isNaN(d) ? null : d.toISOString().slice(0, 10);
};
const etiqueta = (i) => "Agent-" + String(i).padStart(4, "0");

(async () => {
  const pAg = parseCSV(fs.readFileSync(path.join(DIR, "BD_PAYMENTAGENT.csv"), "utf8"));

  // Como quedo: el import ordeno por (DATE PAYMENT, ID) y numero en ese orden.
  const comoQuedo = new Map();
  [...pAg]
    .sort((a, b) =>
      String(fecha(a["DATE PAYMENT"]) ?? "").localeCompare(String(fecha(b["DATE PAYMENT"]) ?? "")) ||
      String(a.ID).localeCompare(String(b.ID)))
    .forEach((r, i) => comoQuedo.set(r.ID, etiqueta(i + 1)));

  // Como debe quedar: la posicion en el archivo.
  const comoDebe = new Map(pAg.map((r, i) => [r.ID, etiqueta(i + 1)]));

  const c = await pool.connect();
  try {
    await c.query("BEGIN");

    const filas = (await c.query(
      "SELECT id, payment_number, payment_date, subtotal, commission_amount FROM payouts WHERE type = 'AGENT' AND active <> false")).rows;
    const porNumero = new Map(filas.map((x) => [x.payment_number, x]));

    const plan = [];
    const problemas = [];
    for (const r of pAg) {
      const actual = comoQuedo.get(r.ID);
      const correcto = comoDebe.get(r.ID);
      const lote = porNumero.get(actual);
      if (!lote) { problemas.push(`${actual}: no existe ese lote en la base`); continue; }
      // Se comprueba que el lote que vamos a renombrar sea REALMENTE la fila del CSV, comparando
      // subtotal y fecha. Renombrar a ciegas repetiria el error, solo que corrido de otra forma.
      if (Math.abs(Number(lote.subtotal) - num(r.SUBTOTAL)) > 0.005) {
        problemas.push(`${actual}: subtotal ${money(lote.subtotal)} vs csv ${money(num(r.SUBTOTAL))}`);
        continue;
      }
      if (String(lote.payment_date || "").slice(0, 10) !== String(fecha(r["DATE PAYMENT"]) || "")) {
        problemas.push(`${actual}: fecha ${lote.payment_date} vs csv ${fecha(r["DATE PAYMENT"])}`);
        continue;
      }
      if (actual !== correcto) plan.push({ id: lote.id, de: actual, a: correcto, agente: r.AGENT_LABEL, total: num(r.TOTAL) });
    }

    console.log(APPLY ? "=== APLICANDO ===" : "=== DRY-RUN (termina en ROLLBACK) ===");
    console.log(`lotes de agente: ${filas.length}`);
    console.log(`a renumerar    : ${plan.length}`);
    console.log(`ya correctos   : ${filas.length - plan.length - problemas.length}`);
    if (problemas.length) {
      console.log(`\nNO se tocan (${problemas.length}):\n  ${problemas.slice(0, 20).join("\n  ")}`);
      throw new Error("hay lotes que no casan con su fila del CSV; no se renumera nada");
    }

    // Dos pasadas con un prefijo temporal: renombrar en su sitio choca cuando A quiere el numero
    // de B y B todavia no lo solto.
    for (const x of plan) await c.query("UPDATE payouts SET payment_number = $2 WHERE id = $1", [x.id, "TMP-" + x.id]);
    for (const x of plan) await c.query("UPDATE payouts SET payment_number = $2, updated_at = now() WHERE id = $1", [x.id, x.a]);

    console.log("\n--- el caso que lo destapo ---");
    console.table((await c.query(
      `SELECT payment_number, payment_date, subtotal, bonus, commission_amount
         FROM payouts WHERE payment_number IN ('Agent-0234','Agent-0241') ORDER BY payment_number`)).rows);

    const t = (await c.query(
      "SELECT count(*)::int n, count(DISTINCT payment_number)::int distintos, round(SUM(commission_amount),2) total FROM payouts WHERE type='AGENT' AND active <> false")).rows[0];
    console.log(`\n${t.n} lotes, ${t.distintos} numeros distintos, total ${money(t.total)}`);
    if (t.n !== t.distintos) throw new Error("quedaron numeros repetidos");

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
