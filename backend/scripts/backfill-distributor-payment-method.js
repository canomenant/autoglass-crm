require("dotenv").config();
const fs = require("fs");
const path = require("path");
const pool = require("../src/config/db");

// Rellena payouts.payment_method de los pagos a distribuidores con lo que AppSheet ya sabía.
//
// BD_PAYMENTDISTRIBUTOR.csv trae PAYMENTMETHOD_LABEL ("Business Credit Card ...ending with 0533",
// "Chase", "Capital One --4360") en cada fila, y el import de payouts no lo copió: los 254 lotes
// DISTRIBUTOR quedaron con payment_method vacío. Sin el método no se puede conciliar contra el
// extracto de la tarjeta, que es justo para lo que se pidió esta columna.
//
// Match por payment_number (CONSECUTIVE DISTRIBUTOR = Dist-XXXX): 253 casan uno a uno, medido.
// Queda un caso en cada lado sin número (una fila del CSV sin consecutivo y un payout con
// payment_number NULL) que además coinciden en total ($71.53): se casan entre sí, pero solo si
// siguen siendo únicos — si algún día hay dos sin número, se salta y se avisa en vez de adivinar.
//
// Solo escribe donde payment_method está vacío: re-ejecutar es inocuo y no pisa nada puesto a mano.
//
// --apply para escribir; sin el flag solo simula.

const APPLY = process.argv.includes("--apply");
const CSV = path.join(__dirname, "..", "imports", "appsheet", "csv", "BD_PAYMENTDISTRIBUTOR.csv");

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

(async () => {
  const rows = parseCSV(fs.readFileSync(CSV, "utf8"));
  const head = rows[0];
  const idx = (n) => head.indexOf(n);
  const data = rows.slice(1).map((r) => ({
    consec: (r[idx("CONSECUTIVE DISTRIBUTOR")] || "").trim(),
    total: Number(r[idx("TOTAL")] || 0),
    metodo: (r[idx("PAYMENTMETHOD_LABEL")] || "").trim(),
  }));

  const db = (await pool.query(
    "SELECT id, payment_number, total_amount, payment_method FROM payouts WHERE type = 'DISTRIBUTOR' AND active <> false"
  )).rows;

  const porNumero = new Map(db.filter((p) => p.payment_number).map((p) => [p.payment_number, p]));
  const sinNumeroDb = db.filter((p) => !p.payment_number);
  const sinNumeroCsv = data.filter((d) => !d.consec);

  const pendientes = [];
  let sinMetodoCsv = 0, yaConMetodo = 0, sinMatch = 0;

  for (const d of data) {
    if (!d.metodo) { sinMetodoCsv++; continue; }
    let p = d.consec ? porNumero.get(d.consec) : null;
    if (!p && !d.consec && sinNumeroDb.length === 1 && sinNumeroCsv.length === 1
        && Math.round(Number(sinNumeroDb[0].total_amount) * 100) === Math.round(d.total * 100)) {
      p = sinNumeroDb[0];
    }
    if (!p) { sinMatch++; continue; }
    if (p.payment_method) { yaConMetodo++; continue; }
    pendientes.push({ id: p.id, numero: p.payment_number || "(sin número)", metodo: d.metodo });
  }

  const porMetodo = new Map();
  pendientes.forEach((x) => porMetodo.set(x.metodo, (porMetodo.get(x.metodo) || 0) + 1));

  console.log(`CSV: ${data.length} filas | payouts DISTRIBUTOR: ${db.length}`);
  console.log(`A escribir: ${pendientes.length} | ya con método (no se tocan): ${yaConMetodo} | CSV sin método: ${sinMetodoCsv} | sin match: ${sinMatch}`);
  console.log("\nMétodos:");
  [...porMetodo.entries()].sort((a, b) => b[1] - a[1]).forEach(([m, n]) => console.log(`  ${n}  ${m}`));

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
