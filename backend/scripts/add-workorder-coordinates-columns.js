require("dotenv").config();
const pool = require("../src/config/db");

// Coordenadas del trabajo, para el mapa de órdenes.
//
// NULL y no 0: (0,0) es un punto real en el golfo de Guinea, y "sin ubicar" tiene que ser
// distinguible de "ubicada" — el mapa cuenta las órdenes sin coordenadas y el backfill busca
// exactamente las filas en NULL.
//
// geocode_source dice de dónde salió el punto:
//   'places'  — capturado gratis del autocompletado al elegir la dirección (Place details ya
//               incluye la geometría en la misma llamada que ya se paga/incluye hoy).
//   'geocode' — del backfill con la API de Geocoding (scripts/backfill-workorder-geocode.js),
//               que es el paso de pago para las ~4,577 direcciones históricas.
async function main() {
  await pool.query("ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS latitude double precision");
  await pool.query("ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS longitude double precision");
  await pool.query("ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS geocode_source text NOT NULL DEFAULT ''");
  console.log("work_orders.latitude / longitude / geocode_source listas.");
  await pool.end();
}

main().catch((e) => {
  console.error("add-workorder-coordinates-columns failed:", e.message);
  process.exit(1);
});
