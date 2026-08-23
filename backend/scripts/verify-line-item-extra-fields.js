// Verifica que los campos traidos del export de AppSheet sobrevivan un guardado de quote.
//
//   cd backend && node scripts/verify-line-item-extra-fields.js
//
// Todo dentro de una transaccion con ROLLBACK. Existe porque normalizeLineItems reconstruye cada
// line item desde una lista blanca: una clave que no figure ahi se descarta en silencio al guardar.
// Ya paso con notes en part numbers y con publicAccessLog en work orders — mismo patron, tres veces.
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const pool = require("../src/config/db");
const { initPostgres } = require("../src/lib/initPostgres");

const EXTRA = ["priceTierAmount", "laborCharged", "servicesAmount", "servicesDescription", "calibrationAmount", "source"];
let fail = 0;
const check = (l, ok, d) => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${l}`);
  if (!ok) { fail++; if (d !== undefined) console.log("        " + JSON.stringify(d).slice(0, 200)); }
};

(async () => {
  await initPostgres();
  const client = await pool.connect();
  const realQuery = pool.query.bind(pool);
  pool.query = (...a) => client.query(...a);
  const realWrite = fs.writeFileSync;
  fs.writeFileSync = (file, ...rest) =>
    String(file).includes(path.sep + "data" + path.sep) ? undefined : realWrite(file, ...rest);

  try {
    await client.query("BEGIN");
    const quotesStore = require("../src/store/quotes.store");

    const existente = (await client.query("SELECT id FROM quotes WHERE active <> false LIMIT 1")).rows[0];
    const valores = {
      priceTierAmount: 250, laborCharged: 195.5, servicesAmount: 43.21,
      servicesDescription: "Prueba de servicio", calibrationAmount: 175, source: "appsheet_import",
    };

    // Guarda un line item con los 5 campos + source, y lo vuelve a leer desde la base.
    const guardado = await quotesStore.update(existente.id, {
      lineItems: [{ jobType: "Windshield Replacement", partNumber: "ZZ-TEST-EXTRA", pricePart: 100, ...valores }],
    });
    check("update() devuelve el line item", guardado?.lineItems?.length === 1, guardado?.lineItems?.length);

    const releido = await quotesStore.get(existente.id);
    const li = releido?.lineItems?.[0];
    check("se relee desde la base", !!li, releido?.lineItems);

    for (const campo of EXTRA) {
      check(`  sobrevive: ${campo}`, li?.[campo] === valores[campo], { esperado: valores[campo], obtenido: li?.[campo] });
    }
    check("  y los campos de siempre siguen", li?.partNumber === "ZZ-TEST-EXTRA" && Number(li?.pricePart) === 100, li);

    // Un segundo guardado sin mandar los campos: no deben perderse ni ensuciarse.
    const segundo = await quotesStore.update(existente.id, { damageNotes: "editar otra cosa" });
    const li2 = segundo?.lineItems?.[0];
    check("un guardado que no toca line items los conserva", EXTRA.every((c) => li2?.[c] === valores[c]), li2);

    // Una linea sin esos campos no explota ni inventa valores.
    const sinExtras = await quotesStore.update(existente.id, {
      lineItems: [{ jobType: "Chip Repair", partNumber: "ZZ-SIN-EXTRAS", pricePart: 50 }],
    });
    const li3 = sinExtras?.lineItems?.[0];
    check("una linea sin esos campos toma los defaults", li3?.priceTierAmount === 0 && li3?.servicesDescription === "", li3);

    await client.query("ROLLBACK");
    pool.query = realQuery;
    const tras = (await pool.query("SELECT line_items FROM quotes WHERE id = $1", [existente.id])).rows[0];
    check("la base queda intacta tras ROLLBACK", !JSON.stringify(tras.line_items).includes("ZZ-TEST-EXTRA"));
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    console.log("ERROR:", e.message);
    fail++;
  } finally {
    fs.writeFileSync = realWrite;
    client.release();
    await pool.end();
  }
  console.log(fail ? `\n${fail} FALLARON` : "\ntodo OK");
  process.exit(fail ? 1 : 0);
})();
