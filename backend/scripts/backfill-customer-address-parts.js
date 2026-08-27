require("dotenv").config();
const pool = require("../src/config/db");

// Rellena city / state / zip_code de los clientes a partir de su direccion completa.
//
// El problema: de 4,353 clientes activos, 4,332 tienen direccion pero solo 310 tienen ciudad y
// 659 estado y codigo postal. La direccion llego de AppSheet como UN solo campo de texto, y los
// campos sueltos nunca se capturaron. Por eso al abrir un cliente los ves vacios aunque la
// direccion este ahi.
//
// La direccion casi siempre trae la forma "<calle>, <ciudad>, <ST> <ZIP>, <pais>":
//   "801 W Covina Blvd, San Dimas, CA 91773, USA"
//   "943 W Bay Area Blvd, Webster, TX 77598, EE. UU."   <- el pais tambien viene en español
//   "311 Jarbridge Dr Kyle, TX"                          <- sin zip y sin coma antes de la ciudad
//
// Reglas deliberadas:
//   - Solo escribe en campos VACIOS. Un dato capturado a mano manda siempre.
//   - Si no puede leer la parte con confianza, no inventa: deja el campo como esta y lo cuenta
//     como "sin resolver" para que se vea cuantos quedan.
//   - --apply para escribir; sin ese flag solo simula e informa.

const PAISES = /^(USA|US|EE\.? ?UU\.?|United States|Estados Unidos)$/i;

// "CA 91773" | "CA" | "TX 77598-1234"
const ESTADO_ZIP = /^([A-Z]{2})(?:\s+(\d{5})(?:-\d{4})?)?$/;

function parseAddress(raw) {
  const partes = String(raw || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  // El pais al final no aporta nada aqui.
  while (partes.length && PAISES.test(partes[partes.length - 1])) partes.pop();
  if (partes.length < 2) return null;

  const ultima = partes[partes.length - 1];
  const m = ultima.match(ESTADO_ZIP);
  if (!m) return null;

  const state = m[1];
  const zipCode = m[2] || "";
  // La ciudad es el trozo anterior al "ST ZIP". Con solo dos trozos ("311 Jarbridge Dr Kyle, TX")
  // el primero es calle+ciudad pegadas y no se puede separar con seguridad: se deja sin ciudad.
  const city = partes.length >= 3 ? partes[partes.length - 2] : "";

  return { city, state, zipCode };
}

async function main() {
  const apply = process.argv.includes("--apply");

  const r = await pool.query(
    `SELECT id, first_name, last_name, address, city, state, zip_code
       FROM customers
      WHERE active <> false
        AND COALESCE(btrim(address), '') <> ''
        AND (COALESCE(btrim(city), '') = '' OR COALESCE(btrim(state), '') = '' OR COALESCE(btrim(zip_code), '') = '')`
  );

  let tocados = 0;
  let sinResolver = 0;
  const ejemplos = [];

  for (const c of r.rows) {
    const p = parseAddress(c.address);
    if (!p) {
      sinResolver++;
      if (ejemplos.length < 5) ejemplos.push({ tipo: "sin resolver", address: c.address });
      continue;
    }

    // Solo lo que este vacio.
    const city = String(c.city || "").trim() || p.city;
    const state = String(c.state || "").trim() || p.state;
    const zip = String(c.zip_code || "").trim() || p.zipCode;

    const cambia = city !== (c.city || "") || state !== (c.state || "") || zip !== (c.zip_code || "");
    if (!cambia) continue;

    tocados++;
    if (ejemplos.length < 5) {
      ejemplos.push({ tipo: "rellena", address: c.address, city, state, zip });
    }
    if (apply) {
      await pool.query("UPDATE customers SET city = $2, state = $3, zip_code = $4, updated_at = now() WHERE id = $1", [
        c.id,
        city,
        state,
        zip,
      ]);
    }
  }

  console.log(apply ? "=== APLICADO ===" : "=== SIMULACION (usa --apply para escribir) ===");
  console.log("clientes revisados      :", r.rows.length);
  console.log("clientes que se rellenan:", tocados);
  console.log("sin resolver (se dejan) :", sinResolver);
  console.log("\nejemplos:");
  console.table(ejemplos);
  await pool.end();
}

main().catch((e) => {
  console.error("backfill-customer-address-parts failed:", e.message);
  process.exit(1);
});
