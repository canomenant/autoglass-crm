require("dotenv").config();
const pool = require("../src/config/db");

// Quién refirió el trabajo cuando el agente es una COMPAÑÍA.
//
// Digiclique Digital Marketing Services es un call center y adentro están David Cruz, Ashley Diaz
// y Kayla Lopez. La comisión se les paga a los tres juntos, en un solo lote a nombre de la
// compañía, y eso no cambia. Lo que faltaba era guardar cuál de ellos trajo cada trabajo: 1,245
// cotizaciones tienen a la compañía como agente y a nadie más, así que el comprobante del socio
// no podía nombrar a la persona (Antonio, 21-sep-2026).
//
// Columnas aparte y no reemplazar agent_id: el agente de la cotización sigue siendo la compañía,
// que es a quien se le paga. Esto sólo agrega la persona.
async function main() {
  await pool.query(`ALTER TABLE quotes ADD COLUMN IF NOT EXISTS agent_person_id INTEGER`);
  await pool.query(`ALTER TABLE quotes ADD COLUMN IF NOT EXISTS agent_person_name TEXT NOT NULL DEFAULT ''`);

  const r = await pool.query(
    `SELECT column_name, data_type FROM information_schema.columns
      WHERE table_name = 'quotes' AND column_name IN ('agent_person_id', 'agent_person_name') ORDER BY 1`
  );
  console.table(r.rows);
  const n = await pool.query(`SELECT count(*)::int AS con_persona FROM quotes WHERE agent_person_id IS NOT NULL`);
  console.log("cotizaciones con persona capturada:", n.rows[0].con_persona);
  await pool.end();
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
