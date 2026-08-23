// Verifica la logica de negocio de lotes contra obligaciones, en payments.store.js.
//
//   cd backend && node scripts/verify-payout-obligations.js
//
// Todo en una transaccion con ROLLBACK. Lo que pinea:
//   - crear un lote marca sus obligaciones pagadas y les setea payout_id
//   - anular lo revierte, y el lote queda en Cancelled como hecho historico
//   - una obligacion que ya tiene lote no puede entrar en otro, y el error dice cual
//   - la formula completa, con los tres terminos que faltaban
//   - work_order_ids se deriva de las obligaciones, nunca se recibe del cliente
require("dotenv").config();
const pool = require("../src/config/db");

let fail = 0;
const check = (l, ok, d) => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${l}`);
  if (!ok) { fail++; if (d !== undefined) console.log("        " + JSON.stringify(d).slice(0, 220)); }
};

(async () => {
  const c = await pool.connect();
  const realQuery = pool.query.bind(pool);
  pool.query = (...a) => c.query(...a);
  try {
    await c.query("BEGIN");
    const store = require("../src/store/payments.store");

    const wo = (await c.query("SELECT work_order_no FROM work_orders WHERE active <> false LIMIT 2")).rows;
    const ids = [];
    for (let i = 0; i < 2; i++) {
      const r = await c.query(
        `INSERT INTO payable (work_order_no, kind, party, amount, source, external_id)
         VALUES ($1,'TECH','Tecnico Prueba',$2::numeric,'test','t:'||$1||':'||$2::text) RETURNING id`,
        [wo[i].work_order_no, 100 + i * 50]);
      ids.push(Number(r.rows[0].id));
    }

    // --- crear ---
    const lote = await store.create({
      type: "TECHNICIAN", payableIds: ids, technicianId: null,
      bonus: 30, deductions: 10, cashAdvance: 20, partsDeduction: 15, partsReturn: 5,
    }, "Test");
    // 100 + 150 = 250 base; 250 + 30 - 10 - 20 - 15 + 5 = 240
    check("la formula completa da 240", Number(lote.netAmount) === 240, { net: lote.netAmount, base: lote.baseAmount });
    check("  guarda los tres terminos nuevos",
      Number(lote.cashAdvance) === 20 && Number(lote.partsDeduction) === 15 && Number(lote.partsReturn) === 5, lote);

    const releido = (await c.query("SELECT cash_advance, parts_deduction, parts_return, work_order_ids FROM payouts WHERE id=$1", [lote.id])).rows[0];
    check("  y sobreviven en la base", Number(releido.cash_advance) === 20 && Number(releido.parts_return) === 5, releido);
    check("work_order_ids se derivo de las obligaciones",
      Array.isArray(releido.work_order_ids) && releido.work_order_ids.length === 2, releido.work_order_ids);

    let ob = (await c.query("SELECT status, payout_id FROM payable WHERE id = ANY($1::bigint[])", [ids])).rows;
    check("las obligaciones quedaron pagadas y vinculadas",
      ob.every((o) => o.status === "pagado" && Number(o.payout_id) === Number(lote.id)), ob);

    // --- rechazo ---
    let err = null;
    try {
      await store.create({ type: "TECHNICIAN", payableIds: [ids[0]] }, "Test");
    } catch (e) { err = e.message; }
    check("rechaza una obligacion que ya tiene lote", !!err, err);
    check("  y nombra cual y en que lote", !!err && err.includes(wo[0].work_order_no), err);

    // --- anular ---
    await store.cancel(lote.id, "Test", "prueba");
    const post = (await c.query("SELECT status FROM payouts WHERE id=$1", [lote.id])).rows[0];
    check("el lote queda en Cancelled, no borrado", post.status === "Cancelled", post);
    ob = (await c.query("SELECT status, payout_id FROM payable WHERE id = ANY($1::bigint[])", [ids])).rows;
    check("  y sus obligaciones vuelven a pendiente",
      ob.every((o) => o.status === "pendiente" && o.payout_id === null), ob);

    // --- reutilizables tras anular ---
    const lote2 = await store.create({ type: "TECHNICIAN", payableIds: ids }, "Test");
    check("tras anular se pueden volver a incluir", Number(lote2.baseAmount) === 250, lote2.baseAmount);

    // --- tipo cruzado ---
    const ag = Number((await c.query(
      `INSERT INTO payable (work_order_no, kind, party, amount, source, external_id)
       VALUES ($1,'AGENT','Agente Prueba',40,'test','t:ag') RETURNING id`, [wo[0].work_order_no])).rows[0].id);
    err = null;
    try { await store.create({ type: "TECHNICIAN", payableIds: [ag] }, "Test"); } catch (e) { err = e.message; }
    check("rechaza mezclar tipos", !!err && /do not match/i.test(err), err);

    await c.query("ROLLBACK");
    pool.query = realQuery;
    const quedan = (await pool.query("SELECT count(*) n FROM payable WHERE source='test'")).rows[0].n;
    check("la base queda intacta tras ROLLBACK", Number(quedan) === 0, quedan);
  } catch (e) {
    await c.query("ROLLBACK").catch(() => {});
    console.log("ERROR:", e.message);
    fail++;
  } finally { pool.query = realQuery; c.release(); await pool.end(); }
  console.log(fail ? `\n${fail} FALLARON` : "\ntodo OK");
  process.exit(fail ? 1 : 0);
})();
