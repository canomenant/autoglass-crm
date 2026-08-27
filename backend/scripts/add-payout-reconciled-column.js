require("dotenv").config();
const pool = require("../src/config/db");

// Marca de conciliación bancaria de un lote de pago: cuándo se cotejó contra el cargo real del
// extracto (tarjeta/banco) y quién lo hizo. NULL = pendiente de conciliar.
//
// Vive en payouts y no en una tabla aparte porque la pregunta es por lote ("¿este cargo del
// extracto ya está casado con un pago del sistema?") y un lote se concilia una sola vez.
async function main() {
  await pool.query("ALTER TABLE payouts ADD COLUMN IF NOT EXISTS reconciled_at timestamptz");
  await pool.query("ALTER TABLE payouts ADD COLUMN IF NOT EXISTS reconciled_by text NOT NULL DEFAULT ''");
  console.log("payouts.reconciled_at / reconciled_by listas.");
  await pool.end();
}

main().catch((e) => {
  console.error("add-payout-reconciled-column failed:", e.message);
  process.exit(1);
});
