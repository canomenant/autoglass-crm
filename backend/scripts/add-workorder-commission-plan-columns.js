require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const pool = require("../src/config/db");

// Comisión del agente calculada por su plan (Antonio, 24-sep-2026). Ver lib/agentCommission.js.
//
//   paid_at            cuándo quedó pagada la orden. No existía: el CRM sabía QUE se pagó, no
//                      CUÁNDO. Es la fecha que decide qué plan aplica (y, después, en qué semana
//                      cuenta para el bono). Se sella sola al pasar a pagada; las órdenes pagadas
//                      antes de hoy se quedan en NULL a propósito — así ningún plan las alcanza.
//   commission_source  'plan' = la puso el plan; 'manual' = la tecleó una persona y el plan ya no
//                      la toca; NULL = nadie ha decidido todavía (todas las históricas).
//   commission_detail  el desglose por vidrio con el que se calculó, para mostrarlo en la orden.
async function main() {
  await pool.query(`ALTER TABLE work_orders
    ADD COLUMN IF NOT EXISTS paid_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS commission_source TEXT,
    ADD COLUMN IF NOT EXISTS commission_detail JSONB`);
  console.log("work_orders.paid_at / commission_source / commission_detail listas.");

  const r = await pool.query(
    "SELECT COUNT(*)::int n, COUNT(paid_at)::int con_fecha, COUNT(commission_source)::int con_origen FROM work_orders"
  );
  console.log("Órdenes:", r.rows[0].n, "· con paid_at:", r.rows[0].con_fecha, "· con commission_source:", r.rows[0].con_origen);
  await pool.end();
}

main().catch((e) => {
  console.error("add-workorder-commission-plan-columns failed:", e.message);
  process.exit(1);
});
