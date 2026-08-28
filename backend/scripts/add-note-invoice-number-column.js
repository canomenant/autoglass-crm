require("dotenv").config();
const pool = require("../src/config/db");

// El numero de factura (o de credito) del DISTRIBUIDOR en la nota: el papel de donde salio este
// ajuste. Sin el, y sin la parte, una nota no dice que vidrio es ni de donde viene — que es
// exactamente como quedaron las del import (su CREDIT_INVOICE de AppSheet acabo usado como numero
// de nota, no como campo propio).
async function main() {
  await pool.query("ALTER TABLE credit_debit_note ADD COLUMN IF NOT EXISTS invoice_number text NOT NULL DEFAULT ''");
  console.log("credit_debit_note.invoice_number lista.");
  await pool.end();
}

main().catch((e) => { console.error(e.message); process.exit(1); });
