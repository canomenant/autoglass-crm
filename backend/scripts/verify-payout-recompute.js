// Verifica que recomputeAmount() de payments.store reproduzca el monto ya guardado en cada lote.
//
//   cd backend && node scripts/verify-payout-recompute.js
//
// Es la prueba de que editar un lote no mueve dinero. Antes no era cierto: la formula estaba
// copiada en create(), update() y applyAdjustmentTotals(), y las dos ultimas habian perdido
// terminos — los tres de efectivo/partes del tecnico y el bonus/descuento del distribuidor y
// del agente. Con los datos reales, un update() sobre los lotes importados los movia
// +$185,984.55 en tecnico y -$16,927.56 en distribuidor.
//
// Vale la pena volver a correrlo despues de tocar la formula o de importar notas.
require("dotenv").config();
const pool = require("../src/config/db");
const { mapPayment } = require("../src/lib/sqlMappers");

const money = (n) => "$" + Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Misma formula que payments.store.recomputeAmount(). Se repite a proposito: si alguien cambia
// una y no la otra, este script lo grita en vez de validar su propio error.
function esperado(p) {
  const n = (v) => Number(v || 0);
  const notas = n(p.debitNotesTotal) - n(p.creditNotesTotal);
  if (p.type === "TECHNICIAN") {
    return n(p.baseAmount) + n(p.bonus) - n(p.deductions) - n(p.cashAdvance) - n(p.partsDeduction) + n(p.partsReturn) + notas;
  }
  if (p.type === "DISTRIBUTOR") return n(p.subtotal) + n(p.bonus) - n(p.deductions) + n(p.taxAmount) + notas;
  if (p.type === "AGENT") return n(p.grossAmount) + n(p.bonus) - n(p.deductions) + notas;
  return null;
}
const guardado = (p) =>
  p.type === "TECHNICIAN" ? Number(p.netAmount || 0)
  : p.type === "DISTRIBUTOR" ? Number(p.totalAmount || 0)
  : Number(p.commissionAmount || 0);

(async () => {
  const filas = (await pool.query("SELECT * FROM payouts WHERE active <> false ORDER BY type, id")).rows.map(mapPayment);
  const resumen = {};
  const malos = [];

  for (const p of filas) {
    const R = (resumen[p.type] = resumen[p.type] || { lotes: 0, ok: 0, mal: 0, deriva: 0 });
    R.lotes++;
    const e = esperado(p), g = guardado(p);
    if (Math.abs(e - g) < 0.005) R.ok++;
    else {
      R.mal++;
      R.deriva += e - g;
      malos.push({ lote: p.paymentNumber || "id " + p.id, tipo: p.type, guardado: g, formula: e, dif: e - g });
    }
  }

  console.table(Object.fromEntries(Object.entries(resumen).map(([k, v]) => [k, {
    lotes: v.lotes, cuadra: v.ok, "NO cuadra": v.mal, deriva: money(v.deriva),
  }])));

  if (!malos.length) {
    console.log("OK: la formula reproduce el monto guardado en los " + filas.length + " lotes.");
    console.log("Editar cualquiera de ellos no mueve el importe.");
  } else {
    console.log("\n--- " + malos.length + " lote(s) donde la formula NO reproduce lo guardado ---");
    malos.slice(0, 30).forEach((x) =>
      console.log("  [" + x.tipo + "] " + x.lote + ": guardado " + money(x.guardado) + ", formula " + money(x.formula) + ", dif " + money(x.dif)));
    if (malos.length > 30) console.log("  ... y " + (malos.length - 30) + " mas");
    process.exitCode = 1;
  }
  await pool.end();
})().catch((e) => { console.error(e); process.exit(1); });
