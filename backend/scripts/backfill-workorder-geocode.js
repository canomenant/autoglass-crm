require("dotenv").config();
const pool = require("../src/config/db");

// Geocodifica las direcciones de las órdenes que aún no tienen coordenadas, para el mapa.
//
// ESTE ES EL PASO DE PAGO. Cada dirección es una llamada a la API de Geocoding de Google
// ($5/1,000; medido 2026-08-27: ~4,577 órdenes sin punto => ~$23 una sola vez, y el crédito
// mensual gratuito probablemente lo cubre entero). Hacia adelante no hace falta: el autocompletado
// captura las coordenadas gratis al elegir la dirección (geocode_source = 'places').
//
// Requisitos:
//   - GOOGLE_MAPS_API_KEY en el entorno (clave de SERVIDOR; la NEXT_PUBLIC_ del frontend está
//     restringida por referer y Google la rechaza desde un script).
//   - La "Geocoding API" habilitada en ese proyecto de Google Cloud.
//
// Reglas:
//   - Sólo filas con dirección y sin latitude (NULL). Ejecutarlo dos veces no repite ni una llamada.
//   - Un fallo de una dirección no tumba el pase: se anota y se sigue. Las que Google no encuentra
//     quedan en NULL y se listan al final para revisarlas a mano.
//   - --apply para escribir; sin el flag cuenta, estima el costo y prueba UNA dirección para
//     verificar que la clave y la API funcionan antes de gastar nada.
//   - --limit=N para hacer un lote corto de prueba (p. ej. --limit=25 --apply).

const APPLY = process.argv.includes("--apply");
const LIMIT = Number((process.argv.find((a) => a.startsWith("--limit=")) || "").split("=")[1]) || null;
const KEY = process.env.GOOGLE_MAPS_API_KEY;

async function geocode(address) {
  const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${KEY}`;
  const res = await fetch(url);
  const body = await res.json();
  if (body.status === "OK" && body.results?.[0]?.geometry?.location) {
    const { lat, lng } = body.results[0].geometry.location;
    return { lat, lng };
  }
  // ZERO_RESULTS es una dirección que Google no encuentra; cualquier otro estado (REQUEST_DENIED,
  // OVER_QUERY_LIMIT...) es un problema de clave o cuota y hay que parar, no quemar 4,000 llamadas
  // fallidas.
  if (body.status !== "ZERO_RESULTS") {
    throw new Error(`Geocoding respondió ${body.status}${body.error_message ? `: ${body.error_message}` : ""}`);
  }
  return null;
}

(async () => {
  if (!KEY) {
    console.error("Falta GOOGLE_MAPS_API_KEY en el entorno (clave de servidor con la Geocoding API habilitada).");
    process.exit(1);
  }

  const r = await pool.query(
    `SELECT id, work_order_no, address FROM work_orders
      WHERE active <> false AND latitude IS NULL AND coalesce(address,'') <> ''
      ORDER BY created_at DESC ${LIMIT ? `LIMIT ${LIMIT}` : ""}`
  );
  console.log(`Órdenes sin coordenadas y con dirección: ${r.rowCount}${LIMIT ? ` (limitado a ${LIMIT})` : ""}`);
  console.log(`Costo estimado: $${((r.rowCount / 1000) * 5).toFixed(2)} (a $5/1,000 llamadas)\n`);

  if (!APPLY) {
    // Prueba de humo con una sola dirección: verifica clave y API sin gastar más que $0.005.
    const prueba = r.rows[0];
    if (prueba) {
      try {
        const p = await geocode(prueba.address);
        console.log(`Prueba con ${prueba.work_order_no}: ${p ? `OK -> ${p.lat.toFixed(5)}, ${p.lng.toFixed(5)}` : "Google no encontró la dirección"}`);
      } catch (e) {
        console.error(`Prueba FALLÓ: ${e.message}`);
        console.error("Revisar la clave y que la Geocoding API esté habilitada antes de --apply.");
        await pool.end();
        process.exit(1);
      }
    }
    console.log("\nSimulación. Volver a lanzar con --apply para escribir (y --limit=N para un lote corto).");
    await pool.end();
    return;
  }

  let ok = 0;
  const sinResultado = [];
  for (const row of r.rows) {
    let punto;
    try {
      punto = await geocode(row.address);
    } catch (e) {
      console.error(`\nPARADO en ${row.work_order_no}: ${e.message}`);
      console.error(`Progreso hasta aquí: ${ok} escritas. Relanzar continúa donde quedó (sólo procesa filas en NULL).`);
      await pool.end();
      process.exit(1);
    }
    if (!punto) {
      sinResultado.push(`${row.work_order_no}: ${row.address}`);
      continue;
    }
    await pool.query(
      `UPDATE work_orders SET latitude = $2, longitude = $3, geocode_source = 'geocode', updated_at = now() WHERE id = $1`,
      [row.id, punto.lat, punto.lng]
    );
    ok++;
    if (ok % 200 === 0) console.log(`  ${ok} de ${r.rowCount}...`);
  }

  console.log(`\nEscritas: ${ok}. Sin resultado de Google: ${sinResultado.length}.`);
  if (sinResultado.length) {
    console.log("Direcciones que Google no encontró (quedan en NULL, revisar a mano):");
    sinResultado.slice(0, 30).forEach((s) => console.log("  " + s));
    if (sinResultado.length > 30) console.log(`  ... y ${sinResultado.length - 30} más`);
  }
  await pool.end();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
