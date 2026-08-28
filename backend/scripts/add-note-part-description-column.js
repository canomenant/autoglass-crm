require("dotenv").config();
const pool = require("../src/config/db");

// La descripcion NAGS de la parte, copiada del catalogo al elegirla en la nota — igual que hacen
// las cotizaciones y las obligaciones (payable.part_description). Denormalizada a proposito: las
// listas de notas no pueden cargar el catalogo de 10,403 partes solo para pintar una descripcion.
async function main() {
  await pool.query("ALTER TABLE credit_debit_note ADD COLUMN IF NOT EXISTS part_description text NOT NULL DEFAULT ''");
  console.log("credit_debit_note.part_description lista.");
  await pool.end();
}

main().catch((e) => { console.error(e.message); process.exit(1); });
