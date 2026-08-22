// Verifies adding a part number to the catalog from the quote form.
//
// Runs against the real catalog inside a transaction that is always rolled back, and stubs the
// data-file write, so it changes nothing. Run with:
//   cd backend && node scripts/verify-add-part-number.js
//
// The case this exists for: the duplicate guard is enforced twice — once in SQL inside the append
// statement (persistence.js#appendToAppDataArray) and once in JS (partNumbers.store.js#
// normalizePartNumber) to look up what the UI should offer instead. They are written in different
// languages against the same rule, so they can drift silently; when they do, one side offers to add
// what the other refuses. The normalization cases below pin them together.
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
    if (detail !== undefined) console.log("        " + JSON.stringify(detail));
  }
}

(async () => {
  await initPostgres();
  const client = await pool.connect();
  const realQuery = pool.query.bind(pool);
  // Every query goes through the one transactional client so ROLLBACK covers all of it.
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
    const store = require("../src/store/partNumbers.store");
    entriesBefore = store.list().length;
    // Ids are assigned MAX(id)+1, which is NOT the same as count+1: the dedupe removed 722 rows
    // without renumbering, so the catalog holds 10,403 entries whose ids run to 11,125. Asserting
    // count+1 here would demand the helper reuse an id that is still in use.
    const highestId = store.list().reduce((max, item) => Math.max(max, Number(item.id) || 0), 0);
    console.log(`catalogo: ${entriesBefore} entradas\n`);

    const unique = `ZZTEST-${Date.now()}`;
    let result = await store.create(
      { partNumber: unique, nagsDescription: "Parabrisas de prueba", notes: "pedido al distribuidor X" },
      "Antonio Cano"
    );
    const created = result.created;
    check("crea la entrada", !!created, result);
    check("  guarda nagsDescription", created?.nagsDescription === "Parabrisas de prueba", created);
    check("  guarda notes (antes se descartaba)", created?.notes === "pedido al distribuidor X", created);
    check("  registra addedBy", created?.addedBy === "Antonio Cano", created);
    check("  registra addedAt", !!created?.addedAt, created);
    check("  id asignado por Postgres, sin reusar uno vivo", created?.id === highestId + 1, { id: created?.id, esperado: highestId + 1 });
    check("  el id nuevo no colisiona", !store.list().some((i) => Number(i.id) === created?.id && i !== created), created?.id);
    check("  visible en list() sin releer", store.list().length === entriesBefore + 1);
    check("  findByPartNumber lo encuentra", store.findByPartNumber(unique)?.id === created?.id);

    // Normalization: each of these must be refused as a duplicate of `unique`, by BOTH the SQL
    // guard (which decides whether the row is written) and normalizePartNumber (which decides what
    // the UI offers instead). A disagreement shows up here as a created row or a missing existing.
    const variants = {
      "identico": unique,
      "minusculas": unique.toLowerCase(),
      "con espacios alrededor": `   ${unique}   `,
      "con espacios internos": unique.replace("-", "   "),
      "con separadores distintos": unique.replace("-", "."),
      "sin separador": unique.replace("-", ""),
      "con tab": `\t${unique}\t`,
    };
    for (const [label, variant] of Object.entries(variants)) {
      const attempt = await store.create({ partNumber: variant }, "Otro");
      check(`rechaza duplicado — ${label}`, !attempt.created, attempt.created);
      check(`  y devuelve la existente — ${label}`, attempt.duplicate?.id === created?.id, attempt.duplicate);
    }

    // Same rule against a part that was already in the catalog before this run.
    const existing = store.list().find((i) => String(i.partNumber || "").trim() && i.id !== created?.id);
    const spaced = String(existing.partNumber).replace(/(.)/, "$1  ");
    const collision = await store.create({ partNumber: ` ${spaced.toUpperCase()} ` }, "Otro");
    check("rechaza contra una pieza preexistente", !collision.created, collision.created);
    check("  identifica cual es", collision.duplicate?.id === existing.id, {
      buscado: existing.partNumber,
      devuelto: collision.duplicate?.partNumber,
    });

    let threw = null;
    try {
      await store.create({ partNumber: "   " }, "Otro");
    } catch (err) {
      threw = err;
    }
    check("rechaza part number vacio", !!threw, threw?.message);

    const writesAfterAppends = dataFileWrites;

    const updated = store.update(created.id, { notes: "nota nueva" });
    check("update() conserva notes (antes se descartaba)", updated?.notes === "nota nueva", updated);

    check("el alta no reescribe backend/data", writesAfterAppends === 0, { writesAfterAppends });
    check("update() si lo reescribe, como siempre", dataFileWrites > writesAfterAppends, { dataFileWrites });

    await client.query("ROLLBACK");
    pool.query = realQuery;
    const after = (await pool.query("SELECT jsonb_array_length(value) n FROM app_data WHERE key='partNumbers.json'")).rows[0].n;
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
