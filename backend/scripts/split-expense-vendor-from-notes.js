require("dotenv").config();
const pool = require("../src/config/db");

// Separa proveedor y método de pago de las notas de los gastos existentes.
//
// No es una heurística: import-operating-expenses.js compuso literalmente
// `notes = descripción — método` (con " — ", guión largo entre espacios), así que el corte deshace
// exactamente lo que aquel hizo. Medido 2026-08-27: las 330 notas tienen el separador.
//
//   vendor        <- lo de antes del último " — " (el descriptor del extracto: "LL MEDIA 888-...")
//   paymentMethod <- lo de después ("Business Credit Card ...ending with5442")
//   notes         <- "" (la nota ERA esa concatenación; no había nota real debajo)
//
// Reversible: notes = vendor + " — " + paymentMethod reconstruye el original tal cual.
// Un gasto que ya tenga vendor o paymentMethod no se toca (re-ejecutar es inocuo), y una nota sin
// separador se queda como nota.
//
// Escribe en app_data (la fuente de verdad al arrancar) y avisa de reiniciar el backend: el store
// carga expenses.json en memoria al arrancar y no relee.
//
// --apply para escribir; sin el flag solo simula.

const APPLY = process.argv.includes("--apply");

(async () => {
  const r = await pool.query("SELECT value FROM app_data WHERE key = 'expenses.json'");
  if (!r.rowCount) {
    console.error("expenses.json no está en app_data.");
    process.exit(1);
  }
  const items = r.rows[0].value;

  let cortadas = 0, saltadasConCampos = 0, sinSeparador = 0;
  const resultado = items.map((e) => {
    if (e.vendor || e.paymentMethod) { saltadasConCampos++; return e; }
    const notes = String(e.notes || "");
    const idx = notes.lastIndexOf(" — ");
    if (idx === -1) { sinSeparador++; return e; }
    cortadas++;
    return {
      ...e,
      vendor: notes.slice(0, idx).trim(),
      paymentMethod: notes.slice(idx + 3).trim(),
      notes: "",
    };
  });

  console.log(`Gastos: ${items.length}`);
  console.log(`A cortar: ${cortadas} | ya con campos (no se tocan): ${saltadasConCampos} | sin separador (la nota se queda): ${sinSeparador}`);
  console.log("\nMuestras del corte:");
  resultado.filter((e) => e.vendor).slice(0, 6).forEach((e) => {
    console.log(`  [${e.date}] vendor="${String(e.vendor).slice(0, 45)}" | metodo="${e.paymentMethod}"`);
  });

  if (!APPLY) {
    console.log("\nSimulación. Volver a lanzar con --apply para escribir.");
    await pool.end();
    return;
  }

  await pool.query(
    "UPDATE app_data SET value = $1, updated_at = now() WHERE key = 'expenses.json'",
    [JSON.stringify(resultado)]
  );
  console.log(`\nEscrito en app_data. REINICIAR el backend para que el store recargue (carga el archivo en memoria al arrancar).`);
  await pool.end();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
