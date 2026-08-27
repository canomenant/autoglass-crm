require("dotenv").config();
const pool = require("../src/config/db");

// Técnicos adicionales en una orden de trabajo.
//
// El caso existe desde AppSheet: Wo-3384 la hicieron Antonio Cano y Aaron Gomez, con labor
// distinto cada uno ($120 y $200). El import trajo las DOS obligaciones TECH correctamente
// -payable no tiene restricción que lo impida- pero la orden no puede representarlo: solo hay
// un technician_id, así que quedó 'Antonio Cano , Aaron Gomez' en el campo de texto y el
// technician_id en null.
//
// extra_techs guarda a los técnicos DE MÁS, cada uno con su labor:
//   [{ "technicianId": "...", "name": "Aaron Gomez", "laborCost": 200 }]
//
// labor_cost sigue siendo el TOTAL de la orden -que es como ya está Wo-3384, 320 = 120 + 200-.
// Esa es la razón de modelarlo así: la ganancia bruta, el P&L y Cuentas por Pagar leen
// labor_cost y siguen leyendo lo correcto sin tocar una línea. Lo del técnico principal no se
// guarda aparte, se deriva: labor_cost - suma(extra_techs).
async function main() {
  await pool.query("ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS extra_techs JSONB NOT NULL DEFAULT '[]'::jsonb");
  console.log("work_orders.extra_techs column ready.");
  await pool.end();
}

main().catch((e) => {
  console.error("add-extra-techs failed:", e.message);
  process.exit(1);
});
