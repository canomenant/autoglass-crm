require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
// Piezas del catálogo cuya descripción NAGS es literalmente la palabra "NULL" — una importación
// escribió el texto en vez de dejar el campo vacío. Se ve en la orden, en la cotización y en el
// comprobante del técnico, y no hay descripción que recuperar: se dejan en blanco (Antonio,
// 9-sep-2026).
//
// Escribe DIRECTO a app_data con SQL y NO toca el archivo local ni pasa por el store. Es la regla
// del proyecto para catálogos: un script suelto que llama a store.save() escribe solo el archivo,
// porque persistence.save() espeja a app_data únicamente si el caché de Postgres está cargado, y
// eso pasa al arrancar el servidor. Producción lee app_data.
//
// IMPORTANTE: el backend cachea app_data en memoria al arrancar y loadOrSeed() entrega el array POR
// REFERENCIA. Un proceso vivo se queda con la copia anterior y la siguiente edición del catálogo la
// escribiría entera, deshaciendo esto. Hay que REDESPLEGAR (push a main) justo después de aplicar.
//
//   node scripts/clean-null-catalog-descriptions.js          -> reporte
//   node scripts/clean-null-catalog-descriptions.js --apply  -> escribe
const fs = require("fs");
const path = require("path");
const pool = require("../src/config/db");

const APPLY = process.argv.includes("--apply");
const CLAVE = "partNumbers.json";
const esNull = (s) => ["NULL", "null"].includes(String(s == null ? "" : s).trim());

(async () => {
  const r = await pool.query("SELECT value FROM app_data WHERE key = $1", [CLAVE]);
  if (!r.rows[0]) throw new Error(`No existe ${CLAVE} en app_data`);
  const catalogo = r.rows[0].value;
  if (!Array.isArray(catalogo)) throw new Error("El catálogo no es un arreglo");

  const malas = catalogo.filter((p) => esNull(p.nagsDescription));
  console.log(APPLY ? "APLICANDO" : "SOLO PRUEBA (usa --apply para escribir)");
  console.log("Piezas en el catálogo:", catalogo.length, "| con descripción \"NULL\":", malas.length);
  console.table(malas.slice(0, 10).map((p) => ({ id: p.id, parte: p.partNumber, descripcion: p.nagsDescription })));
  if (malas.length > 10) console.log("… y", malas.length - 10, "más");
  if (!APPLY || !malas.length) { await pool.end(); return; }

  const respaldo = path.join(__dirname, `null-catalog-backup-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  fs.writeFileSync(respaldo, JSON.stringify(malas, null, 2));
  console.log("Respaldo de las entradas tal como estaban:", respaldo);

  // Solo se toca nagsDescription de las afectadas; el resto del catálogo viaja idéntico, y el
  // orden se conserva (el id de una pieza sale de su posición en el arreglo).
  const nuevo = catalogo.map((p) => (esNull(p.nagsDescription) ? { ...p, nagsDescription: "" } : p));
  if (nuevo.length !== catalogo.length) throw new Error("Cambió el número de piezas: abortado");

  await pool.query("UPDATE app_data SET value = $2::jsonb, updated_at = now() WHERE key = $1", [CLAVE, JSON.stringify(nuevo)]);

  const v = await pool.query("SELECT value FROM app_data WHERE key = $1", [CLAVE]);
  const quedan = v.rows[0].value.filter((p) => esNull(p.nagsDescription)).length;
  console.log("Piezas limpiadas:", malas.length, "| quedan con \"NULL\":", quedan, "| total en el catálogo:", v.rows[0].value.length);
  console.log("\nREDESPLIEGA AHORA (push a main): el backend vivo todavía tiene la copia anterior en memoria.");
  await pool.end();
})().catch((e) => { console.error(e); process.exit(1); });
