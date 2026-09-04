require("dotenv").config();
const pool = require("../src/config/db");

// Cuatro facturas de Fresno 2025 donde el PDF trae un monto distinto al del resumen anual de
// Mygrant. Los lotes que las pagaron cuadraban al centavo con el resumen, así que lo que salió
// del banco fue la cifra del libro de cuenta de Mygrant: manda esa. El detalle del PDF se queda
// tal cual (los renglones suman la cifra del PDF), y la diferencia se anota en la cabecera.
//
//   node scripts/fix-montos-resumen-vs-pdf-2025.js            -> reporta
//   node scripts/fix-montos-resumen-vs-pdf-2025.js --apply    -> escribe

const APPLY = process.argv.includes("--apply");
const CASOS = [
  ["I04739686-0", 2531.18, "Dist-0151"],
  ["I04744140-0", 1738.40, "Dist-0157"],
  ["I04843462-0", 4107.09, "Dist-0211"],
  ["I04856676-0", 1085.18, "Dist-0223"],
];
(async () => {
  for (const [inv, resumen, lote] of CASOS) {
    const s = (await pool.query("SELECT id, amount, paid_amount, notes FROM distributor_statement WHERE active AND invoice_number = $1", [inv])).rows[0];
    if (!s) { console.log(`${inv}: no existe`); continue; }
    const pdf = Number(s.amount);
    const lineas = Number((await pool.query("SELECT COALESCE(sum(amount),0) s FROM distributor_statement_line WHERE statement_id = $1", [s.id])).rows[0].s);
    console.log(`${inv}: PDF $${pdf.toFixed(2)} (renglones $${lineas.toFixed(2)}) -> resumen $${resumen.toFixed(2)} [${lote}], diferencia $${(resumen - pdf).toFixed(2)}`);
    if (!APPLY || Math.abs(pdf - resumen) < 0.005) continue;
    await pool.query(
      `UPDATE distributor_statement SET amount = $2, paid_amount = $2, updated_at = now(),
              notes = COALESCE(notes,'') || $3 WHERE id = $1`,
      [s.id, resumen, ` | El PDF dice $${pdf.toFixed(2)} y sus renglones suman eso; el resumen anual de Mygrant y el pago (${lote}) dicen $${resumen.toFixed(2)}. Manda lo pagado (4-sep-2026).`]);
  }
  const chk = await pool.query(
    `SELECT o.payment_number, o.total_amount::float pagado, COALESCE(sum(s.amount),0)::float statements
       FROM payouts o JOIN distributor_statement s ON s.payout_id = o.id AND s.active
      WHERE o.payment_number = ANY($1) GROUP BY o.id ORDER BY 1`, [CASOS.map((c) => c[2])]);
  for (const x of chk.rows) console.log(`  ${x.payment_number}: pagado $${x.pagado.toFixed(2)} vs statements $${x.statements.toFixed(2)} ${Math.abs(x.pagado - x.statements) < 0.005 ? "CUADRA" : "REVISAR"}`);
  if (!APPLY) console.log("\nSimulación. --apply para escribir.");
  await pool.end();
})().catch((e) => { console.error(e.message); process.exit(1); });
