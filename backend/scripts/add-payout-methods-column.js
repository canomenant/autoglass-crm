require("dotenv").config();
const pool = require("../src/config/db");

// Cómo se le manda el pago a cada técnico: Zelle al 469-610-6271 a nombre de Efficiency Auto
// Glass, un cheque a otro nombre, PayPal a un correo… (Antonio, 21-sep-2026). Antes eso vivía en
// su cabeza o en las notas, y quien armaba el pago tenía que preguntar.
//
// JSONB y no columnas planas porque un técnico acepta VARIAS formas ("Zelle o cheque") y cada una
// necesita su propio destino y su propio titular. Los agentes guardan lo mismo, pero ellos viven
// en app_data, así que allí no hace falta migración.
async function main() {
  await pool.query(`ALTER TABLE technicians ADD COLUMN IF NOT EXISTS payout_methods JSONB NOT NULL DEFAULT '[]'::jsonb`);

  const r = await pool.query(
    `SELECT column_name, data_type, column_default FROM information_schema.columns
      WHERE table_name = 'technicians' AND column_name = 'payout_methods'`
  );
  console.log("technicians.payout_methods:", r.rows[0] || "NO SE CREÓ");

  const n = await pool.query(`SELECT count(*)::int AS con_datos FROM technicians WHERE jsonb_array_length(payout_methods) > 0`);
  console.log("técnicos con formas de pago capturadas:", n.rows[0].con_datos);
  await pool.end();
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
