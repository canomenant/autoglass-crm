require("dotenv").config();
const pool = require("../src/config/db");

// Unifica los técnicos partidos en dos personas por el nombre.
//
// El catálogo de técnicos quedó con nombres CORTOS ("Osman Armira", "Joel Alexander") mientras
// todo el histórico —work_orders, payable, payouts, notas— usa el nombre COMPLETO de AppSheet
// ("Osman Neri Armira", "Joel Alexander Lopez Castillo"). Las órdenes nuevas toman el nombre del
// catálogo, así que desde el 20-ago cada uno de estos técnicos existe dos veces: sus órdenes
// nuevas y sus obligaciones pendientes quedan bajo el nombre corto, y al armarle un pago con el
// nombre histórico "no salen todas las work orders" (reportado por Antonio con la pantalla de
// Payments, 28-ago-2026).
//
// La unificación va hacia el nombre COMPLETO: es el que llevan ~1,100 obligaciones ya pagadas,
// 286 lotes de pago y el import entero — renombrar eso sí sería reescribir historia. Se renombra
// el lado chico: el catálogo (4 filas) y lo nuevo (43 órdenes, 18 obligaciones pendientes,
// 4 notas). Ningún monto cambia.
//
// --apply para escribir; sin el flag solo simula.

const APPLY = process.argv.includes("--apply");

const MAPA = [
  ["Osman Armira", "Osman Neri Armira"],
  ["Joel Alexander", "Joel Alexander Lopez Castillo"],
  ["Nelson Edison", "Nelson Edison Villatoro"],
  ["Cirilo Jr", "Cirilo Jr Flores"],
];

(async () => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const [corto, full] of MAPA) {
      const cat = await client.query(
        "SELECT id FROM technicians WHERE btrim(name) = $1 AND active <> false", [corto]);
      const wos = await client.query(
        "SELECT count(*)::int n FROM work_orders WHERE active <> false AND btrim(tech) = $1", [corto]);
      const pay = await client.query(
        `SELECT count(*)::int n FROM payable
          WHERE kind = 'TECH' AND btrim(party) = $1 AND status = 'pendiente' AND payout_id IS NULL`, [corto]);
      const notas = await client.query(
        "SELECT count(*)::int n FROM credit_debit_note WHERE btrim(COALESCE(technician, '')) = $1", [corto]);
      console.log(`${corto} -> ${full}: catálogo ${cat.rows.length}, órdenes ${wos.rows[0].n}, obligaciones pendientes ${pay.rows[0].n}, notas ${notas.rows[0].n}`);
      if (!APPLY) continue;
      // technicians no tiene updated_at
      await client.query("UPDATE technicians SET name = $2 WHERE btrim(name) = $1 AND active <> false", [corto, full]);
      await client.query("UPDATE work_orders SET tech = $2, updated_at = now() WHERE active <> false AND btrim(tech) = $1", [corto, full]);
      await client.query(
        `UPDATE payable SET party = $2, updated_at = now()
          WHERE kind = 'TECH' AND btrim(party) = $1 AND status = 'pendiente' AND payout_id IS NULL`, [corto, full]);
      await client.query("UPDATE credit_debit_note SET technician = $2, updated_at = now() WHERE btrim(COALESCE(technician, '')) = $1", [corto, full]);
    }
    if (!APPLY) {
      await client.query("ROLLBACK");
      console.log("\nSimulación. Volver a lanzar con --apply para escribir.");
    } else {
      await client.query("COMMIT");
      // Verificación: no debe quedar ningún nombre corto en ninguna de las cuatro tablas.
      for (const [corto] of MAPA) {
        const r = await client.query(
          `SELECT (SELECT count(*) FROM technicians WHERE btrim(name) = $1 AND active <> false)
                + (SELECT count(*) FROM work_orders WHERE active <> false AND btrim(tech) = $1)
                + (SELECT count(*) FROM payable WHERE kind = 'TECH' AND btrim(party) = $1)
                + (SELECT count(*) FROM credit_debit_note WHERE btrim(COALESCE(technician, '')) = $1) AS n`, [corto]);
        if (Number(r.rows[0].n)) console.log(`OJO: quedan ${r.rows[0].n} filas con "${corto}" (pagadas/históricas que no se tocan a propósito).`);
      }
      console.log("\nListo. Reversa: mismos UPDATE con los nombres invertidos.");
    }
  } catch (e) {
    try { await client.query("ROLLBACK"); } catch {}
    throw e;
  } finally {
    client.release();
  }
  await pool.end();
})().catch((e) => {
  console.error("FALLA:", e.message);
  process.exit(1);
});
