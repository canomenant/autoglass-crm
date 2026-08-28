require("dotenv").config();
const pool = require("../src/config/db");

// El total de la factura del distribuidor, capturado a mano desde el papel/PDF que él manda.
//
// Es el numero contra el que se cuadra el lote — el flujo real: llega la factura, se desglosan las
// partes instaladas, y al resto se le aplican notas de crédito/débito hasta que el neto COINCIDE
// con este total. El detalle del pago enseña la diferencia hasta que da cero.
//
// NULL = aún no se capturó (distinto de 0, que sería una factura de cero).
async function main() {
  await pool.query("ALTER TABLE payouts ADD COLUMN IF NOT EXISTS invoice_total numeric");
  console.log("payouts.invoice_total lista.");
  await pool.end();
}

main().catch((e) => {
  console.error("add-payout-invoice-total-column failed:", e.message);
  process.exit(1);
});
