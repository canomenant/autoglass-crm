require("dotenv").config();
const pool = require("../src/config/db");
const { syncObligationsForWorkOrder, clearAgentCompanyCache } = require("../src/lib/payableSync");

// Rellena las obligaciones de pago que faltan de las órdenes ya existentes.
//
// La app nunca las creó (sólo vinieron del import de AppSheet, hasta Wo-3865), así que toda orden
// posterior con comisión/labor/vidrio quedó fuera de Cuentas por Pagar. Este script recorre esas
// órdenes y aplica la MISMA sincronización que ahora corre en vivo al editar una orden — de modo
// que el pasado queda igual que el futuro.
//
// Por defecto es DRY-RUN: no escribe nada, sólo dice qué haría. Para escribir de verdad:
//   node scripts/backfill-payable-obligations.js --apply
//
// Seguro por diseño (ver payableSync.js): nunca toca obligaciones del import ni pagadas, y no
// duplica las que ya existen.

const APPLY = process.argv.includes("--apply");

async function main() {
  clearAgentCompanyCache();

  // Órdenes activas que tienen algún monto que pagar y NO tienen ya una obligación de ese tipo.
  // Se traen con el nombre del agente desde el presupuesto, que es de donde sale la parte AGENT.
  // Sólo las órdenes que NO tienen NINGUNA obligación todavía y sí tienen algo que pagar. Ese es
  // exactamente el hueco: las órdenes posteriores al import de AppSheet que la app nunca registró.
  // Las históricas (que ya traen sus obligaciones del import) quedan intactas y ni se recorren.
  const r = await pool.query(`
    SELECT w.work_order_no, w.commission, w.labor_cost, w.glass_cost, w.tech, w.distributor,
           w.appointment_date, w.created_at, q.agent_name
      FROM work_orders w
      LEFT JOIN quotes q ON q.id = w.quote_id
     WHERE w.active <> false
       AND (COALESCE(w.commission,0) > 0 OR COALESCE(w.labor_cost,0) > 0 OR COALESCE(w.glass_cost,0) > 0)
       AND NOT EXISTS (SELECT 1 FROM payable p WHERE p.work_order_no = w.work_order_no)
     ORDER BY w.work_order_no
  `);

  console.log(`${APPLY ? "APLICANDO" : "DRY-RUN (no escribe)"} — ${r.rows.length} órdenes con montos a revisar\n`);

  const resumen = { AGENT: { n: 0, monto: 0 }, TECH: { n: 0, monto: 0 }, DISTRIBUTOR: { n: 0, monto: 0 } };
  let ordenesTocadas = 0;
  const ejemplos = [];

  for (const row of r.rows) {
    const workOrder = {
      workOrderNo: row.work_order_no,
      commission: row.commission,
      laborCost: row.labor_cost,
      glassCost: row.glass_cost,
      tech: row.tech,
      distributor: row.distributor,
      appointmentDate: row.appointment_date,
      createdAt: row.created_at,
    };
    const res = await syncObligationsForWorkOrder(workOrder, { agentName: row.agent_name || "", dryRun: !APPLY });
    if (res.changes.length) {
      ordenesTocadas++;
      for (const c of res.changes) {
        if (c.action === "crear") {
          resumen[c.kind].n++;
          resumen[c.kind].monto += c.amount;
          if (ejemplos.length < 12) ejemplos.push(`  ${res.workOrderNo}  ${c.kind.padEnd(11)} ${c.party || ""} — $${c.amount}`);
        }
      }
    }
  }

  console.log("Obligaciones a crear:");
  for (const k of ["AGENT", "TECH", "DISTRIBUTOR"]) {
    console.log(`  ${k.padEnd(12)} ${String(resumen[k].n).padStart(4)} obligaciones   $${resumen[k].monto.toFixed(2)}`);
  }
  const total = resumen.AGENT.monto + resumen.TECH.monto + resumen.DISTRIBUTOR.monto;
  console.log(`  ${"TOTAL".padEnd(12)} ${String(resumen.AGENT.n + resumen.TECH.n + resumen.DISTRIBUTOR.n).padStart(4)} obligaciones   $${total.toFixed(2)}`);
  console.log(`\nÓrdenes afectadas: ${ordenesTocadas}`);

  if (ejemplos.length) {
    console.log("\nEjemplos:");
    ejemplos.forEach((e) => console.log(e));
  }

  if (!APPLY) {
    console.log("\nEsto fue un DRY-RUN. Para escribir de verdad: node scripts/backfill-payable-obligations.js --apply");
  } else {
    console.log("\nHecho. Las obligaciones ya aparecen en Cuentas por Pagar.");
  }

  await pool.end();
}

main().catch((e) => {
  console.error("backfill falló:", e.message);
  process.exit(1);
});
