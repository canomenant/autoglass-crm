const express = require("express");
const pool = require("../config/db");

const router = express.Router();

// Búsqueda global del header. Antes el buscador del frontend descargaba las TRES tablas completas
// (cotizaciones, órdenes y clientes, ~4.600 filas cada una con sus line items) en cada búsqueda
// tecleada — varios MB por pulsación. Aquí son tres consultas cortas con LIMIT que devuelven sólo
// lo que el desplegable enseña: número, nombre y el id para el enlace.
//
// Cada rol busca únicamente sobre lo que su lista ya le muestra, con el mismo criterio de
// propiedad que las rutas de lista: el agente sus cotizaciones y las órdenes nacidas de ellas,
// el técnico sus órdenes asignadas.
router.get("/", async (req, res) => {
  const q = String(req.query.q || "").trim();
  if (!q) return res.json({ quotes: [], workOrders: [], customers: [] });

  const like = `%${q}%`;
  const role = req.user.role;
  const entityId = req.user.entityId;

  const quotesPromise =
    role === "TECHNICIAN"
      ? Promise.resolve({ rows: [] })
      : pool.query(
          `SELECT id, quote_no, customer_name FROM quotes
           WHERE active <> false AND (quote_no ILIKE $1 OR customer_name ILIKE $1)
             ${role === "AGENT" ? "AND agent_id = $2" : ""}
           ORDER BY created_at DESC LIMIT 5`,
          role === "AGENT" ? [like, entityId] : [like]
        );

  const woScope =
    role === "AGENT"
      ? "AND quote_id IN (SELECT id FROM quotes WHERE agent_id = $2)"
      : role === "TECHNICIAN"
        ? "AND technician_id = $2"
        : "";
  const workOrdersPromise = pool.query(
    `SELECT id, work_order_no, customer_name FROM work_orders
     WHERE active <> false AND (work_order_no ILIKE $1 OR customer_name ILIKE $1)
       ${woScope}
     ORDER BY created_at DESC LIMIT 5`,
    woScope ? [like, entityId] : [like]
  );

  const customersPromise = pool.query(
    `SELECT id, first_name, last_name, phone FROM customers
     WHERE active <> false
       AND (first_name || ' ' || last_name ILIKE $1 OR phone LIKE $1)
     ORDER BY created_at DESC LIMIT 5`,
    [like]
  );

  const [quotes, workOrders, customers] = await Promise.all([quotesPromise, workOrdersPromise, customersPromise]);

  res.json({
    quotes: quotes.rows.map((r) => ({ id: r.id, quoteNo: r.quote_no, customerName: r.customer_name })),
    workOrders: workOrders.rows.map((r) => ({ id: r.id, workOrderNo: r.work_order_no, customerName: r.customer_name })),
    customers: customers.rows.map((r) => ({ id: r.id, name: `${r.first_name} ${r.last_name}`.trim(), phone: r.phone })),
  });
});

module.exports = router;
