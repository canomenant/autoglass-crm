require("dotenv").config();
const fs = require("fs");
const path = require("path");
const pool = require("../src/config/db");

// Rellena payouts.payment_method de TECNICOS y AGENTES con lo que AppSheet ya sabía — el mismo
// agujero que backfill-distributor-payment-method.js tapó para distribuidores: los CSVs traen
// PAYMENTMETHOD_LABEL (Zelle, PayPal, Cash App...) y el import no lo copió. Medido 2026-08-27:
// los 286 TECHNICIAN y los 251 AGENT estaban con el método vacío.
//
// Match:
//   - TECHNICIAN por payment_number ("Consecutive Payment Tech" = Tech-XXXX): 286/286, medido.
//   - AGENT: el CSV no trae número. Pero la numeración Ag-XXXX se fabricó en el import siguiendo
//     el ORDEN DEL ARCHIVO (ver renumber-agent-payouts.js y la nota del proyecto), y se verificó
//     fila a fila: las 251 casan el total AL CENTAVO contra el payout en esa misma posición. El
//     script vuelve a exigir esa coincidencia de total por fila: si algún día el orden se rompe,
//     la fila que no case el total se salta y se avisa, en vez de escribir el método de otro pago.
//
// Solo escribe donde payment_method está vacío: re-ejecutar es inocuo y no pisa nada puesto a mano.
//
// --apply para escribir; sin el flag solo simula.

const APPLY = process.argv.includes("--apply");
const DIR = path.join(__dirname, "..", "imports", "appsheet", "csv");

function parseCSV(s) {
  const rows = [];
  let row = [], cur = "", q = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      if (c === '"') { if (s[i + 1] === '"') { cur += '"'; i++; } else q = false; }
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === ",") { row.push(cur); cur = ""; }
    else if (c === "\n" || c === "\r") {
      if (cur !== "" || row.length) { row.push(cur); rows.push(row); row = []; cur = ""; }
    } else cur += c;
  }
  if (cur !== "" || row.length) { row.push(cur); rows.push(row); }
  return rows;
}

function leer(archivo) {
  const rows = parseCSV(fs.readFileSync(path.join(DIR, archivo), "utf8"));
  const head = rows[0];
  const idx = (n) => head.indexOf(n);
  return { rows: rows.slice(1), idx };
}

(async () => {
  const pendientes = [];
  let yaConMetodo = 0, sinMetodoCsv = 0, sinMatch = 0;

  // --- TECHNICIAN por consecutivo ---
  const t = leer("BD_PAYMENTTECH.csv");
  const dbT = (await pool.query(
    "SELECT id, payment_number, payment_method FROM payouts WHERE type = 'TECHNICIAN' AND active <> false"
  )).rows;
  const porNumero = new Map(dbT.filter((p) => p.payment_number).map((p) => [p.payment_number, p]));
  for (const r of t.rows) {
    const consec = (r[t.idx("Consecutive Payment Tech")] || "").trim();
    const metodo = (r[t.idx("PAYMENTMETHOD_LABEL")] || "").trim();
    if (!metodo) { sinMetodoCsv++; continue; }
    const p = porNumero.get(consec);
    if (!p) { sinMatch++; continue; }
    if (p.payment_method) { yaConMetodo++; continue; }
    pendientes.push({ id: p.id, numero: p.payment_number, metodo });
  }

  // --- AGENT por orden de archivo, con el total como testigo por fila ---
  const a = leer("BD_PAYMENTAGENT.csv");
  const dbA = (await pool.query(
    "SELECT id, payment_number, payment_method, total_amount FROM payouts WHERE type = 'AGENT' AND active <> false ORDER BY payment_number"
  )).rows;
  const n = Math.min(a.rows.length, dbA.length);
  for (let i = 0; i < n; i++) {
    const metodo = (a.rows[i][a.idx("PAYMENTMETHOD_LABEL")] || "").trim();
    const total = Number(a.rows[i][a.idx("TOTAL")] || 0);
    const p = dbA[i];
    if (!metodo) { sinMetodoCsv++; continue; }
    if (Math.round(total * 100) !== Math.round(Number(p.total_amount) * 100)) { sinMatch++; continue; }
    if (p.payment_method) { yaConMetodo++; continue; }
    pendientes.push({ id: p.id, numero: p.payment_number, metodo });
  }

  const porMetodo = new Map();
  pendientes.forEach((x) => porMetodo.set(x.metodo, (porMetodo.get(x.metodo) || 0) + 1));

  console.log(`A escribir: ${pendientes.length} | ya con método: ${yaConMetodo} | CSV sin método: ${sinMetodoCsv} | sin match (saltados): ${sinMatch}`);
  console.log("\nMétodos:");
  [...porMetodo.entries()].sort((x, y) => y[1] - x[1]).forEach(([m, c]) => console.log(`  ${c}  ${m}`));

  if (!APPLY) {
    console.log("\nSimulación. Volver a lanzar con --apply para escribir.");
    await pool.end();
    return;
  }

  for (const x of pendientes) {
    await pool.query("UPDATE payouts SET payment_method = $2, updated_at = now() WHERE id = $1", [x.id, x.metodo]);
  }
  console.log(`\nEscritos ${pendientes.length} lotes.`);
  await pool.end();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
