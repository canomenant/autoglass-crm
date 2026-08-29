// Importa a `payouts` los pagos de agente PayPal que faltaban en la web, desde el Excel
// "pagos de agentes updates.xlsx" de Antonio (29-ago-2026), y corrige 5 fechas de lotes existentes.
//
// El Excel cruza los pagos PayPal reales de 2026 contra la captura: 54 traen su Agent-# (49 cuadran
// al centavo, 5 solo difieren en fecha) y 73 están "Pendiente" — pagos ya hechos que la web no
// tiene ($15,019.92). Esos 73 entran como lotes ADHOC (sin obligaciones): el dinero ya salió, pero
// las work orders de cada pago aún no están capturadas. La nota de cada lote termina en
// "WOs por vincular" — ese es el marcador para encontrarlos cuando toque la vinculación, que se
// hará por script sobre payable.payout_id (igual que la migración de AppSheet).
//
// Decisiones (Antonio, 29-ago-2026):
//   - Numeración: continúa la serie histórica Agent-#### (0252…0324) en orden cronológico, aunque
//     el flujo del app numere PA-#### — el Excel y AppSheet hablan en Agent-#.
//   - "Ricardo/Richard Salgado" del Excel ES Richard Salgado (cat_agent id 2); no hay dos personas.
//   - El fee de PayPal (incl. FRGN estimado de DigiClique) va en la nota del lote, NO en expenses:
//     los FRGN TRANS FEE se sacaron de expenses hoy mismo justamente porque se contabilizan aquí.
//   - Los 6 lotes 2026 que el Excel no reconoce (Agent-0076/0185/0192/0241/0248/0251) NO se tocan.
//
// Uso: node scripts/import-agent-paypal-pendientes.js [--dry-run]

require("dotenv").config();
const fs = require("fs");
const path = require("path");
const XLSX = require("xlsx");
const pool = require("../src/config/db");

const DRY = process.argv.includes("--dry-run");
const XLSX_PATH = "C:/Users/Antonio Cano/OneDrive/Documents/pagos de agentes updates.xlsx";
const USER = "Import Excel PayPal";

// company / agent_id como existen hoy en payouts y cat_agent. primary_agent de DigiClique queda
// NULL a propósito: a quién acredita cada pago se sabrá cuando se vinculen sus work orders.
const BENEF = {
  "Jose Reyes": { company: "Jose Reyes", agentId: 7, primaryAgent: "Jose Reyes" },
  "Ricardo/Richard Salgado": { company: "Richard Salgado", agentId: 2, primaryAgent: "Richard Salgado" },
  "Edgar Medina": { company: "Edgar Medina", agentId: 6, primaryAgent: "Edgar Medina" },
  "DigiClique": { company: "Digiclique Digital Marketing Services", agentId: 5, primaryAgent: null },
};

// Fechas reales de PayPal para lotes ya capturados cuyo monto cuadra pero la fecha no.
const FECHAS_CORREGIDAS = {
  "Agent-0191": "2026-03-24",
  "Agent-0211": "2026-04-22",
  "Agent-0244": "2026-04-17",
  "Agent-0245": "2026-04-18",
  "Agent-0249": "2026-04-02",
};

const serialToISO = (s) => {
  const d = XLSX.SSF.parse_date_code(s);
  return `${d.y}-${String(d.m).padStart(2, "0")}-${String(d.d).padStart(2, "0")}`;
};

function readPendientes() {
  const wb = XLSX.readFile(XLSX_PATH);
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: null });
  // Filas 0-8: resumen por beneficiario; 9-10: título y encabezados del detalle.
  const detalle = rows.slice(11).filter((r) => typeof r[0] === "number");
  const pendientes = detalle
    .filter((r) => r[5] === "Pendiente" && !r[6])
    .map((r, i) => ({
      filePos: i,
      date: serialToISO(r[0]),
      benef: r[1],
      gross: Number(r[2]),
      fee: Number(r[3] || 0),
      frgn: r[7] == null ? null : Number(r[7]),
      metodo: String(r[8] || ""),
    }));
  for (const p of pendientes) {
    if (!BENEF[p.benef]) throw new Error(`Beneficiario desconocido: ${p.benef}`);
    if (!(p.gross > 0)) throw new Error(`Monto inválido en pendiente del ${p.date} (${p.benef}): ${p.gross}`);
  }
  return pendientes;
}

(async () => {
  const pendientes = readPendientes()
    .sort((a, b) => a.date.localeCompare(b.date) || a.filePos - b.filePos);
  console.log(`Pendientes en el Excel: ${pendientes.length}, $${pendientes.reduce((a, p) => a + p.gross, 0).toFixed(2)}`);

  // Respaldo de todos los lotes de agente antes de tocar nada.
  const agentes = await pool.query("SELECT * FROM payouts WHERE type='AGENT' ORDER BY id");
  const backupsDir = path.join(__dirname, "..", "backups");
  fs.mkdirSync(backupsDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupFile = path.join(backupsDir, `${stamp}_payouts-agent-pre-paypal-import.json`);
  fs.writeFileSync(backupFile, JSON.stringify(agentes.rows, null, 2), "utf-8");
  console.log(`Respaldo (${agentes.rows.length} lotes): ${backupFile}`);

  // Guardas de idempotencia: si la serie ya pasó de 0251 o el marcador ya existe, esto ya corrió.
  const maxNum = agentes.rows.reduce((m, r) => {
    const match = /^Agent-(\d+)$/.exec(r.payment_number || "");
    return match ? Math.max(m, Number(match[1])) : m;
  }, 0);
  const yaImportados = agentes.rows.filter((r) => /WOs por vincular/.test(r.notes || ""));
  if (maxNum !== 251 || yaImportados.length) {
    throw new Error(`La serie va en Agent-${String(maxNum).padStart(4, "0")} y hay ${yaImportados.length} lotes con "WOs por vincular" — este import parece ya aplicado.`);
  }

  // commission_type/rate del catálogo vigente por agente (mismo dato que usaría create()).
  const rates = {};
  for (const { agentId, company } of Object.values(BENEF)) {
    const last = agentes.rows.filter((r) => r.company === company && r.commission_type).slice(-1)[0];
    rates[agentId] = { type: last?.commission_type || "Percentage", rate: last?.commission_rate ?? 0 };
  }

  let id = (await pool.query("SELECT COALESCE(MAX(id),0) m FROM payouts")).rows[0].m;
  let n = maxNum;
  const now = new Date().toISOString();

  for (const p of pendientes) {
    const b = BENEF[p.benef];
    const num = `Agent-${String(++n).padStart(4, "0")}`;
    const feeParts = [`fee PayPal $${p.fee.toFixed(2)}`];
    if (p.frgn) feeParts.push(`FRGN estim. $${p.frgn.toFixed(2)}`);
    const notes = `Pago PayPal (${p.metodo}) — ${feeParts.join(", ")} | WOs por vincular`;
    const amount = Math.round(p.gross * 100) / 100;
    const auditLog = [
      { user: USER, timestamp: now, action: "Created", oldValue: null, newValue: { status: "Paid", source: "pagos de agentes updates.xlsx", workOrderCount: 0 } },
    ];
    const transactions = [
      { id: 1, transactionReference: "", paymentGateway: "Manual", paymentMethod: "PayPal", amount, date: p.date },
    ];
    console.log(`  + ${num} ${p.date} ${b.company} $${amount}${p.frgn ? " (FRGN)" : ""}`);
    if (DRY) continue;
    await pool.query(
      `INSERT INTO payouts (id, payment_number, type, status, payment_method, payment_date, notes,
         work_order_ids, is_adhoc, agent_id, base_amount, bonus, deductions, net_amount, tax_amount,
         subtotal, total_amount, commission_type, commission_rate, gross_amount, commission_amount,
         credit_notes_total, debit_notes_total, transactions, audit_log, active, created_by, updated_by,
         created_at, updated_at, cash_advance, parts_deduction, parts_return, company, primary_agent,
         public_access_log)
       VALUES ($1,$2,'AGENT','Paid','PayPal',$3,$4,'[]',true,$5,0,0,0,0,0,0,0,$6,$7,$8,$8,0,0,$9,$10,true,
         $11,$11,$12,$12,0,0,0,$13,$14,'[]')`,
      [++id, num, p.date, notes, b.agentId, rates[b.agentId].type, rates[b.agentId].rate, amount,
       JSON.stringify(transactions), JSON.stringify(auditLog), USER, now, b.company, b.primaryAgent]
    );
  }

  console.log(`\nCorrección de fechas (${Object.keys(FECHAS_CORREGIDAS).length} lotes):`);
  for (const [num, fecha] of Object.entries(FECHAS_CORREGIDAS)) {
    const actual = agentes.rows.find((r) => r.payment_number === num);
    if (!actual) throw new Error(`${num} no existe`);
    console.log(`  ~ ${num}: ${actual.payment_date} → ${fecha}`);
    if (DRY) continue;
    await pool.query(
      `UPDATE payouts SET payment_date = $2, updated_by = $3, updated_at = now(),
         audit_log = audit_log || $4::jsonb
       WHERE payment_number = $1 AND type='AGENT'`,
      [num, fecha, USER, JSON.stringify([{ user: USER, timestamp: now, action: "Updated", oldValue: { paymentDate: actual.payment_date }, newValue: { paymentDate: fecha, reason: "fecha real PayPal (Excel 29-ago-2026)" } }])]
    );
  }

  if (DRY) {
    console.log("\n--dry-run: no se escribió nada.");
  } else {
    const check = await pool.query(
      `SELECT company, count(*) FILTER (WHERE notes LIKE '%WOs por vincular%') nuevos,
              round(sum(commission_amount) FILTER (WHERE notes LIKE '%WOs por vincular%')::numeric, 2) suma
       FROM payouts WHERE type='AGENT' GROUP BY company ORDER BY company`);
    console.table(check.rows);
    const tot = await pool.query(
      `SELECT count(*) n, round(sum(commission_amount)::numeric,2) s FROM payouts WHERE type='AGENT' AND notes LIKE '%WOs por vincular%'`);
    console.log(`Importados: ${tot.rows[0].n} lotes, $${tot.rows[0].s} (esperado: 73, $15019.92)`);
  }
  await pool.end();
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
