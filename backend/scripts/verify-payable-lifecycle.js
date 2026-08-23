// Verifica el ciclo de vida de una obligacion: nace pendiente, un lote la marca pagada, y anular
// el lote la devuelve a pendiente.
//
//   cd backend && node scripts/verify-payable-lifecycle.js
//
// Todo en una transaccion con ROLLBACK. Lo que pinea es que el vinculo sobreviva un ida y vuelta
// por la base: que status y payout_id se relean tal cual, y que anular no deje obligaciones
// colgadas apuntando a un lote que ya no paga nada.
require("dotenv").config();
const pool = require("../src/config/db");

let fail = 0;
const check = (l, ok, d) => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${l}`);
  if (!ok) { fail++; if (d !== undefined) console.log("        " + JSON.stringify(d).slice(0, 200)); }
};
const leer = async (c, id) => (await c.query("SELECT status, payout_id FROM payable WHERE id = $1", [id])).rows[0];

(async () => {
  const c = await pool.connect();
  try {
    await c.query("BEGIN");

    const wo = (await c.query("SELECT work_order_no FROM work_orders WHERE active <> false LIMIT 1")).rows[0].work_order_no;
    const ids = [];
    for (const [kind, monto] of [["TECH", 150], ["AGENT", 25], ["DISTRIBUTOR", 90]]) {
      const r = await c.query(
        `INSERT INTO payable (work_order_no, kind, party, amount, source, external_id)
         VALUES ($1,$2,'Prueba',$3,'test','test:' || $2 || ':' || $1) RETURNING id`, [wo, kind, monto]);
      ids.push({ id: r.rows[0].id, kind });
    }
    check("nacen las 3 obligaciones", ids.length === 3);
    for (const { id, kind } of ids) {
      const p = await leer(c, id);
      check(`  ${kind} nace pendiente y sin lote`, p.status === "pendiente" && p.payout_id === null, p);
    }

    // Un lote toma las de TECH y las marca pagadas.
    const lote = (await c.query(
      `INSERT INTO payouts (id, payment_number, type, status, net_amount, active, created_at, updated_at)
       VALUES ((SELECT COALESCE(MAX(id),0)+1 FROM payouts), 'Tech-TEST', 'TECHNICIAN', 'Paid', 150, true, now(), now()) RETURNING id`)).rows[0].id;
    const tech = ids.find((i) => i.kind === "TECH");
    await c.query("UPDATE payable SET status='pagado', payout_id=$2, updated_at=now() WHERE id=$1", [tech.id, lote]);

    let p = await leer(c, tech.id);
    check("el lote la marca pagada", p.status === "pagado" && p.payout_id === lote, p);
    const otras = await Promise.all(ids.filter((i) => i.kind !== "TECH").map((i) => leer(c, i.id)));
    check("  y no toca las de otros tipos", otras.every((o) => o.status === "pendiente" && o.payout_id === null), otras);

    // Releer desde cero, no desde memoria.
    const relectura = (await c.query(
      "SELECT p.status, p.payout_id, o.payment_number FROM payable p JOIN payouts o ON o.id = p.payout_id WHERE p.id = $1", [tech.id])).rows[0];
    check("el vinculo sobrevive la relectura", relectura?.payment_number === "Tech-TEST", relectura);

    // Anular el lote devuelve sus obligaciones a pendiente.
    await c.query("UPDATE payouts SET status='Cancelled', updated_at=now() WHERE id=$1", [lote]);
    await c.query("UPDATE payable SET status='pendiente', payout_id=NULL, updated_at=now() WHERE payout_id=$1", [lote]);
    p = await leer(c, tech.id);
    check("anular el lote la revierte a pendiente", p.status === "pendiente" && p.payout_id === null, p);
    const colgadas = (await c.query(
      "SELECT count(*) n FROM payable WHERE payout_id = $1", [lote])).rows[0].n;
    check("  no quedan obligaciones colgadas del lote anulado", Number(colgadas) === 0, colgadas);

    // El external_id hace el import idempotente.
    const dup = await c.query(
      `INSERT INTO payable (work_order_no, kind, party, amount, source, external_id)
       VALUES ($1,'TECH','Prueba',150,'test','test:TECH:' || $1)
       ON CONFLICT (external_id) DO NOTHING RETURNING id`, [wo]);
    check("external_id impide duplicar la misma obligacion", dup.rowCount === 0);

    await c.query("ROLLBACK");
    const quedan = (await pool.query("SELECT count(*) n FROM payable WHERE source='test'")).rows[0].n;
    check("la base queda intacta tras ROLLBACK", Number(quedan) === 0, quedan);
  } catch (e) {
    await c.query("ROLLBACK").catch(() => {});
    console.log("ERROR:", e.message);
    fail++;
  } finally { c.release(); await pool.end(); }
  console.log(fail ? `\n${fail} FALLARON` : "\ntodo OK");
  process.exit(fail ? 1 : 0);
})();
