// Verifica el cierre automático de work orders (Closed = ya no se le debe nada a nadie).
//
//   cd backend && node scripts/verify-workorder-closure.js
//
// Corre dentro de una transacción que SIEMPRE se revierte, y no escribe el archivo de datos: no
// cambia nada.
//
// Las reglas (Antonio, 15-sep-2026), cada una con su prueba:
//   1. técnico, agente y distribuidor pagados -> Closed; cualquiera pendiente -> se queda Paid
//   2. Alex Reyes no cobra comisión: su $0 pendiente no impide cerrar; el $0 de otro agente sí
//   3. sin vidrio comprado no se exige distribuidor; con costo de vidrio y sin obligación, no cierra
//   4. sin obligación de técnico o de agente no cierra
//   5. una incobrable (Completed) también cierra, y al reabrir vuelve a Completed
//   6. reabrir solo con un hecho que deshace un pago (soltar obligación), nunca por condición
//   7. un Closed -> Paid puesto a mano no se deshace al editar otra cosa
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

  let woId = null;
  try {
    await client.query("BEGIN");
    const { syncClosedStatus } = require("../src/lib/workOrderClosure");
    const store = require("../src/store/workorders.store");
    const payments = require("../src/store/payments.store");

    // Una orden Paid con las tres obligaciones, agente que no es Alex, y la del técnico dentro de un
    // lote vivo (para poder soltarla y volverla a enlazar).
    const w = (await client.query(
      `SELECT w.id, w.work_order_no, t.id AS tech_payable, t.payout_id
         FROM work_orders w
         JOIN payable t ON t.work_order_no = w.work_order_no AND t.kind = 'TECH' AND t.payout_id IS NOT NULL
         JOIN payouts o ON o.id = t.payout_id AND o.status <> 'Cancelled' AND o.active <> false
        WHERE w.active <> false AND w.status = 'Paid' AND w.uncollectible_at IS NULL
          AND (SELECT count(*) FROM payable x WHERE x.work_order_no = w.work_order_no AND x.kind = 'TECH') = 1
          AND EXISTS (SELECT 1 FROM payable a WHERE a.work_order_no = w.work_order_no AND a.kind = 'AGENT' AND btrim(a.party) <> 'Alex Reyes')
          AND NOT EXISTS (SELECT 1 FROM payable a WHERE a.work_order_no = w.work_order_no AND a.kind = 'AGENT' AND btrim(a.party) = 'Alex Reyes')
          AND EXISTS (SELECT 1 FROM payable d WHERE d.work_order_no = w.work_order_no AND d.kind = 'DISTRIBUTOR')
        ORDER BY w.work_order_no DESC LIMIT 1`
    )).rows[0];
    if (!w) throw new Error("No encontré una orden de prueba adecuada");
    woId = w.id;
    const WO = w.work_order_no;
    console.log(`orden de prueba: ${WO}`);

    const status = async () => (await client.query("SELECT status FROM work_orders WHERE id = $1", [w.id])).rows[0].status;
    const setStatus = (s) => client.query("UPDATE work_orders SET status = $2 WHERE id = $1", [w.id, s]);
    const setPayables = (set, kind = null) =>
      client.query(`UPDATE payable SET ${set} WHERE work_order_no = $1 AND ($2::text IS NULL OR kind = $2)`, [WO, kind]);
    const todoPagado = () => setPayables("status = 'pagado'");

    console.log("\n--- 1. las tres pagadas cierran, una pendiente no ---");
    await setStatus("Paid");
    await todoPagado();
    await setPayables("status = 'pendiente', amount = 50", "DISTRIBUTOR");
    await syncClosedStatus([WO]);
    check("distribuidor pendiente -> sigue Paid", (await status()) === "Paid");
    await todoPagado();
    await setPayables("status = 'pendiente'", "TECH");
    await syncClosedStatus([WO]);
    check("técnico pendiente -> sigue Paid", (await status()) === "Paid");
    await todoPagado();
    await setPayables("status = 'pendiente'", "AGENT");
    await syncClosedStatus([WO]);
    check("agente pendiente -> sigue Paid", (await status()) === "Paid");
    await todoPagado();
    const [c1] = await syncClosedStatus([WO]);
    check("todo pagado -> Closed", (await status()) === "Closed", c1);
    await setStatus("Paid");
    await setPayables("status = 'acreditado'", "DISTRIBUTOR");
    await syncClosedStatus([WO]);
    check("distribuidor acreditado cuenta como saldado", (await status()) === "Closed");

    console.log("\n--- 2. Alex Reyes no cobra comisión ---");
    await setStatus("Paid");
    await todoPagado();
    await setPayables("status = 'pendiente', amount = 0, party = 'Alex Reyes'", "AGENT");
    await syncClosedStatus([WO]);
    check("comisión $0 pendiente de Alex -> Closed", (await status()) === "Closed");
    await setStatus("Paid");
    await setPayables("party = 'Edgar Medina'", "AGENT");
    await syncClosedStatus([WO]);
    check("comisión $0 pendiente de otro agente -> sigue Paid", (await status()) === "Paid");

    console.log("\n--- 3. distribuidor solo si hubo vidrio ---");
    await todoPagado();
    await client.query("DELETE FROM payable WHERE work_order_no = $1 AND kind = 'DISTRIBUTOR'", [WO]);
    await client.query("UPDATE work_orders SET glass_cost = 0 WHERE id = $1", [w.id]);
    await syncClosedStatus([WO]);
    check("sin vidrio y sin obligación de distribuidor -> Closed", (await status()) === "Closed");
    await setStatus("Paid");
    await client.query("UPDATE work_orders SET glass_cost = 120 WHERE id = $1", [w.id]);
    await syncClosedStatus([WO]);
    check("con costo de vidrio y sin obligación de distribuidor -> sigue Paid", (await status()) === "Paid");

    console.log("\n--- 4. técnico y agente son obligatorios ---");
    await client.query("UPDATE work_orders SET glass_cost = 0 WHERE id = $1", [w.id]);
    await client.query("SAVEPOINT sin_agente");
    await client.query("DELETE FROM payable WHERE work_order_no = $1 AND kind = 'AGENT'", [WO]);
    await syncClosedStatus([WO]);
    check("sin obligación de agente -> sigue Paid", (await status()) === "Paid");
    await client.query("ROLLBACK TO SAVEPOINT sin_agente");
    await client.query("SAVEPOINT sin_tecnico");
    await client.query("DELETE FROM payable WHERE work_order_no = $1 AND kind = 'TECH'", [WO]);
    await syncClosedStatus([WO]);
    check("sin obligación de técnico -> sigue Paid", (await status()) === "Paid");
    await client.query("ROLLBACK TO SAVEPOINT sin_tecnico");

    console.log("\n--- 5. incobrables ---");
    await setStatus("Completed");
    await client.query("UPDATE work_orders SET uncollectible_at = now() WHERE id = $1", [w.id]);
    await syncClosedStatus([WO]);
    check("incobrable con todo pagado -> Closed", (await status()) === "Closed");
    await setPayables("status = 'pendiente'", "TECH");
    await syncClosedStatus([WO], { reopen: true });
    check("al reabrir una incobrable vuelve a Completed, no a Paid", (await status()) === "Completed");
    await client.query("UPDATE work_orders SET uncollectible_at = NULL WHERE id = $1", [w.id]);
    await setStatus("Scheduled");
    await todoPagado();
    await syncClosedStatus([WO]);
    check("una Scheduled con todo pagado NO se cierra (el cliente no ha pagado)", (await status()) === "Scheduled");

    console.log("\n--- 6. soltar y volver a enlazar un pago ---");
    await setStatus("Paid");
    await syncClosedStatus([WO]);
    check("punto de partida Closed", (await status()) === "Closed");
    await syncClosedStatus([WO]);
    await setPayables("status = 'pendiente'", "AGENT");
    await syncClosedStatus([WO]);
    check("sin reopen, una obligación pendiente NO reabre", (await status()) === "Closed");
    await todoPagado();
    await payments.unlinkObligation(w.payout_id, w.tech_payable, "prueba");
    check("soltar la obligación del técnico del lote reabre a Paid", (await status()) === "Paid");
    await payments.linkObligations(w.payout_id, [w.tech_payable], "prueba");
    check("volver a enlazarla la cierra", (await status()) === "Closed");

    console.log("\n--- 7. guardar la orden ---");
    await store.update(w.id, { status: "Completed", totalSale: 500, payment: { amount: 0, paid: false } });
    await todoPagado();
    let wo = await store.update(w.id, { payment: { amount: 500, paid: true } });
    check("el cliente termina de pagar con todo lo demás pagado -> Closed", wo.status === "Closed" && (await status()) === "Closed", wo.status);
    wo = await store.update(w.id, { status: "Paid" });
    check("se puede regresar a mano de Closed a Paid", wo.status === "Paid", wo.status);
    wo = await store.update(w.id, { internalNotes: "editar otra cosa" });
    check("editar otra cosa NO la vuelve a cerrar", wo.status === "Paid" && (await status()) === "Paid", wo.status);
    wo = await store.update(w.id, { status: "Paid", techInstructions: "algo" });
    check("guardar el registro completo tampoco", wo.status === "Paid", wo.status);

    await client.query("ROLLBACK");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    console.log("ERROR:", err.message);
    console.log(err.stack);
    failures++;
  } finally {
    pool.query = realQuery;
    fs.writeFileSync = realWriteFileSync;
    client.release();
  }

  if (woId) {
    const after = (await pool.query("SELECT status FROM work_orders WHERE id = $1", [woId])).rows[0];
    check(`la orden queda intacta tras ROLLBACK (${after.status})`, after.status === "Paid", after);
  }
  await pool.end();
  console.log(failures ? `\n${failures} FALLARON` : "\ntodo OK");
  process.exit(failures ? 1 : 0);
})();
