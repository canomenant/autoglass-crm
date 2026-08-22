// Verifies adding a vehicle to the catalog from the quote form, and the cascade that decides
// whether the form should offer to add one at all.
//
// Runs against the real catalog inside a transaction that is always rolled back, and stubs the
// data-file write, so it changes nothing. Run with:
//   cd backend && node scripts/verify-add-vehicle.js
//
// The case this exists for is the same one verify-add-part-number.js covers: the duplicate guard
// is enforced twice, once in SQL inside the append (persistence.js#appendToAppDataArray) and once
// in JS (vehicleTypes.store.js#normalizeVehicleKey) to find what the UI should offer instead.
// Written in two languages against one rule, they can drift silently. Here the key is a
// combination — year + make + model + body type — so there is more of it to drift.
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const pool = require("../src/config/db");
const { initPostgres } = require("../src/lib/initPostgres");

const realWriteFileSync = fs.writeFileSync;
let dataFileWrites = 0;
let failures = 0;

function check(label, ok, detail) {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}`);
  if (!ok) {
    failures++;
    if (detail !== undefined) console.log("        " + JSON.stringify(detail).slice(0, 240));
  }
}

(async () => {
  await initPostgres();
  const client = await pool.connect();
  const realQuery = pool.query.bind(pool);
  pool.query = (...args) => client.query(...args);
  fs.writeFileSync = (file, ...rest) => {
    if (String(file).includes(path.sep + "data" + path.sep)) {
      dataFileWrites++;
      return undefined;
    }
    return realWriteFileSync(file, ...rest);
  };

  let entriesBefore = 0;
  try {
    await client.query("BEGIN");
    const store = require("../src/store/vehicleTypes.store");
    entriesBefore = store.list().length;
    const highestId = store.list().reduce((max, i) => Math.max(max, Number(i.id) || 0), 0);
    console.log(`catalogo: ${entriesBefore} entradas, id maximo ${highestId}\n`);

    console.log("--- cascada ---");
    const years = store.years();
    check("years() viene ordenado descendente", years[0] > years[years.length - 1], years.slice(0, 3));
    check("  incluye 2026 y 1990", years.includes(2026) && years.includes(1990));

    const makes2025 = store.makes(2025);
    const makes1995 = store.makes(1995);
    check("makes(2025) y makes(1995) difieren", makes2025.length !== makes1995.length, { m2025: makes2025.length, m1995: makes1995.length });
    check("  Tesla esta en 2025", makes2025.some((m) => /tesla/i.test(m)));
    check("  Tesla NO esta en 1995", !makes1995.some((m) => /tesla/i.test(m)));
    check("makes() de un anio inexistente es vacio", store.makes(1800).length === 0);

    check("models() filtra por anio", JSON.stringify(store.models(2025, "Toyota")) !== JSON.stringify(store.models(1995, "Toyota")));
    check("  la marca se normaliza", JSON.stringify(store.models(2025, "toyota")) === JSON.stringify(store.models(2025, "TOYOTA")));
    check("  marca inexistente devuelve vacio", store.models(2025, "Marca Que No Existe").length === 0);

    const camry = store.bodyTypes(2025, "Toyota", "Camry");
    check("bodyTypes exacto: Camry 2025 -> Sedan", camry.source === "exact" && camry.bodyTypes.includes("Sedan"), camry);
    const odyssey = store.bodyTypes(2024, "Honda", "Odyssey");
    check("  Odyssey -> Minivan, no Van", odyssey.bodyTypes.includes("Minivan") && !odyssey.bodyTypes.includes("Van"), odyssey);
    const tacoma = store.bodyTypes(2025, "Toyota", "Tacoma");
    check("  Tacoma 2025 hereda Pickup del modelo", tacoma.source === "model" && tacoma.bodyTypes.includes("Pickup"), tacoma);
    const unknown = store.bodyTypes(2025, "Marca Inventada", "Modelo Inventado");
    check("  desconocido devuelve la taxonomia completa", unknown.source === "taxonomy" && unknown.bodyTypes.length === store.BODY_TYPES.length, unknown);

    console.log("\n--- alta ---");
    const vehicle = { year: 2026, make: `ZZTest-${Date.now()}`, model: "Prueba", bodyType: "Sedan" };
    let result = await store.create(vehicle, "Richard Salgado");
    const created = result.created;
    check("crea la entrada", !!created, result);
    check("  year queda como NUMERO, no string", typeof created?.year === "number" && created.year === 2026, { year: created?.year, tipo: typeof created?.year });
    check("  registra addedBy", created?.addedBy === "Richard Salgado", created);
    check("  registra addedAt", !!created?.addedAt, created);
    check("  id = maximo vivo + 1", created?.id === highestId + 1, { id: created?.id, esperado: highestId + 1 });
    check("  aparece en la cascada sin releer", store.makes(2026).includes(vehicle.make), store.makes(2026).slice(-3));
    check("  y en models()", store.models(2026, vehicle.make).includes("Prueba"));
    check("  y en bodyTypes() como exacto", store.bodyTypes(2026, vehicle.make, "Prueba").source === "exact");

    console.log("\n--- guard de duplicado sobre la combinacion ---");
    const variants = {
      identico: { ...vehicle },
      "otra capitalizacion": { ...vehicle, make: vehicle.make.toLowerCase(), model: "PRUEBA" },
      "espacios alrededor": { ...vehicle, make: `  ${vehicle.make}  `, model: " Prueba " },
      "anio como string": { ...vehicle, year: "2026" },
    };
    for (const [label, v] of Object.entries(variants)) {
      const attempt = await store.create(v, "Otro");
      check(`rechaza — ${label}`, !attempt.created, attempt.created);
      check(`  devuelve la existente — ${label}`, attempt.duplicate?.id === created?.id, attempt.duplicate);
    }

    console.log("\n--- lo que NO es duplicado ---");
    const other = await store.create({ ...vehicle, bodyType: "Coupe" }, "Otro");
    check("otro body type es una entrada distinta", !!other.created && other.created.id !== created.id, other);
    const otherYear = await store.create({ ...vehicle, year: 2025 }, "Otro");
    check("otro anio es una entrada distinta", !!otherYear.created, otherYear);

    console.log("\n--- validacion ---");
    for (const [label, bad] of Object.entries({
      "sin marca": { ...vehicle, make: "  " },
      "sin modelo": { ...vehicle, model: "" },
      "anio no numerico": { ...vehicle, year: "abcd" },
      "body type inventado": { ...vehicle, make: `ZZOtro-${Date.now()}`, bodyType: "Nave Espacial" },
    })) {
      let threw = null;
      try {
        await store.create(bad, "Otro");
      } catch (err) {
        threw = err;
      }
      check(`rechaza ${label}`, !!threw, threw?.message);
    }

    const writesAfterAppends = dataFileWrites;
    check("el alta no reescribe backend/data", writesAfterAppends === 0, { writesAfterAppends });

    await client.query("ROLLBACK");
    pool.query = realQuery;
    const after = (await pool.query("SELECT jsonb_array_length(value) n FROM app_data WHERE key='vehicleTypes.json'")).rows[0].n;
    check(`la base queda intacta tras ROLLBACK (${after})`, Number(after) === entriesBefore, { after, entriesBefore });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    console.log("ERROR:", err.message);
    console.log(err.stack);
    failures++;
  } finally {
    fs.writeFileSync = realWriteFileSync;
    client.release();
    await pool.end();
  }

  console.log(failures ? `\n${failures} FALLARON` : "\ntodo OK");
  process.exit(failures ? 1 : 0);
})();
