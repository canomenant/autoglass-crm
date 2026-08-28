require("dotenv").config();
const fs = require("fs");
const path = require("path");
const pool = require("../src/config/db");

// Coteja cada lote DISTRIBUTOR contra la fila del CSV de AppSheet que lo origino: el TOTAL del CSV
// es lo que de verdad se pago. Reporta cualquier lote donde el total calculado por la formula viva
// (subtotal + bonus − deductions + tax + debitos − creditos) no de ese numero.
//
// --repair ademas restaura los que no cuadren, poniendo debitos/creditos como los trae el CSV
// (BONUS/DISCOUNT) y el total en el TOTAL pagado. Con una guardia: NUNCA toca un lote que tenga
// notas activas enlazadas — esas son la recaptura manual y ahi mandan las notas, no el CSV. Asi
// paso el primer roto (Dist-0001: enlazar y desenlazar una nota de prueba reconstruyo sus totales
// desde cero notas y borro el debito de $153.16 que venia del CSV sin nota que lo respalde).
//
// Sin --repair solo lee.

function parseCSV(s) {
  const rows = [];
  let row = [], cur = "", q = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) { if (c === '"') { if (s[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
    else if (c === '"') q = true;
    else if (c === ",") { row.push(cur); cur = ""; }
    else if (c === "\n" || c === "\r") { if (cur !== "" || row.length) { row.push(cur); rows.push(row); row = []; cur = ""; } }
    else cur += c;
  }
  if (cur !== "" || row.length) { row.push(cur); rows.push(row); }
  return rows;
}

const cents = (n) => Math.round(Number(n || 0) * 100);
const REPAIR = process.argv.includes("--repair");

(async () => {
  const csvRows = parseCSV(fs.readFileSync(path.join(__dirname, "..", "imports", "appsheet", "csv", "BD_PAYMENTDISTRIBUTOR.csv"), "utf8"));
  const head = csvRows[0];
  const idx = (n) => head.indexOf(n);
  const csv = new Map();
  let sinConsec = null;
  for (const r of csvRows.slice(1)) {
    const fila = {
      subtotal: Number(r[idx("SUBTOTAL")] || 0),
      bonus: Number(r[idx("BONUS")] || 0),
      discount: Number(r[idx("DISCOUNT")] || 0),
      total: Number(r[idx("TOTAL")] || 0),
    };
    const consec = (r[idx("CONSECUTIVE DISTRIBUTOR")] || "").trim();
    if (consec) csv.set(consec, fila);
    else sinConsec = fila;
  }
  // La fila sin consecutivo es hoy Dist-0254 (assign-missing-payout-number.js).
  if (sinConsec && !csv.has("Dist-0254")) csv.set("Dist-0254", sinConsec);

  const db = (await pool.query(
    `SELECT payment_number, subtotal, bonus, deductions, tax_amount, credit_notes_total,
            debit_notes_total, total_amount
       FROM payouts WHERE type = 'DISTRIBUTOR' AND active <> false ORDER BY payment_number`
  )).rows;

  let ok = 0;
  const malos = [];
  let bonusODeduc = 0;
  for (const p of db) {
    const ref = csv.get(p.payment_number);
    if (!ref) { malos.push({ num: p.payment_number, motivo: "sin fila en el CSV" }); continue; }
    const computado = cents(p.subtotal) + cents(p.bonus) - cents(p.deductions) + cents(p.tax_amount)
      + cents(p.debit_notes_total) - cents(p.credit_notes_total);
    if (Number(p.bonus) !== 0 || Number(p.deductions) !== 0) bonusODeduc++;
    if (computado === cents(ref.total)) { ok++; continue; }
    malos.push({
      num: p.payment_number,
      pagadoReal: ref.total.toFixed(2),
      calculado: (computado / 100).toFixed(2),
      almacenado: Number(p.total_amount).toFixed(2),
      detalle: `sub=${p.subtotal} bon=${p.bonus} ded=${p.deductions} tax=${p.tax_amount} deb=${p.debit_notes_total} cred=${p.credit_notes_total} | CSV: bon=${ref.bonus} disc=${ref.discount}`,
    });
  }

  console.log(`Lotes DISTRIBUTOR: ${db.length} | cuadran con lo pagado: ${ok} | NO cuadran: ${malos.length}`);
  console.log(`Con bonus o deductions distintos de 0 (riesgo de doble conteo latente): ${bonusODeduc}`);
  if (malos.length) {
    console.log("\nLos que no cuadran:");
    malos.forEach((m) => console.log(`  ${m.num}: pagado=${m.pagadoReal ?? "?"} calculado=${m.calculado ?? "-"} almacenado=${m.almacenado ?? "-"}\n     ${m.motivo || m.detalle}`));
  }

  if (REPAIR && malos.length) {
    let reparados = 0, saltados = 0;
    for (const m of malos) {
      const ref = csv.get(m.num);
      if (!ref) { saltados++; continue; }
      // La guardia: un lote con notas activas enlazadas esta en recaptura manual y no se toca.
      const notas = (await pool.query(
        `SELECT count(*)::int AS n FROM credit_debit_note
          WHERE active <> false AND (payout_id = (SELECT id FROM payouts WHERE payment_number = $1)
             OR charge_payout_id = (SELECT id FROM payouts WHERE payment_number = $1))`,
        [m.num]
      )).rows[0].n;
      if (notas > 0) {
        console.log(`  ${m.num}: tiene ${notas} nota(s) activa(s) — se salta, mandan las notas.`);
        saltados++;
        continue;
      }
      await pool.query(
        `UPDATE payouts SET debit_notes_total = $2, credit_notes_total = $3, bonus = 0, deductions = 0,
            total_amount = $4, updated_at = now()
          WHERE payment_number = $1 AND type = 'DISTRIBUTOR'`,
        [m.num, ref.bonus, ref.discount, ref.total]
      );
      console.log(`  ${m.num}: restaurado -> deb=${ref.bonus} cred=${ref.discount} total=${ref.total}`);
      reparados++;
    }
    console.log(`\nReparados: ${reparados} | saltados: ${saltados}. Volver a correr sin --repair para verificar.`);
  } else if (malos.length) {
    console.log("\nVolver a lanzar con --repair para restaurarlos desde el CSV.");
  }
  await pool.end();
  process.exit(malos.length && !REPAIR ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
