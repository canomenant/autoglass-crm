require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
// 22 órdenes de marzo a mayo de 2026 llevan "Luis" en el campo de texto del técnico, y las 54 de
// mayo en adelante "Luis Almanza". Es la MISMA persona: las 22 apuntan al technician_id de Luis
// Almanza (97e18e8a-501d-4a90-8ae4-1f633e3871cf) y sus obligaciones ya salieron a ese nombre. El
// dinero nunca estuvo mal adjudicado; lo único partido era el texto, que hacía que su nombre
// apareciera dos veces en las listas (Antonio, 9-sep-2026).
//
// OJO: "Luis Dallas" es OTRA persona -2 órdenes de 2025 en Fort Worth y Plano, sin ficha de
// técnico y ya pagadas- y este script no la toca. El mismo enredo de nombres que ya se corrigió
// con Osman y Joel; ver la memoria de sync con AppSheet.
//
// Sólo se reescribe work_orders.tech: payable.party y extra_techs no tienen una sola huella del
// nombre corto (comprobado antes de correrlo).
const fs = require("fs");
const path = require("path");
const pool = require("../src/config/db");

const APPLY = process.argv.includes("--apply");
const CORTO = "Luis";
const COMPLETO = "Luis Almanza";
const ID_ALMANZA = "97e18e8a-501d-4a90-8ae4-1f633e3871cf";

(async () => {
  const r = await pool.query(
    `SELECT work_order_no, id, tech, technician_id, appointment_date::date AS fecha, status
       FROM work_orders
      WHERE active <> false AND btrim(tech) = $1
      ORDER BY appointment_date`,
    [CORTO]
  );
  const ajenas = r.rows.filter((x) => String(x.technician_id || "") !== ID_ALMANZA);
  console.log(APPLY ? "APLICANDO" : "SOLO PRUEBA (usa --apply para escribir)", "| órdenes con el nombre corto:", r.rowCount);
  console.table(r.rows.map((x) => ({ orden: x.work_order_no, fecha: String(x.fecha).slice(0, 10), estado: x.status, apuntaAAlmanza: String(x.technician_id || "") === ID_ALMANZA })));
  // La ficha es la prueba de que son la misma persona. Si alguna no apunta ahí, no se toca nada:
  // renombrar por parecido de texto es justo como nacen estos enredos.
  if (ajenas.length) {
    console.error("ABORTADO:", ajenas.length, "órdenes NO apuntan a la ficha de Luis Almanza:", ajenas.map((x) => x.work_order_no).join(", "));
    await pool.end();
    process.exit(1);
  }
  if (!APPLY || !r.rowCount) { await pool.end(); return; }

  const respaldo = path.join(__dirname, `tech-name-luis-backup-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  fs.writeFileSync(respaldo, JSON.stringify(r.rows, null, 2));
  console.log("Respaldo:", respaldo);

  const w = await pool.query(
    `UPDATE work_orders SET tech = $2, updated_at = now() WHERE id = ANY($1::uuid[])`,
    [r.rows.map((x) => x.id), COMPLETO]
  );
  console.log("Órdenes renombradas:", w.rowCount);
  const quedan = await pool.query("SELECT COUNT(*)::int AS n FROM work_orders WHERE active <> false AND btrim(tech) = $1", [CORTO]);
  console.log("Quedan con el nombre corto:", quedan.rows[0].n);
  await pool.end();
})().catch((e) => { console.error(e); process.exit(1); });
