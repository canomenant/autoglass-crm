require("dotenv").config();
const pool = require("../src/config/db");

// Las facturas del distribuidor que cubre un lote de pago: [{ date, number, amount }]. Un solo
// pago suele saldar varias facturas y algun credito (monto negativo) — el ejemplo real que motivo
// esto: Dist-0015 = I04527972-0 ($104.43) + I04527974-0 ($58.80) + credito I04527973-0 (-$148.69)
// = $14.54, el pago exacto. El campo suelto invoice_number se queda como legado; invoice_total
// pasa a derivarse de la suma de esta lista cuando la lista existe.
async function main() {
  await pool.query("ALTER TABLE payouts ADD COLUMN IF NOT EXISTS invoices jsonb NOT NULL DEFAULT '[]'");
  console.log("payouts.invoices lista.");
  await pool.end();
}

main().catch((e) => { console.error(e.message); process.exit(1); });
