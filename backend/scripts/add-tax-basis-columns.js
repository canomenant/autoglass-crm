require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const pool = require("../src/config/db");

// Sales tax solo sobre PARTES (Antonio con el socio, 8-sep-2026): al estado se reporta el impuesto
// de las partes, no del labor. Hasta hoy el modo lump_sum gravaba el subtotal completo (partes +
// Price Tier, que es la mano de obra, + calibración + viaje): en 2025 eso son $80,998.81 de
// impuesto en el CRM contra $28,847.82 reales sobre partes.
//
// Dos columnas nuevas de criterio:
//   quotes.tax_rule           'subtotal' = regla vieja, congelada en TODAS las cotizaciones que ya
//                             existen para que sus totales (y las órdenes pagadas que salieron de
//                             ellas) no se muevan ni aparezca un "cambio a favor" fantasma.
//                             'parts' = regla nueva; la pone el store en cada cotización nueva.
//   work_orders.tax_rate, taxable_base, non_taxable_base, sales_tax
//                             Snapshot de lo que se le DEBE al estado por esa orden (siempre sobre
//                             partes), escrito al convertir y al sincronizar la cotización mientras
//                             la orden no esté pagada. Los reportes leen esto y no la cotización, así
//                             editar una cotización vieja o cambiar el catálogo nunca mueve un mes ya
//                             declarado. El backfill lo hace scripts/backfill-workorder-tax-snapshot.js.
async function main() {
  await pool.query("ALTER TABLE quotes ADD COLUMN IF NOT EXISTS tax_rule TEXT");
  const r = await pool.query("UPDATE quotes SET tax_rule = 'subtotal' WHERE tax_rule IS NULL");
  console.log(`quotes.tax_rule listo; ${r.rowCount} cotizaciones existentes congeladas en 'subtotal'.`);

  await pool.query(`ALTER TABLE work_orders
    ADD COLUMN IF NOT EXISTS tax_rate NUMERIC,
    ADD COLUMN IF NOT EXISTS taxable_base NUMERIC,
    ADD COLUMN IF NOT EXISTS non_taxable_base NUMERIC,
    ADD COLUMN IF NOT EXISTS sales_tax NUMERIC`);
  console.log("work_orders.tax_rate / taxable_base / non_taxable_base / sales_tax listas (vacías hasta el backfill).");
  await pool.end();
}

main().catch((e) => {
  console.error("add-tax-basis-columns failed:", e.message);
  process.exit(1);
});
