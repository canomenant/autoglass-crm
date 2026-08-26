require("dotenv").config();
const pool = require("../src/config/db");

// Soporte para la revocación de sesiones (requireAuth compara el tokenVersion del JWT con el
// almacenado). Agentes y usuarios lo tienen gratis por vivir en un store JSON; los técnicos
// están en SQL, así que necesitan columna.
//
// Las filas existentes arrancan en 0, que es el mismo valor que llevan los tokens ya emitidos:
// nadie pierde su sesión sólo porque la columna ahora exista. La revocación empieza a aplicar
// hacia adelante, en cuanto alguien cambia su contraseña.
async function main() {
  await pool.query("ALTER TABLE technicians ADD COLUMN IF NOT EXISTS token_version INTEGER NOT NULL DEFAULT 0");
  console.log("technicians.token_version column ready.");
  await pool.end();
}

main().catch((e) => {
  console.error("add-technician-token-version-column failed:", e.message);
  process.exit(1);
});
