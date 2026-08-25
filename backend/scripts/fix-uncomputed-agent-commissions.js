// PASO 15: las comisiones de agente cuyo total nunca se calculo.
//
//   cd backend && node scripts/fix-uncomputed-agent-commissions.js          # dry-run, ROLLBACK
//   cd backend && node scripts/fix-uncomputed-agent-commissions.js --apply
//
// La comision de una orden es la suma de sus componentes:
//   total_pay = aftermarket + recommended + oem + services + insurance
// Se cumple en 3,559 de las 3,573 filas (99.6%). Las 14 excepciones son todas filas con total en
// cero y componentes con valor: el total no se calculo nunca.
//
// PERO no se pueden arreglar las 14. El mismo defecto aparente significa cosas opuestas segun el
// lote:
//
//   Agent-0132  subtotal $180.00, renglones $65.00, ceros por $115.00  -> calcularlos lo CUADRA
//   Agent-0081  subtotal  $25.00, renglones $25.00, ceros por $105.00  -> ya cuadra, calcularlos
//                                                                        lo romperia por $105.00
//
// En el primero el cero es un calculo que falto. En el segundo es una decision: esas comisiones no
// se pagaron en ese lote, y el subtotal lo confirma. Correr la regla sobre las 14 arreglaria uno y
// rompperia el otro, asi que la condicion para escribir no es "el total esta en cero" sino "al
// calcularlo, el lote cuadra con su subtotal".
//
// Los montos no se inventan: salen de los componentes que ya estaban capturados en esa misma fila.
require("dotenv").config();
const pool = require("../src/config/db");

const APPLY = process.argv.includes("--apply");
const money = (n) => "$" + Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const cerca = (a, b) => Math.abs(Number(a) - Number(b)) < 0.005;

(async () => {
  const c = await pool.connect();
  try {
    await c.query("BEGIN");

    // Filas con el total sin calcular, junto con el lote que las pago y su subtotal.
    const rotas = (await c.query(
      `SELECT k.id, k.work_order_no, k.agent, k.external_id,
              (COALESCE(k.aftermarket,0) + COALESCE(k.recommended,0) + COALESCE(k.oem,0)
               + COALESCE(k.services,0) + COALESCE(k.insurance,0))::numeric AS debe_ser,
              p.payout_id, o.payment_number, o.gross_amount
         FROM work_order_agent_commission k
         JOIN payable p ON p.external_id = 'agent:' || k.external_id
         LEFT JOIN payouts o ON o.id = p.payout_id
        WHERE COALESCE(k.total_pay,0) = 0
          AND (COALESCE(k.aftermarket,0) + COALESCE(k.recommended,0) + COALESCE(k.oem,0)
               + COALESCE(k.services,0) + COALESCE(k.insurance,0)) > 0
        ORDER BY o.payment_number, k.work_order_no`)).rows;

    // Se agrupa por lote y solo se escribe donde calcular los ceros deja el lote cuadrado.
    const porLote = new Map();
    for (const r of rotas) {
      const k = r.payment_number || "(sin lote)";
      if (!porLote.has(k)) porLote.set(k, { lote: r.payment_number, gross: Number(r.gross_amount || 0), filas: [] });
      porLote.get(k).filas.push(r);
    }

    const aplicar = [];
    const resumen = [];
    for (const [numero, g] of porLote) {
      const suma = (await c.query(
        "SELECT COALESCE(SUM(amount),0)::numeric s FROM payable WHERE payout_id = (SELECT id FROM payouts WHERE payment_number = $1)",
        [numero])).rows[0].s;
      const falta = Number(g.gross) - Number(suma);
      const aportan = g.filas.reduce((s, x) => s + Number(x.debe_ser), 0);
      const cuadra = cerca(aportan, falta);
      resumen.push({
        lote: numero, subtotal: money(g.gross), renglones: money(suma), ceros: g.filas.length,
        aportan: money(aportan), falta: money(falta), decision: cuadra ? "SE APLICA" : "no se toca",
      });
      if (cuadra) aplicar.push(...g.filas);
    }

    console.log(APPLY ? "=== APLICANDO ===" : "=== DRY-RUN (termina en ROLLBACK) ===");
    console.log(`filas con el total sin calcular: ${rotas.length}\n`);
    console.table(resumen);

    const antes = (await c.query("SELECT round(SUM(commission),2) c FROM work_orders WHERE active <> false")).rows[0].c;

    for (const r of aplicar) {
      await c.query("UPDATE work_order_agent_commission SET total_pay = $2 WHERE id = $1", [r.id, r.debe_ser]);
      await c.query("UPDATE payable SET amount = $2, updated_at = now() WHERE external_id = $1", ["agent:" + r.external_id, r.debe_ser]);
    }
    // La cabecera es la suma de las comisiones de esa orden, no una copia de una sola fila: una
    // orden puede tener mas de un agente.
    const ordenes = [...new Set(aplicar.map((r) => r.work_order_no))];
    if (ordenes.length) {
      await c.query(
        `UPDATE work_orders w SET commission = COALESCE(x.s, 0), updated_at = now()
           FROM (SELECT work_order_no, SUM(total_pay) s FROM work_order_agent_commission GROUP BY 1) x
          WHERE x.work_order_no = w.work_order_no AND w.work_order_no = ANY($1::text[])`, [ordenes]);
    }

    const despues = (await c.query("SELECT round(SUM(commission),2) c FROM work_orders WHERE active <> false")).rows[0].c;
    console.log(`filas escritas: ${aplicar.length} sobre ${ordenes.length} ordenes`);
    console.log(`comision total: ${money(antes)}  ->  ${money(despues)}   (+${money(Number(despues) - Number(antes))})`);

    console.log("\n--- los lotes tocados, ya cuadrados ---");
    console.table((await c.query(
      `SELECT o.payment_number, o.gross_amount AS subtotal, o.bonus, o.commission_amount,
              (SELECT round(SUM(amount),2) FROM payable WHERE payout_id = o.id) AS renglones
         FROM payouts o WHERE o.payment_number = ANY($1::text[])`,
      [[...new Set(aplicar.map((r) => r.payment_number))]])).rows);

    if (APPLY) { await c.query("COMMIT"); console.log("\nCOMMIT"); }
    else { await c.query("ROLLBACK"); console.log("\nROLLBACK: nada quedo escrito. Corre con --apply."); }
  } catch (e) {
    await c.query("ROLLBACK");
    console.error("ROLLBACK:", e.message);
    process.exitCode = 1;
  } finally {
    c.release();
    await pool.end();
  }
})().catch((e) => { console.error(e); process.exit(1); });
