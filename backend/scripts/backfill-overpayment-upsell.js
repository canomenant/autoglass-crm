require("dotenv").config();
const pool = require("../src/config/db");
const quotesStore = require("../src/store/quotes.store");
const computeTotals = quotesStore.__computeTotalsForTest;

// Anota como upsell lo que ya se cobro por encima del precio final de la cotizacion.
//
// De donde viene: cobrar de mas siempre fue un upsell -el precio se redondea hacia arriba al
// cobrar- pero habia que teclear a mano el Final Sale Price para que quedara registrado. Ahora lo
// hace solo quotesStore.recordOverpaymentAsUpsell cuando se guarda el pago; esto arregla las que ya
// estaban cobradas antes de ese cambio.
//
// Medido el 2026-08-27: de 3,664 ordenes con pago, 274 se cobraron por encima del precio final de
// su cotizacion, por 49,718.37 en total. Las otras 2,626 que a primera vista parecen sobrecobradas
// NO lo estan: su upsell ya esta anotado en la cotizacion y lo que tienen desfasado es la copia
// work_orders.total_sale. Por eso se compara contra computeTotals(quote).finalSalePrice y no contra
// esa columna.
//
// ESTO MUEVE DINERO EN LOS INFORMES. El upsell es margen sin costo asociado: entra entero en el
// gross profit y en el P&L. Leer el resumen antes de aplicar.
//
// Y leerlo separado en dos grupos, porque no son lo mismo:
//   - 16 con precio calculado: sobrecobros de verdad. Se cobro mas de lo que costaba el trabajo.
//   - 258 con la cotizacion VACIA (total 0, sin lineas): ahi el cobro entero pasaria a "upsell", y
//     eso no es un upsell, es una cotizacion sin precio. Son esqueletos del import de agosto. Su
//     ingreso si esta mal contado hoy -finalSalePrice 0 con dinero cobrado-, pero meterlo todo en
//     la categoria upsell distorsionaria el analisis de margen. Lo que necesitan es que alguien les
//     ponga las lineas.
//
// Por eso --only-priced, que se salta las vacias. Ese es el pase seguro.
//
// Lo que NO toca:
//   - Ordenes sin cotizacion: no hay donde anotar el upsell. Su total se edita a mano en la orden.
//   - Cobros por debajo o iguales al precio final: no hay excedente.
//   - El vuelto: lo cobrado es amount - cashComeback. Devolver el sobrante no es un upsell.
//
// --apply para escribir; sin ese flag solo simula.

const APPLY = process.argv.includes("--apply");
const ONLY_PRICED = process.argv.includes("--only-priced");

function cents(n) {
  return Math.round(Number(n || 0) * 100);
}

(async () => {
  const r = await pool.query(
    `SELECT w.work_order_no, w.quote_id, w.total_sale, w.status,
            COALESCE((w.payment->>'amount')::numeric, 0) AS amount,
            COALESCE((w.payment->>'cashComeback')::numeric, 0) AS comeback
       FROM work_orders w
      WHERE w.active <> false AND w.quote_id IS NOT NULL
        AND COALESCE((w.payment->>'amount')::numeric, 0) > 0
      ORDER BY w.work_order_no`
  );

  const pendientes = [];
  for (const row of r.rows) {
    const quote = await quotesStore.get(row.quote_id);
    if (!quote) continue;
    const totals = computeTotals(quote);
    const collected = Number(row.amount) - Number(row.comeback);
    if (cents(collected) <= cents(totals.finalSalePrice)) continue;
    pendientes.push({
      workOrderNo: row.work_order_no,
      quoteId: row.quote_id,
      quoteNo: quote.quoteNo,
      status: row.status,
      totalAmount: totals.totalAmount,
      upsellAntes: totals.upsell,
      upsellDespues: cents(collected - totals.totalAmount) / 100,
      finalSalePrice: cents(collected) / 100,
    });
  }

  const conPrecio = pendientes.filter((p) => cents(p.totalAmount) > 0);
  const vacias = pendientes.filter((p) => cents(p.totalAmount) === 0);
  const suma = (xs) => xs.reduce((a, p) => a + (p.upsellDespues - p.upsellAntes), 0);

  console.log(`Ordenes con pago revisadas: ${r.rowCount}`);
  console.log(`Sobrecobros con precio calculado: ${conPrecio.length}  ($${suma(conPrecio).toFixed(2)})`);
  console.log(`Con la cotizacion vacia (total 0): ${vacias.length}  ($${suma(vacias).toFixed(2)})  <- no son upsell, son cotizaciones sin lineas`);

  const objetivo = ONLY_PRICED ? conPrecio : pendientes;
  console.log(`\nSe corregirian: ${objetivo.length}  ($${suma(objetivo).toFixed(2)})${ONLY_PRICED ? "  [--only-priced]" : "  [TODAS, incluidas las vacias]"}`);

  console.log("\nLas 15 mayores del objetivo:");
  for (const p of [...objetivo].sort((a, b) => b.upsellDespues - a.upsellDespues).slice(0, 15)) {
    console.log(
      `  ${p.workOrderNo} (${p.status}) total=${p.totalAmount.toFixed(2)} cobrado=${p.finalSalePrice.toFixed(2)} ` +
        `upsell ${p.upsellAntes.toFixed(2)} -> ${p.upsellDespues.toFixed(2)}`
    );
  }

  if (!APPLY) {
    console.log("\nSimulacion. Volver a lanzar con --apply para escribir.");
    await pool.end();
    return;
  }

  let escritas = 0;
  for (const p of objetivo) {
    await pool.query("UPDATE quotes SET upsell = $2, updated_at = now() WHERE id = $1", [p.quoteId, p.upsellDespues]);
    await pool.query(
      `UPDATE work_orders SET total_sale = $2, updated_at = now()
        WHERE quote_id = $1 AND active <> false`,
      [p.quoteId, p.finalSalePrice]
    );
    escritas++;
  }
  console.log(`\nEscritas ${escritas} cotizaciones y sus ordenes.`);
  await pool.end();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
