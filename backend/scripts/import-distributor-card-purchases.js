// Importa a `payouts` las compras de vidrio a proveedores que faltaban en la web, desde el Excel
// "Pendientes de captura en la web (compras a proveedores sin Dist).xlsx" (Antonio, 29-ago-2026).
//
// Mismo patrón que import-agent-paypal-pendientes.js: cada cargo de tarjeta entra como lote
// DISTRIBUTOR adhoc (sin obligaciones), status Paid — el dinero ya salió; las work orders y sus
// partes se vinculan después desde el panel del pago ("+ Vincular work orders"), que es donde se
// sabrá de qué BODEGA salió cada parte.
//
// Decisiones (Antonio, 29-ago-2026):
//   - Mygrant #011, Pilkington y PGW quedan ABIERTOS: sin sucursal fija. distributor_id va null
//     como en los 254 lotes existentes ("a quién se le pagó sale de las obligaciones"); el
//     comercio del estado de cuenta queda en la nota.
//   - La fila del 22-jun "merchandise return — Pilkington Na" (-$642.80) NO se importa: es una
//     devolución y Antonio la maneja aparte.
//   - Métodos de pago normalizados a los ya usados en lotes de distribuidor:
//     "Business Credit Card ...ending with 0533", "Chase", "Capital One --####".
//
// Uso: node scripts/import-distributor-card-purchases.js [--dry-run]

require("dotenv").config();
const fs = require("fs");
const path = require("path");
const XLSX = require("xlsx");
const pool = require("../src/config/db");

const DRY = process.argv.includes("--dry-run");
const XLSX_PATH = "C:/Users/Antonio Cano/OneDrive/Documents/Pendientes de captura en la web (compras a proveedores sin Dist).xlsx";
const USER = "Import compras proveedores";

const METODO = {
  "Business Credit Card ...ending with0533": "Business Credit Card ...ending with 0533",
  "CHASE": "Chase",
  "CAPITAL ONE 9205": "Capital One --9205",
  "CAPITAL ONE": "Capital One",
};

const serialToISO = (s) => {
  const d = XLSX.SSF.parse_date_code(s);
  return `${d.y}-${String(d.m).padStart(2, "0")}-${String(d.d).padStart(2, "0")}`;
};
// Los comercios vienen del estado de cuenta, algunos con saltos de línea ("purchase\r\nPgwautoglass").
const limpia = (v) => String(v == null ? "" : v).replace(/\s+/g, " ").trim();

function readCompras() {
  const wb = XLSX.readFile(XLSX_PATH);
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: null });
  // Filas 0-3: título y resumen; 4: encabezados. Datos de la 5 en adelante.
  const data = rows.slice(5).filter((r) => typeof r[0] === "number").map((r, i) => ({
    filePos: i,
    date: serialToISO(r[0]),
    merchant: limpia(r[2]),
    amount: Math.round(Math.abs(Number(r[3])) * 100) / 100,
    metodo: METODO[limpia(r[4])] || limpia(r[4]),
    esDevolucion: /merchandise return/i.test(limpia(r[2])),
  }));
  for (const c of data) {
    if (!(c.amount > 0)) throw new Error(`Monto inválido en ${c.date} ${c.merchant}: ${c.amount}`);
    if (!c.merchant) throw new Error(`Comercio vacío en fila del ${c.date}`);
  }
  return data;
}

(async () => {
  const todas = readCompras();
  const devoluciones = todas.filter((c) => c.esDevolucion);
  const compras = todas
    .filter((c) => !c.esDevolucion)
    .sort((a, b) => a.date.localeCompare(b.date) || a.filePos - b.filePos);
  console.log(`Compras a importar: ${compras.length}, $${compras.reduce((a, c) => a + c.amount, 0).toFixed(2)}`);
  console.log(`Excluidas (devolución): ${devoluciones.length}`, devoluciones.map((d) => `${d.date} ${d.merchant} $${d.amount}`));

  // Respaldo de los lotes de distribuidor antes de tocar nada.
  const existentes = await pool.query("SELECT * FROM payouts WHERE type='DISTRIBUTOR' ORDER BY id");
  const backupsDir = path.join(__dirname, "..", "backups");
  fs.mkdirSync(backupsDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupFile = path.join(backupsDir, `${stamp}_payouts-distributor-pre-card-import.json`);
  fs.writeFileSync(backupFile, JSON.stringify(existentes.rows, null, 2), "utf-8");
  console.log(`Respaldo (${existentes.rows.length} lotes): ${backupFile}`);

  // Idempotencia: la serie debe ir en Dist-0254 (el máximo NO es el último por id: Dist-0254 es
  // un lote de enero con id 287) y no debe haber lotes del import previo.
  const maxNum = existentes.rows.reduce((m, r) => {
    const match = /^Dist-(\d+)$/.exec(r.payment_number || "");
    return match ? Math.max(m, Number(match[1])) : m;
  }, 0);
  const yaImportados = existentes.rows.filter((r) => /WOs por vincular/.test(r.notes || ""));
  if (maxNum !== 254 || yaImportados.length) {
    throw new Error(`La serie va en Dist-${String(maxNum).padStart(4, "0")} y hay ${yaImportados.length} lotes con "WOs por vincular" — este import parece ya aplicado.`);
  }

  let id = (await pool.query("SELECT COALESCE(MAX(id),0) m FROM payouts")).rows[0].m;
  let n = maxNum;
  const now = new Date().toISOString();

  for (const c of compras) {
    const num = `Dist-${String(++n).padStart(4, "0")}`;
    const notes = `Compra tarjeta — ${c.merchant} | WOs por vincular`;
    const auditLog = [
      { user: USER, timestamp: now, action: "Created", oldValue: null, newValue: { status: "Paid", source: "Pendientes de captura (compras a proveedores).xlsx", workOrderCount: 0 } },
    ];
    const transactions = [
      { id: 1, transactionReference: "", paymentGateway: "Manual", paymentMethod: c.metodo, amount: c.amount, date: c.date },
    ];
    console.log(`  + ${num} ${c.date} $${c.amount} ${c.merchant}`);
    if (DRY) continue;
    await pool.query(
      `INSERT INTO payouts (id, payment_number, type, status, payment_method, payment_date, notes,
         work_order_ids, is_adhoc, base_amount, bonus, deductions, net_amount, tax_amount,
         subtotal, total_amount, gross_amount, commission_amount, credit_notes_total, debit_notes_total,
         transactions, audit_log, active, created_by, updated_by, created_at, updated_at,
         cash_advance, parts_deduction, parts_return, public_access_log)
       VALUES ($1,$2,'DISTRIBUTOR','Paid',$3,$4,$5,'[]',true,0,0,0,0,0,$6,$6,0,0,0,0,$7,$8,true,
         $9,$9,$10,$10,0,0,0,'[]')`,
      [++id, num, c.metodo, c.date, notes, c.amount, JSON.stringify(transactions), JSON.stringify(auditLog), USER, now]
    );
  }

  if (DRY) {
    console.log("\n--dry-run: no se escribió nada.");
  } else {
    const check = await pool.query(
      `SELECT count(*) n, round(sum(total_amount)::numeric,2) s FROM payouts
        WHERE type='DISTRIBUTOR' AND notes LIKE '%WOs por vincular%'`);
    console.log(`\nImportados: ${check.rows[0].n} lotes, $${check.rows[0].s} (esperado: ${compras.length}, $${compras.reduce((a, c) => a + c.amount, 0).toFixed(2)})`);
  }
  await pool.end();
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
