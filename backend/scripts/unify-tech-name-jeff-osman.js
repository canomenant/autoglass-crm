require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
// "Jeff Auto Glass" es la COMPAÑÍA de Osman Neri Armira, no otro técnico (Antonio, 9-sep-2026).
// Una orden y su obligación quedaron a nombre de la compañía, así que en la lista de por-pagar
// aparecía como si fueran dos personas — y una de ellas con saldo negativo, porque tenía el
// efectivo de un lado y la mano de obra del otro.
//
// La ficha de Osman YA trae companyName = "Jeff Auto Glass", y la orden ya apunta a su
// technician_id: lo único partido es el texto. No hay ficha de técnico llamada "Jeff Auto Glass"
// que dar de baja.
//
// Se toca work_orders.tech y payable.party. Ni extra_techs ni las notas ni payable.company tienen
// una sola huella del nombre (comprobado antes de correrlo).
const fs = require("fs");
const path = require("path");
const pool = require("../src/config/db");

const APPLY = process.argv.includes("--apply");
const COMPANIA = "Jeff Auto Glass";
const PERSONA = "Osman Neri Armira";
const ID_OSMAN = "a9bc1969-aaa9-4ca8-be74-9b9334c51c69";

(async () => {
  const wos = await pool.query(
    `SELECT work_order_no, id, technician_id, appointment_date::date AS fecha, labor_cost, status
       FROM work_orders WHERE active <> false AND btrim(tech) = $1 ORDER BY appointment_date`,
    [COMPANIA]
  );
  const obs = await pool.query(
    `SELECT p.id, p.work_order_no, p.kind, p.amount, p.status, p.payout_id
       FROM payable p WHERE btrim(p.party) = $1 ORDER BY p.work_order_no`,
    [COMPANIA]
  );
  console.log(APPLY ? "APLICANDO" : "SOLO PRUEBA (usa --apply para escribir)");
  console.log("Órdenes:", wos.rowCount, "| Obligaciones:", obs.rowCount);
  console.table(wos.rows.map((x) => ({ orden: x.work_order_no, fecha: String(x.fecha).slice(0, 10), estado: x.status, labor: x.labor_cost, apuntaAOsman: String(x.technician_id || "") === ID_OSMAN })));
  console.table(obs.rows.map((x) => ({ obligacion: x.id, orden: x.work_order_no, tipo: x.kind, monto: x.amount, estado: x.status, lote: x.payout_id })));

  // La ficha es la prueba de que es la misma persona. Sin ella no se renombra: unir por parecido
  // de nombre es como nacen estos enredos.
  const ajenas = wos.rows.filter((x) => String(x.technician_id || "") !== ID_OSMAN);
  if (ajenas.length) {
    console.error("ABORTADO:", ajenas.length, "órdenes NO apuntan a la ficha de Osman:", ajenas.map((x) => x.work_order_no).join(", "));
    await pool.end();
    process.exit(1);
  }
  if (!APPLY || (!wos.rowCount && !obs.rowCount)) { await pool.end(); return; }

  const respaldo = path.join(__dirname, `tech-name-jeff-osman-backup-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  fs.writeFileSync(respaldo, JSON.stringify({ workOrders: wos.rows, obligations: obs.rows }, null, 2));
  console.log("Respaldo:", respaldo);

  const w = await pool.query(`UPDATE work_orders SET tech = $2, updated_at = now() WHERE id = ANY($1::uuid[])`, [wos.rows.map((x) => x.id), PERSONA]);
  // La obligación se renombra igual: es a la persona a quien se le paga, y así su saldo queda en
  // un solo renglón. `company` se deja como está — ahí no había nada.
  const o = await pool.query(`UPDATE payable SET party = $2, updated_at = now() WHERE id = ANY($1::bigint[])`, [obs.rows.map((x) => Number(x.id)), PERSONA]);
  console.log("Órdenes renombradas:", w.rowCount, "| Obligaciones renombradas:", o.rowCount);

  const quedan = await pool.query(
    `SELECT (SELECT COUNT(*)::int FROM work_orders WHERE active <> false AND btrim(tech) = $1) AS ordenes,
            (SELECT COUNT(*)::int FROM payable WHERE btrim(party) = $1) AS obligaciones`,
    [COMPANIA]
  );
  console.log("Quedan con el nombre de la compañía:", quedan.rows[0]);
  await pool.end();
})().catch((e) => { console.error(e); process.exit(1); });
