require("dotenv").config();
const fs = require("fs");
const path = require("path");
const pool = require("../src/config/db");
const store = require("../src/store/statements.store");

// Carga los statements de Mygrant que todavía NO se han pagado, desde el Excel de Antonio
// ("PDF THE MYG STATEMENTS.xlsx", ya parseado a statements.json). Los que ya están en la tabla
// porque su pago los saldó no se tocan.
//
// Cada bloque del Excel es una factura (INVOICE) o un memo de crédito (CREDIT MEMO) con su
// subtotal impreso. Solo se cargan los que traen número: sin número no hay a qué llamarle.
//
// --apply para escribir; sin el flag solo simula.

const APPLY = process.argv.includes("--apply");
const ORIGEN = process.argv.find((a) => a.startsWith("--from="))?.slice(7) ||
  path.join(__dirname, "statements-mygrant.json");

// El Excel trae fechas como 5/3/26 y también como 05/03/2026.
const iso = (f) => {
  const m = String(f || "").match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (!m) return null;
  const a = m[3].length === 2 ? `20${m[3]}` : m[3];
  return `${a}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
};
// La sucursal impresa es la de Mygrant cuando dice una ciudad de Texas; "Fresno" y
// "Newport Beach" son ubicaciones de Reyes, así que ahí manda la región de la hoja.
const distribuidor = (suc, hoja) => {
  const t = String(suc || "").toLowerCase();
  if (t.includes("irving")) return "Mygrant Irving";
  if (t.includes("austin")) return "Mygrant Austin";
  if (t.includes("windcrest") || t.includes("san antonio")) return "Mygrant San Antonio";
  if (t.includes("houston")) return "Mygrant Houston";
  if (/TEXAS/i.test(hoja)) return "Mygrant San Antonio";
  if (/SOUTHER/i.test(hoja)) return "Mygrant Anaheim";
  return "Mygrant Hayward";
};

(async () => {
  if (!fs.existsSync(ORIGEN)) {
    console.error(`No encuentro ${ORIGEN}. Pásalo con --from=<ruta al statements.json>`);
    process.exit(1);
  }
  const bloques = JSON.parse(fs.readFileSync(ORIGEN, "utf8"));
  const conNumero = bloques.filter((b) => b.numero && b.subtotal != null);
  const sinNumero = bloques.length - conNumero.length;

  const yaEstan = new Set(
    (await pool.query("SELECT upper(invoice_number) n FROM distributor_statement WHERE active")).rows.map((r) => r.n)
  );
  const nuevos = conNumero.filter((b) => !yaEstan.has(b.numero.toUpperCase()));
  const repetidos = conNumero.length - nuevos.length;

  const suma = nuevos.reduce((s, b) => s + Number(b.subtotal || 0), 0);
  const facturas = nuevos.filter((b) => b.tipo !== "CREDITO");
  const memos = nuevos.filter((b) => b.tipo === "CREDITO");
  console.log(`Bloques en el archivo: ${bloques.length} (${sinNumero} sin número de factura, se omiten)`);
  console.log(`Ya registrados (su pago los saldó): ${repetidos}`);
  console.log(`A cargar como PENDIENTES: ${nuevos.length}`);
  console.log(`   ${facturas.length} facturas   $${facturas.reduce((s, b) => s + Number(b.subtotal), 0).toFixed(2)}`);
  console.log(`   ${memos.length} memos de crédito  $${memos.reduce((s, b) => s + Number(b.subtotal), 0).toFixed(2)}`);
  console.log(`   neto a deber: $${suma.toFixed(2)}`);

  if (!APPLY) { console.log("\nSimulación. Volver a lanzar con --apply para escribir."); await pool.end(); return; }

  const filas = nuevos.map((b) => ({
    invoiceNumber: b.numero,
    distributor: distribuidor(b.sucursal, b.hoja),
    branch: b.sucursal || null,
    kind: b.tipo === "CREDITO" ? "CREDIT_MEMO" : "INVOICE",
    issueDate: iso(b.fecha),
    amount: Number(b.subtotal),
    source: "excel_mygrant",
    notes: `Cargado del Excel de statements de Antonio (${b.lineas.length} renglones)`,
  }));
  const r = await store.importMany(filas, "Antonio Cano");
  console.log(`\nCreados: ${r.creados} · actualizados: ${r.actualizados} · errores: ${r.errores.length}`);
  r.errores.slice(0, 8).forEach((e) => console.log(`   ${e.fila.invoiceNumber}: ${e.error}`));

  console.log("\n--- saldo con el distribuidor:");
  console.log(JSON.stringify(await store.summary(), null, 1));
  await pool.end();
})().catch((e) => { console.error("FALLA:", e.message); process.exit(1); });
