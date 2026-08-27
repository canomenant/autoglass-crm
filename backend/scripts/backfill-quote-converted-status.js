require("dotenv").config();
const pool = require("../src/config/db");

// Pone en "Converted" las cotizaciones que YA tienen orden de trabajo pero se quedaron con su
// estado anterior.
//
// De donde viene: markConverted vivia solo en la ruta POST /quotes/:id/convert, asi que los
// imports -que crean la orden llamando directamente a createFromQuote- nunca tocaban la
// cotizacion. Resultado medido: 567 cotizaciones del import de agosto (Wo-3866 a Wo-4580) con su
// orden creada, algunas ya pagadas, y la lista diciendo "Draft"; mas 2 en "Approved" con la orden
// pagada. El agujero se cerro moviendo el marcado dentro de createFromQuote; esto arregla las que
// ya estaban mal.
//
// Lo que NO toca, a proposito:
//   - Las cancelidas. Son 146 y su orden de trabajo tambien esta Cancelled: son coherentes, no
//     stale. Marcarlas "Converted" borraria informacion real.
//   - Las que no tienen orden de trabajo: esas si son borradores de verdad.
//
// --apply para escribir; sin ese flag solo simula.

const ESTADOS_A_CONVERTIR = ["Draft", "Approved", "Waiting Customer", "Ready For Review"];

async function main() {
  const apply = process.argv.includes("--apply");

  const { rows } = await pool.query(
    `SELECT q.id, q.quote_no, q.status, w.work_order_no, w.status AS wo_status
       FROM quotes q
       JOIN work_orders w ON w.quote_id = q.id AND w.active <> false
      WHERE q.active <> false
        AND q.status = ANY($1)
      ORDER BY q.quote_no`,
    [ESTADOS_A_CONVERTIR]
  );

  const porEstado = {};
  for (const r of rows) porEstado[r.status] = (porEstado[r.status] || 0) + 1;

  console.log(apply ? "=== APLICADO ===" : "=== SIMULACION (usa --apply para escribir) ===");
  console.log("cotizaciones a convertir:", rows.length);
  console.table(Object.entries(porEstado).map(([estado, n]) => ({ estado_actual: estado, cotizaciones: n })));
  console.log("ejemplos:");
  console.table(rows.slice(0, 5).map((r) => ({ quote: r.quote_no, de: r.status, orden: r.work_order_no, estado_orden: r.wo_status })));

  if (apply && rows.length) {
    const r = await pool.query(
      `UPDATE quotes SET status = 'Converted', updated_at = now() WHERE id = ANY($1) RETURNING id`,
      [rows.map((x) => x.id)]
    );
    console.log("\nactualizadas:", r.rowCount);
  }

  await pool.end();
}

main().catch((e) => {
  console.error("backfill-quote-converted-status failed:", e.message);
  process.exit(1);
});
