require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
// Una misma cuenta escrita de varias formas en los lotes de pago: la tarjeta 0533 aparece como
// "Business Credit Card ...ending with 0533" (319 lotes, grafía del import) y como "Business Card
// ****0533" (4, la del catálogo). Capital One igual: "--4360", "Capital One" a secas, y el
// catálogo dice "Capital One ****4360". Para filtrar "todo lo que salió de la 0533" en un clic
// hace falta UN nombre por cuenta, y manda el del catálogo de métodos de pago, que es lo que
// llena el desplegable (Antonio, 10-sep-2026).
//
// Solo se reescribe payouts.payment_method. Las órdenes (payment->>'method') son el cobro AL
// CLIENTE y no se tocan. Sin --apply solo enseña lo que cambiaría.
const fs = require("fs");
const path = require("path");
const pool = require("../src/config/db");

const APPLY = process.argv.includes("--apply");
const MAPA = {
  "Business Credit Card ...ending with 0533": "Business Card ****0533",
  "Capital One --4360": "Capital One ****4360",
  "Capital One": "Capital One ****4360",
};

(async () => {
  const r = await pool.query(
    `SELECT btrim(payment_method) AS viejo, COUNT(*)::int AS lotes, ROUND(SUM(net_amount)::numeric, 2) AS total
       FROM payouts WHERE active IS NOT FALSE AND btrim(COALESCE(payment_method, '')) = ANY($1::text[])
      GROUP BY 1 ORDER BY 2 DESC`,
    [Object.keys(MAPA)]
  );
  console.log(APPLY ? "APLICANDO" : "SOLO PRUEBA (usa --apply para escribir)");
  console.table(r.rows.map((x) => ({ como_esta: x.viejo, quedaria: MAPA[x.viejo], lotes: x.lotes, total: x.total })));
  if (!APPLY || !r.rowCount) { await pool.end(); return; }

  const antes = await pool.query(
    `SELECT id, payment_number, payment_method FROM payouts WHERE active IS NOT FALSE AND btrim(COALESCE(payment_method,'')) = ANY($1::text[])`,
    [Object.keys(MAPA)]
  );
  const respaldo = path.join(__dirname, `payout-account-names-backup-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  fs.writeFileSync(respaldo, JSON.stringify(antes.rows, null, 2));
  console.log("Respaldo:", respaldo);

  let total = 0;
  for (const [viejo, nuevo] of Object.entries(MAPA)) {
    const w = await pool.query(
      `UPDATE payouts SET payment_method = $2, updated_at = now() WHERE active IS NOT FALSE AND btrim(COALESCE(payment_method,'')) = $1`,
      [viejo, nuevo]
    );
    total += w.rowCount;
  }
  console.log("Lotes renombrados:", total);
  await pool.end();
})().catch((e) => { console.error(e); process.exit(1); });
