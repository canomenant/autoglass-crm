// Verifies the automatic work-order status transitions.
//
//   cd backend && node scripts/verify-workorder-status-automation.js
//
// Runs inside a transaction that is always rolled back, and stubs the data-file write, so it
// changes nothing.
//
// Only two transitions are automatic, and both have an unambiguous trigger: assigning a technician
// advances to Assigned, settling the balance advances to Paid. In Progress and Completed are
// deliberately left manual — the obvious trigger would be the technician's photos, and not one of
// the 4,580 orders has any, so wiring them up would tie a status to something nobody uses.
//
// The three rules this pins down:
//   1. automatic transitions only ever move forward — assigning a tech to a Paid order must not
//      drag it back to Assigned
//   2. a partial payment is not Paid; only a zero balance is
//   3. an explicit status from a person always wins, in either direction
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const pool = require("../src/config/db");
const { initPostgres } = require("../src/lib/initPostgres");

const realWriteFileSync = fs.writeFileSync;
let failures = 0;

function check(label, ok, detail) {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}`);
  if (!ok) {
    failures++;
    if (detail !== undefined) console.log("        " + JSON.stringify(detail).slice(0, 200));
  }
}

(async () => {
  await initPostgres();
  const client = await pool.connect();
  const realQuery = pool.query.bind(pool);
  pool.query = (...args) => client.query(...args);
  fs.writeFileSync = (file, ...rest) =>
    String(file).includes(path.sep + "data" + path.sep) ? undefined : realWriteFileSync(file, ...rest);

  try {
    await client.query("BEGIN");
    const store = require("../src/store/workorders.store");

    console.log("--- advanceStatus: solo avanza ---");
    check("Scheduled -> Assigned avanza", store.advanceStatus("Scheduled", "Assigned") === "Assigned");
    check("Scheduled -> Paid avanza (se puede saltear)", store.advanceStatus("Scheduled", "Paid") === "Paid");
    check("Paid -> Assigned NO retrocede", store.advanceStatus("Paid", "Assigned") === "Paid");
    check("Closed -> Paid NO retrocede", store.advanceStatus("Closed", "Paid") === "Closed");
    check("Assigned -> Assigned se queda igual", store.advanceStatus("Assigned", "Assigned") === "Assigned");
    check("Cancelled queda intacto (fuera del flujo)", store.advanceStatus("Cancelled", "Assigned") === "Cancelled");
    check("un estado desconocido queda intacto", store.advanceStatus("Loquesea", "Paid") === "Loquesea");

    console.log("\n--- isFullyPaid: solo balance cero ---");
    check("pago total", store.isFullyPaid({ totalSale: 500, payment: { amount: 500 } }) === true);
    check("pago de mas (upsell/vuelto)", store.isFullyPaid({ totalSale: 500, payment: { amount: 520 } }) === true);
    check("pago parcial NO", store.isFullyPaid({ totalSale: 500, payment: { amount: 250 } }) === false);
    check("un centavo de menos NO", store.isFullyPaid({ totalSale: 500, payment: { amount: 499.99 } }) === false);
    check("sin pago NO", store.isFullyPaid({ totalSale: 500, payment: {} }) === false);
    check("total 0 NO cuenta como pagado", store.isFullyPaid({ totalSale: 0, payment: { amount: 0 } }) === false);

    // Necesita una orden real para ejercitar assignTech/update de punta a punta.
    const row = (await client.query(
      "SELECT id FROM work_orders WHERE active <> false AND status = 'Scheduled' LIMIT 1"
    )).rows[0];
    const techId = (await client.query("SELECT id FROM technicians WHERE active <> false LIMIT 1")).rows[0]?.id;

    console.log("\n--- asignar tecnico ---");
    let wo = await store.assignTech(row.id, techId, "Tecnico de Prueba");
    check("una orden Scheduled pasa a Assigned", wo.status === "Assigned", wo.status);

    await store.update(row.id, { status: "Paid" });
    wo = await store.assignTech(row.id, techId, "Otro Tecnico");
    check("reasignar en una orden Paid NO la retrocede", wo.status === "Paid", wo.status);

    await store.update(row.id, { status: "Cancelled" });
    wo = await store.assignTech(row.id, techId, "Otro mas");
    check("asignar en una Cancelled la deja Cancelled", wo.status === "Cancelled", wo.status);

    console.log("\n--- registrar pago ---");
    await store.update(row.id, { status: "Scheduled", totalSale: 500, payment: { amount: 0, paid: false } });
    wo = await store.update(row.id, { payment: { amount: 250 } });
    check("un pago parcial no cambia el estado", wo.status === "Scheduled", wo.status);
    wo = await store.update(row.id, { payment: { amount: 500 } });
    check("saldar el balance pasa a Paid", wo.status === "Paid", wo.status);

    console.log("\n--- el disparo es por transicion, no por condicion ---");
    // La pagina de work orders manda el registro completo, con status incluido: si eso contara como
    // eleccion del usuario, el disparo por pago no se activaria nunca desde la UI.
    await store.update(row.id, { status: "Scheduled", totalSale: 500, payment: { amount: 0 } });
    wo = await store.update(row.id, { status: "Scheduled", payment: { amount: 500 } });
    check("mandar el status sin cambiarlo no bloquea el disparo", wo.status === "Paid", wo.status);

    console.log("\n--- el cambio manual gana, y se queda ---");
    wo = await store.update(row.id, { status: "In Progress" });
    check("se puede retroceder a mano de Paid a In Progress", wo.status === "In Progress", wo.status);
    wo = await store.update(row.id, { internalNotes: "editar otra cosa" });
    check("editar otra cosa NO lo devuelve a Paid", wo.status === "In Progress", wo.status);
    wo = await store.update(row.id, { status: "In Progress", techInstructions: "algo" });
    check("guardar el registro completo tampoco", wo.status === "In Progress", wo.status);
    wo = await store.update(row.id, { status: "Scheduled", payment: { amount: 500 } });
    check("cambiar el status a mano gana sobre el balance saldado", wo.status === "Scheduled", wo.status);

    await client.query("ROLLBACK");
    pool.query = realQuery;
    const after = (await pool.query("SELECT status FROM work_orders WHERE id = $1", [row.id])).rows[0];
    check(`la orden queda intacta tras ROLLBACK (${after.status})`, after.status === "Scheduled", after);
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    console.log("ERROR:", err.message);
    console.log(err.stack);
    failures++;
  } finally {
    fs.writeFileSync = realWriteFileSync;
    client.release();
    await pool.end();
  }

  console.log(failures ? `\n${failures} FALLARON` : "\ntodo OK");
  process.exit(failures ? 1 : 0);
})();
