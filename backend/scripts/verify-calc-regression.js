// Regression suite for the Quotes/Work Orders calculation logic.
//
// Read-only against production: it never writes, so it is safe to run any time. Run with:
//   cd backend && node scripts/verify-calc-regression.js
//
// Guards the invariants that the calculation overhaul must not break — the collected total, the
// historical part-cost figure, and the lump-sum tax rule — plus the Q-3871 reference case.
require("dotenv").config();
const { initPostgres } = require("../src/lib/initPostgres");

const COLLECTED_TOTAL = 1501663.29;
const HISTORICAL_PART_COST = 423936.8;
const HISTORICAL_COMMISSION = 52196.47;

let failures = 0;

function check(label, actual, expected, tolerance = 0.005) {
  const ok = Math.abs(Number(actual) - Number(expected)) <= tolerance;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}`);
  if (!ok) {
    console.log(`        esperado ${expected}, obtenido ${actual}`);
    failures++;
  }
}

function checkEqual(label, actual, expected) {
  const ok = actual === expected;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}`);
  if (!ok) {
    console.log(`        esperado ${expected}, obtenido ${actual}`);
    failures++;
  }
}

(async () => {
  await initPostgres();
  const pool = require("../src/config/db");
  const quotesStore = require("../src/store/quotes.store");

  console.log("\n1. Invariantes históricos (nada puede haberlos movido)");
  const collected = await pool.query(
    `SELECT ROUND(SUM((payment->>'amount')::numeric), 2) AS v FROM work_orders WHERE active <> false`
  );
  check("total cobrado sin cambios", collected.rows[0].v, COLLECTED_TOTAL);

  const commission = await pool.query(
    `SELECT ROUND(SUM(commission), 2) AS v FROM work_orders WHERE active <> false`
  );
  check("comisiones históricas sin cambios", commission.rows[0].v, HISTORICAL_COMMISSION);

  console.log("\n2. Part Cost derivado reproduce la columna glass_cost histórica");
  // The whole basis for deriving part cost from line items instead of the (UI-less, always-zero)
  // glass_cost field: across every quote that carries both, the two agree exactly.
  const partCost = await pool.query(`
    SELECT ROUND(SUM(COALESCE(
      (SELECT SUM((li->>'pricePart')::numeric) FROM jsonb_array_elements(line_items) li), 0
    )), 2) AS derived,
    ROUND(SUM(glass_cost), 2) AS stored
    FROM quotes WHERE active <> false AND glass_cost > 0
  `);
  check("Σ lineItems.pricePart == Σ glass_cost", partCost.rows[0].derived, partCost.rows[0].stored);
  check("y coincide con la cifra histórica conocida", partCost.rows[0].stored, HISTORICAL_PART_COST);

  const conflicts = await pool.query(`
    SELECT COUNT(*) AS n FROM (
      SELECT glass_cost, COALESCE(
        (SELECT SUM((li->>'pricePart')::numeric) FROM jsonb_array_elements(line_items) li), 0
      ) AS li_sum
      FROM quotes WHERE active <> false
    ) s WHERE glass_cost > 0 AND li_sum > 0 AND ABS(glass_cost - li_sum) >= 0.01
  `);
  checkEqual("cero registros donde las dos fuentes difieran", Number(conflicts.rows[0].n), 0);

  console.log("\n3. Regla lump-sum: el impuesto grava TODO el subtotal, sin excepciones");
  // Deliberately includes a non-taxable line item: in lump-sum that flag must be ignored, which
  // is exactly what distinguishes this branch from itemized (see the pending note below).
  const lumpSum = quotesStore.__computeTotalsForTest({
    paymentType: "Personal",
    invoiceMode: "lump_sum",
    taxRate: 8.25,
    longTripFee: 40,
    lineItems: [
      { pricePart: 115, priceTier: "Aftermarket", jobType: "Windshield Replacement", isTaxable: true },
      { pricePart: 60, priceTier: "", jobType: "Molding", isTaxable: false },
    ],
  });
  const expectedSubtotal = 115 + 60 + 250 + 40;
  check("subtotal = partes + price tier + calibración + long trip", lumpSum.subtotal, expectedSubtotal);
  check("impuesto = subtotal completo x tasa (ignora isTaxable)", lumpSum.taxAmount, expectedSubtotal * 0.0825);
  check("total = subtotal x (1 + tasa)", lumpSum.totalAmount, expectedSubtotal * 1.0825);

  console.log("\n4. Caso de referencia Q-3871");
  const q3871 = (await quotesStore.list()).find((q) => q.quoteNo === "Q-3871");
  if (!q3871) {
    console.log("  FAIL  Q-3871 no encontrada");
    failures++;
  } else {
    const t = (await quotesStore.get(q3871.id)).totals;
    check("total calculado", t.totalAmount, 395.1125);
    check("part cost (pass-through al distribuidor)", t.partCost, 115);
    check("price tier (nuestro margen)", t.priceTierTotal, 250);

    // Same quote with the final sale price the customer actually paid.
    const withUpsell = quotesStore.__computeTotalsForTest({ ...q3871, upsell: 400 - t.totalAmount });
    check("precio de venta final", withUpsell.finalSalePrice, 400);
    check("upsell = cobrado - calculado", withUpsell.upsell, 4.8875);
    check("ganancia bruta = final - part cost", withUpsell.grossProfit, 400 - 115);
  }

  console.log("\n5. Balance nunca negativo (upsell y vuelto)");
  const overpaid = quotesStore.__computeTotalsForTest({
    paymentType: "Personal",
    invoiceMode: "lump_sum",
    taxRate: 0,
    lineItems: [{ pricePart: 100, priceTier: "", jobType: "X", isTaxable: true }],
    paidAmount: 120,
  });
  check("balance a cobrar con piso en 0", overpaid.remainingBalance, 0);
  check("el excedente aparece como vuelto", overpaid.changeDue, 20);

  console.log(
    "\nPENDIENTE (no es un fallo): en modo itemized el impuesto grava solo pricePart y deja\n" +
      "afuera el Price Tier — Q-3871 daría $374.49 en vez de $395.11. Congelado a la espera\n" +
      "de la consulta con el contador. El desglose por categoría del P&L tampoco es confiable\n" +
      "hasta la Fase B (el 72% del ingreso cae en 'otros'); los totales sí son correctos."
  );

  console.log(failures === 0 ? "\nTODO OK\n" : `\n${failures} VERIFICACIONES FALLARON\n`);
  await pool.end();
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => {
  console.error("El script falló:", e.message, e.stack);
  process.exit(1);
});
