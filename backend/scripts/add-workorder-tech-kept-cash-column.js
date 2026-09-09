require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const pool = require("../src/config/db");

// El efectivo que cobra el técnico se le descuenta de su pago porque ya lo tiene en la mano. Pero
// no siempre se lo queda: en Wo-0014 el cliente pagó $410 en efectivo y la mano de obra de Pedro se
// saldó contra un balance de 2024, así que ese efectivo nunca fue suyo (Antonio, 9-sep-2026).
//
// Hasta hoy la única forma de reflejarlo era mentir en el método de cobro de la orden — se le puso
// "Balance 2024", que describe cómo se le pagó al TÉCNICO en un campo que dice cómo pagó el CLIENTE
// — y por eso aparecía como una forma de cobro más en el reporte al socio.
//
// Esta marca lo dice donde corresponde: el cobro se queda como Cash y la orden lleva la nota de que
// el técnico no se quedó ese dinero. La derivación del efectivo (lib/cashCollected) la respeta.
async function main() {
  await pool.query(`ALTER TABLE work_orders
    ADD COLUMN IF NOT EXISTS tech_kept_cash BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN IF NOT EXISTS tech_cash_note TEXT`);
  console.log("work_orders.tech_kept_cash (por defecto true) y tech_cash_note listas.");

  const r = await pool.query("SELECT COUNT(*)::int n FROM work_orders WHERE tech_kept_cash = false");
  console.log("Órdenes donde el técnico NO se quedó el efectivo:", r.rows[0].n);
  await pool.end();
}

main().catch((e) => {
  console.error("add-workorder-tech-kept-cash-column failed:", e.message);
  process.exit(1);
});
