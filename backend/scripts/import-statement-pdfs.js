require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { parseFiles } = require("../src/lib/statementParser");
const { cruzar } = require("../src/lib/statementMatch");
const store = require("../src/store/statements.store");
const pool = require("../src/config/db");

// Sube el DETALLE de statements que ya existen como cabecera, desde los PDF de Mygrant.
//
// Es el mismo camino que "Add statements" en la app —parsear, cruzar contra las órdenes,
// importar— pero desde la terminal, para cargar de golpe los que llegaron del resumen anual sin
// renglones. Se apoya en las mismas dos piezas que usa la ruta, no en una copia: si el cruce
// cambia, cambia aquí también.
//
// Lo único que hace distinto que la pantalla: conserva la nota que el statement ya traía en vez
// de pisarla. Un statement cargado del resumen dice de dónde salió, y esa procedencia importa.
//
//   node scripts/import-statement-pdfs.js --dir=<carpeta> [--apply]
//
// Sin --apply solo enseña qué entraría. Reimportar es inofensivo: los renglones se reescriben.

const APPLY = process.argv.includes("--apply");
const DIR = process.argv.find((a) => a.startsWith("--dir="))?.slice(6);
const SOLO = process.argv.find((a) => a.startsWith("--files="))?.slice(8)?.split(",");

const money = (n) => `$${Number(n || 0).toFixed(2)}`;

(async () => {
  if (!DIR || !fs.existsSync(DIR)) {
    console.error("Pasa la carpeta con los PDF: --dir=<ruta>");
    process.exit(1);
  }
  const nombres = (SOLO || fs.readdirSync(DIR)).filter((n) => /\.(pdf|xlsx?|csv)$/i.test(n));
  if (!nombres.length) { console.error(`Sin archivos que leer en ${DIR}`); process.exit(1); }
  console.log(`Leyendo ${nombres.length} archivo(s) de ${DIR}\n`);

  const r = await parseFiles(nombres.map((n) => ({
    fileName: n, base64: fs.readFileSync(path.join(DIR, n)).toString("base64"),
  })));
  if (!r.blocks.length) { console.error("No se encontró ningún statement"); process.exit(1); }
  await cruzar(r.blocks);

  // La nota previa se conserva: sin esto, cargar el detalle borraría de dónde salió la cabecera.
  const previos = new Map(
    (await pool.query(
      `SELECT upper(invoice_number) n, notes, amount, status, distributor, branch FROM distributor_statement
        WHERE active AND upper(invoice_number) = ANY($1)`,
      [r.blocks.map((b) => String(b.invoiceNumber || "").toUpperCase())]
    )).rows.map((x) => [x.n, x])
  );

  const filas = [];
  for (const b of r.blocks) {
    if (!b.invoiceNumber) { console.log("  (bloque sin número de factura, se omite)"); continue; }
    const previo = previos.get(b.invoiceNumber.toUpperCase());
    // Con signo, como vienen: un memo de crédito trae recargos positivos entre renglones negativos,
    // y sumarlos en absoluto hacía ver un descuadre donde no lo hay.
    const suma = b.lines.reduce((s, l) => s + Number(l.amount || 0), 0);
    const desc = previo ? Number(b.amount) - Number(previo.amount) : null;
    const sello = `Detalle cargado del PDF (${new Date().toISOString().slice(0, 10)})`;

    console.log(
      `${b.invoiceNumber}  ${b.kind}  ${b.issueDate}  ${b.distributor} / ${b.branch}\n` +
      `   ${b.lines.length} renglones suman ${money(suma)} | cabecera ${money(b.amount)}` +
      `${previo ? ` | en base ${money(previo.amount)} [${previo.status}] dif ${money(desc)}` : " | NUEVO"}\n` +
      `   ${JSON.stringify(b.match)}`
    );

    filas.push({
      invoiceNumber: b.invoiceNumber,
      distributor: b.distributor,
      branch: b.branch,
      kind: b.kind,
      issueDate: b.issueDate,
      amount: b.amount,
      source: `upload:${b.fileName || "pdf"}`,
      notes: previo?.notes ? `${previo.notes} | ${sello}` : sello,
      lines: b.lines.map((l) => ({
        reqNo: l.reqNo, date: l.date, qty: l.qty, partNumber: l.partNumber, amount: l.amount,
        customerName: l.customerName, workOrderNo: l.workOrderNo,
        classification: l.classification, matchSource: l.matchSource, relatedRef: l.relatedRef,
      })),
    });
  }

  const tot = filas.reduce((a, f) => ({
    renglones: a.renglones + f.lines.length,
    conOrden: a.conOrden + f.lines.filter((l) => l.workOrderNo).length,
    porDecidir: a.porDecidir + f.lines.filter((l) => l.classification === "UNDECIDED").length,
  }), { renglones: 0, conOrden: 0, porDecidir: 0 });
  console.log(`\n${filas.length} statements | ${tot.renglones} renglones | ${tot.conOrden} con orden | ${tot.porDecidir} por decidir`);

  if (!APPLY) { console.log("\nSIMULACIÓN. Vuelve a correr con --apply para escribir."); await pool.end(); return; }

  const res = await store.importMany(filas, "import-statement-pdfs");
  console.log(`\nEscrito: ${res.creados} creados, ${res.actualizados} actualizados, ${res.renglones} renglones`);
  if (res.errores.length) console.log("Errores:", JSON.stringify(res.errores, null, 2));
  await pool.end();
})().catch((e) => { console.error(e); process.exit(1); });
