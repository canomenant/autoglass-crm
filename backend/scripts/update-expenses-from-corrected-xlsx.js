// Actualiza los gastos de producción (app_data key "expenses.json") contra el Excel corregido
// "Base de datos EXPENSES completa (corregida) — para actualizar la web.xlsx" (Antonio, 29-ago-2026).
//
// Qué hace, cotejando por Exp-####:
//   1. Elimina los registros de la web que el Excel ya no trae (los 65 FRGN TRANS FEE, $618.19).
//      Sus números Exp-#### quedan como huecos: los ya numerados nunca se renumeran.
//   2. Aplica las correcciones de campo del Excel (categoría de Exp-0297, vendors con salto de línea).
//   3. Agrega los registros marcados "Nuevo - agregar", continuando el consecutivo (Exp-0331…).
//
// Antes de tocar nada guarda un respaldo del valor actual en backend/backups/. También reescribe
// el data/expenses.json local para que el fallback sin Postgres no quede desfasado.
//
// Uso: node scripts/update-expenses-from-corrected-xlsx.js [--dry-run] [ruta-al-xlsx]

require("dotenv").config();
const fs = require("fs");
const path = require("path");
const XLSX = require("xlsx");
const pool = require("../src/config/db");

const DRY = process.argv.includes("--dry-run");
const argPath = process.argv.slice(2).find((a) => a.endsWith(".xlsx"));

function findWorkbook() {
  if (argPath) return argPath;
  const dir = path.join(process.env.USERPROFILE || "", "OneDrive", "Documents");
  const file = fs.readdirSync(dir).find((f) => f.startsWith("Base de datos EXPENSES"));
  if (!file) throw new Error(`No encuentro el Excel en ${dir}`);
  return path.join(dir, file);
}

const str = (v) => (v == null ? "" : String(v).trim());
const serialToISO = (s) => {
  const d = XLSX.SSF.parse_date_code(s);
  return `${d.y}-${String(d.m).padStart(2, "0")}-${String(d.d).padStart(2, "0")}`;
};

function readExcel(file) {
  const wb = XLSX.readFile(file);
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: null });
  // Fila 0: resumen ("Total registros: …"); fila 1: encabezados. Datos de la 2 en adelante.
  return rows
    .slice(2)
    .filter((r) => (/^Exp-\d+$/.test(str(r[0])) || str(r[0]) === "(nuevo)") && typeof r[5] === "number")
    .map((r) => ({
      expenseNumber: str(r[0]),
      date: typeof r[1] === "number" ? serialToISO(r[1]) : str(r[1]),
      category: str(r[2]),
      vendor: str(r[3]),
      paymentMethod: str(r[4]),
      amount: r[5],
      status: str(r[6]),
    }));
}

(async () => {
  const excelFile = findWorkbook();
  const excel = readExcel(excelFile);
  const existing = excel.filter((e) => /^Exp-\d+$/.test(e.expenseNumber));
  const nuevos = excel.filter((e) => e.status === "Nuevo - agregar");
  if (existing.length + nuevos.length !== excel.length) {
    throw new Error("Hay filas del Excel que no son ni Exp-#### ni 'Nuevo - agregar' — revisar antes de seguir.");
  }

  const res = await pool.query("SELECT value FROM app_data WHERE key='expenses.json'");
  const web = res.rows[0].value;

  // Respaldo del estado actual antes de cualquier cambio.
  const backupsDir = path.join(__dirname, "..", "backups");
  fs.mkdirSync(backupsDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupFile = path.join(backupsDir, `${stamp}_expenses-pre-xlsx-corregida.json`);
  fs.writeFileSync(backupFile, JSON.stringify(web, null, 2), "utf-8");

  const keep = new Set(existing.map((e) => e.expenseNumber));
  const eliminados = web.filter((e) => !keep.has(e.expenseNumber));
  const byNum = new Map(web.map((e) => [e.expenseNumber, e]));

  let modificados = 0;
  for (const e of existing) {
    const w = byNum.get(e.expenseNumber);
    if (!w) throw new Error(`${e.expenseNumber} está en el Excel pero no en la web — cotejo inconsistente.`);
    const cambios = {};
    if (w.date !== e.date) cambios.date = e.date;
    if (w.category !== e.category) cambios.category = e.category;
    if (w.vendor !== e.vendor) cambios.vendor = e.vendor;
    if (w.paymentMethod !== e.paymentMethod) cambios.paymentMethod = e.paymentMethod;
    if (Math.abs(w.amount - e.amount) > 0.005) cambios.amount = e.amount;
    if (Object.keys(cambios).length) {
      console.log(`  ~ ${e.expenseNumber}:`, Object.keys(cambios).join(", "));
      Object.assign(w, cambios);
      modificados++;
    }
  }

  const result = web.filter((e) => keep.has(e.expenseNumber));
  let maxId = web.reduce((m, e) => Math.max(m, Number(e.id) || 0), 0);
  let maxNum = web.reduce((m, e) => {
    const match = /^Exp-(\d+)$/.exec(e.expenseNumber || "");
    return match ? Math.max(m, Number(match[1])) : m;
  }, 0);
  for (const n of nuevos) {
    result.push({
      id: ++maxId,
      expenseNumber: `Exp-${String(++maxNum).padStart(4, "0")}`,
      category: n.category,
      date: n.date,
      amount: n.amount,
      vendor: n.vendor,
      paymentMethod: n.paymentMethod,
      notes: "",
      attachments: [],
      createdAt: new Date().toISOString(),
    });
    console.log(`  + Exp-${String(maxNum).padStart(4, "0")} ${n.date} ${n.vendor} $${n.amount}`);
  }

  const total = result.reduce((a, e) => a + e.amount, 0);
  console.log(`\nEliminados: ${eliminados.length} ($${eliminados.reduce((a, e) => a + e.amount, 0).toFixed(2)})`);
  console.log(`Modificados: ${modificados}`);
  console.log(`Agregados: ${nuevos.length}`);
  console.log(`Resultado: ${result.length} registros, $${total.toFixed(2)}`);
  console.log(`Respaldo: ${backupFile}`);

  if (DRY) {
    console.log("\n--dry-run: no se escribió nada.");
  } else {
    await pool.query(
      `UPDATE app_data SET value = $1, updated_at = now() WHERE key = 'expenses.json'`,
      [JSON.stringify(result)]
    );
    // El fallback local también, para que un arranque sin Postgres no reviva los fees borrados.
    fs.writeFileSync(path.join(__dirname, "..", "data", "expenses.json"), JSON.stringify(result, null, 2), "utf-8");
    console.log("\nEscrito en app_data y en data/expenses.json.");
  }
  await pool.end();
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
