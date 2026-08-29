require("dotenv").config();
const pool = require("../src/config/db");

// La ventana de llegada de la cita: 'AM' (9–1), 'PM' (1–5), 'ALL_DAY', 'EXACT' (hora fija en
// appointment_time) o NULL (sin confirmar). El negocio agenda por ventanas — "te llegamos entre
// 9 y 1" — y el calendario apilaba todo a las 9 AM porque este concepto no existía: solo había
// fecha + hora exacta opcional (pedido de Antonio, 29-ago-2026; propuesta "Opción A").
//
// Backfill: una orden que YA trae hora es de hora fija. Las demás quedan NULL (sin confirmar) —
// inventarles una ventana sería fabricar dato.

(async () => {
  await pool.query("ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS appointment_window TEXT");
  await pool.query("ALTER TABLE quotes ADD COLUMN IF NOT EXISTS appointment_window TEXT");
  const r = await pool.query(
    `UPDATE work_orders SET appointment_window = 'EXACT'
      WHERE appointment_window IS NULL AND btrim(COALESCE(appointment_time, '')) <> ''`
  );
  console.log(`Columnas creadas. Órdenes con hora marcadas EXACT: ${r.rowCount}.`);
  await pool.end();
})().catch((e) => {
  console.error("FALLA:", e.message);
  process.exit(1);
});
