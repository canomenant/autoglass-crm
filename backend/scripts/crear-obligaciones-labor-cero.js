require("dotenv").config();
const pool = require("../src/config/db");
const { syncObligationsForWorkOrder } = require("../src/lib/payableSync");
const workordersStore = require("../src/store/workorders.store");
const quotesStore = require("../src/store/quotes.store");

// Saca a la luz las órdenes con técnico asignado y labor en $0.00.
//
// Hasta hoy la obligación de labor solo nacía con monto: sin monto no había deuda, así que esas
// órdenes no aparecían en ningún pago y la única forma de llegar a ellas era abrirlas una por una.
// Ya se igualó la regla a la de los agentes —un $0 es "por capturar", no "no se debe"— pero eso
// solo actúa cuando la orden se guarda. Esto lo aplica a las que ya están.
//
// No inventa montos: crea la obligación en $0.00 para que aparezca en el panel de vincular, donde
// se le teclea el labor y queda escrito también en la orden.
//
// Sin --apply solo enseña a quién le saldrían y cuántas.

const APPLY = process.argv.includes("--apply");

(async () => {
  const r = await pool.query(
    `SELECT w.id, w.work_order_no, w.tech, w.customer_name, w.appointment_date::date AS f
       FROM work_orders w
      WHERE w.active <> false AND COALESCE(btrim(w.tech), '') <> ''
        AND COALESCE(w.labor_cost, 0) = 0
        AND NOT EXISTS (SELECT 1 FROM payable p WHERE p.work_order_no = w.work_order_no AND p.kind = 'TECH')
      ORDER BY w.tech, w.appointment_date DESC NULLS LAST`
  );
  const porTecnico = {};
  for (const x of r.rows) porTecnico[x.tech] = (porTecnico[x.tech] || 0) + 1;
  console.log(`órdenes sin obligación de labor: ${r.rowCount}`);
  console.table(Object.entries(porTecnico).sort((a, b) => b[1] - a[1]).map(([tecnico, ordenes]) => ({ tecnico, ordenes })));

  if (!APPLY) { console.log("\nSIMULACIÓN. --apply para escribir."); await pool.end(); return; }

  let creadas = 0;
  const fallos = [];
  for (const x of r.rows) {
    try {
      // El sync recibe la orden ya mapeada, igual que al guardarla desde la app: así aplica las
      // mismas reglas (técnicos adicionales, nombre del agente, distribuidor resuelto).
      const wo = await workordersStore.get(x.id);
      if (!wo) { fallos.push({ orden: x.work_order_no, error: "no se pudo leer la orden" }); continue; }
      const quote = wo.quoteId ? await quotesStore.get(wo.quoteId) : null;
      const res = await syncObligationsForWorkOrder(wo, { agentName: quote?.agentName || "" });
      if ((res.changes || []).some((c) => c.kind === "TECH" && c.action === "crear")) creadas++;
      else fallos.push({ orden: x.work_order_no, cambios: JSON.stringify(res.changes || []) });
    } catch (e) {
      fallos.push({ orden: x.work_order_no, error: e.message });
    }
  }
  console.log(`\nobligaciones de labor creadas: ${creadas}`);
  if (fallos.length) { console.log(`sin crear: ${fallos.length}`); console.table(fallos.slice(0, 10)); }
  await pool.end();
})().catch((e) => { console.error(e); process.exit(1); });
