require("dotenv").config();
const pool = require("../src/config/db");

// Las diez columnas que la ficha del técnico pedía y la tabla no tenía.
//
// El síntoma era el peor posible: la API ACEPTABA esos campos, los devolvía en la respuesta como
// si los hubiera guardado, y al recargar estaban vacíos. Quien rellenaba el Tax ID, la licencia o
// las notas veía "Técnico actualizado" y perdía el dato en silencio. El store lo tenía anotado
// como hueco conocido de la Fase 4 desde la migración a Postgres.
//
// service_areas y languages van como JSONB porque el modelo los trata como listas
// (`Array.isArray(data.serviceAreas)`), y una columna de texto obligaría a serializar en dos
// sitios. photo es un objeto {name,url} con la imagen en base64, misma razón.
//
// Los valores por defecto reproducen los que el código ya asumía, de modo que las 24 fichas
// existentes no cambian de comportamiento al aparecer las columnas.
const COLUMNAS = [
  ["tax_id", "TEXT NOT NULL DEFAULT ''"],
  ["driver_license", "TEXT NOT NULL DEFAULT ''"],
  ["insurance_expiration", "TEXT NOT NULL DEFAULT ''"],
  ["notes", "TEXT NOT NULL DEFAULT ''"],
  ["photo", "JSONB"],
  ["service_areas", "JSONB NOT NULL DEFAULT '[]'::jsonb"],
  ["languages", "JSONB NOT NULL DEFAULT '[]'::jsonb"],
  ["can_receive_sms", "BOOLEAN NOT NULL DEFAULT true"],
  ["can_receive_links", "BOOLEAN NOT NULL DEFAULT true"],
  ["calendar_color", "TEXT NOT NULL DEFAULT '#2563eb'"],
];

async function main() {
  for (const [nombre, tipo] of COLUMNAS) {
    await pool.query(`ALTER TABLE technicians ADD COLUMN IF NOT EXISTS ${nombre} ${tipo}`);
    console.log(`  technicians.${nombre} lista`);
  }

  const r = await pool.query(
    `SELECT column_name FROM information_schema.columns
      WHERE table_name = 'technicians' AND column_name = ANY($1)`,
    [COLUMNAS.map(([n]) => n)]
  );
  console.log(`\n${r.rows.length} de ${COLUMNAS.length} columnas presentes.`);
  await pool.end();
}

main().catch((e) => {
  console.error("add-technician-missing-columns failed:", e.message);
  process.exit(1);
});
