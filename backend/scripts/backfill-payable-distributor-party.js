require("dotenv").config();
const pool = require("../src/config/db");

// Completa el nombre del distribuidor en las obligaciones que llegaron sin él.
//
// 513 obligaciones DISTRIBUTOR vinieron de AppSheet con party vacío (16 dentro de pagos ya
// cerrados). El efecto visible: el pago muestra "—" en la columna de distribuidor, y ponerle el
// distribuidor a la orden no lo arreglaba, porque el sync no toca obligaciones pagadas ni del
// import (reportado con Wo-0017 / Dist-0014). Esa regla ya tiene la excepción de "rellenar vacío
// sí" en payableSync; esto completa de una vez las que ya son resolubles con los datos de hoy.
//
// El nombre sale de la MISMA resolución que usa el sync (resolveDistributor): el campo distributor
// de la orden y, si está vacío, los distribuidores de las líneas de su cotización. Solo escribe
// donde party está vacío y hay algo que poner: re-ejecutar es inocuo, y sirve para volver a pasar
// después de rellenar más distribuidores a mano.
//
// --apply para escribir; sin el flag solo simula.

const APPLY = process.argv.includes("--apply");

(async () => {
  const r = await pool.query(`
    SELECT pb.id, pb.work_order_no, pb.amount, pb.payout_id,
           w.distributor AS wo_dist,
           (SELECT string_agg(DISTINCT btrim(li->>'distributor'), ', ')
              FROM quotes q, jsonb_array_elements(q.line_items) li
             WHERE q.id = w.quote_id AND btrim(COALESCE(li->>'distributor','')) <> '') AS quote_dist
      FROM payable pb JOIN work_orders w ON w.work_order_no = pb.work_order_no
     WHERE pb.kind = 'DISTRIBUTOR' AND btrim(COALESCE(pb.party,'')) = ''
     ORDER BY pb.work_order_no`);

  // Los campos vienen con basura de comas del historico: ", Mygrant Hayward", "," a secas, y
  // duplicados ("Mygrant Sacramento , Mygrant Sacramento"). Se parte por coma, se limpia, se
  // deduplica y se rearma — una coma sola queda en nada y esa orden sigue sin resolver.
  const limpiar = (s) => [...new Set(String(s || "").split(",").map((x) => x.trim()).filter(Boolean))].join(", ");
  const pendientes = r.rows
    .map((x) => ({ ...x, party: limpiar(x.wo_dist) || limpiar(x.quote_dist) }))
    .filter((x) => x.party);

  const enPagos = pendientes.filter((x) => x.payout_id != null).length;
  console.log(`Obligaciones DISTRIBUTOR con party vacío: ${r.rowCount}`);
  console.log(`Resolubles con los datos de hoy: ${pendientes.length} (${enPagos} dentro de pagos cerrados)`);
  console.log(`Sin distribuidor en ningún lado (quedan en "—" hasta que alguien lo ponga): ${r.rowCount - pendientes.length}`);
  console.log("\nMuestras:");
  pendientes.slice(0, 10).forEach((x) => console.log(`  ${x.work_order_no} $${x.amount} -> "${x.party}"${x.payout_id != null ? " (en pago)" : ""}`));

  if (!APPLY) {
    console.log("\nSimulación. Volver a lanzar con --apply para escribir.");
    await pool.end();
    return;
  }

  for (const x of pendientes) {
    await pool.query("UPDATE payable SET party = $2, updated_at = now() WHERE id = $1", [x.id, x.party]);
  }
  console.log(`\nEscritas ${pendientes.length} obligaciones.`);
  await pool.end();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
