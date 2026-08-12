require("dotenv").config();
const fs = require("fs");
const path = require("path");
const pool = require("../src/config/db");

const CREATE_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS payouts (
    id INTEGER PRIMARY KEY,
    payment_number TEXT,
    type TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'Pending',
    payment_method TEXT,
    payment_date TEXT,
    notes TEXT,
    work_order_ids JSONB DEFAULT '[]',
    is_adhoc BOOLEAN DEFAULT false,
    technician_id INTEGER,
    agent_id INTEGER,
    distributor_id INTEGER,
    base_amount NUMERIC DEFAULT 0,
    bonus NUMERIC DEFAULT 0,
    deductions NUMERIC DEFAULT 0,
    net_amount NUMERIC DEFAULT 0,
    invoice_number TEXT,
    po_number TEXT,
    part_number TEXT,
    invoice_date TEXT,
    due_date TEXT,
    tax_amount NUMERIC DEFAULT 0,
    subtotal NUMERIC DEFAULT 0,
    total_amount NUMERIC DEFAULT 0,
    attachment JSONB,
    commission_type TEXT,
    commission_rate NUMERIC DEFAULT 0,
    gross_amount NUMERIC DEFAULT 0,
    commission_amount NUMERIC DEFAULT 0,
    credit_notes_total NUMERIC DEFAULT 0,
    debit_notes_total NUMERIC DEFAULT 0,
    transactions JSONB DEFAULT '[]',
    audit_log JSONB DEFAULT '[]',
    active BOOLEAN DEFAULT true,
    deleted_at TIMESTAMPTZ,
    created_by TEXT,
    updated_by TEXT,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
  )
`;

const UPSERT_SQL = `
  INSERT INTO payouts (id, payment_number, type, status, payment_method, payment_date, notes, work_order_ids,
    is_adhoc, technician_id, agent_id, distributor_id, base_amount, bonus, deductions, net_amount,
    invoice_number, po_number, part_number, invoice_date, due_date, tax_amount, subtotal, total_amount,
    attachment, commission_type, commission_rate, gross_amount, commission_amount, credit_notes_total,
    debit_notes_total, transactions, audit_log, active, deleted_at, created_by, updated_by, created_at, updated_at)
  VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,
    $28,$29,$30,$31,$32,$33,$34,$35,$36,$37,$38,$39)
  ON CONFLICT (id) DO UPDATE SET payment_number = EXCLUDED.payment_number, type = EXCLUDED.type,
    status = EXCLUDED.status, payment_method = EXCLUDED.payment_method, payment_date = EXCLUDED.payment_date,
    notes = EXCLUDED.notes, work_order_ids = EXCLUDED.work_order_ids, is_adhoc = EXCLUDED.is_adhoc,
    technician_id = EXCLUDED.technician_id, agent_id = EXCLUDED.agent_id, distributor_id = EXCLUDED.distributor_id,
    base_amount = EXCLUDED.base_amount, bonus = EXCLUDED.bonus, deductions = EXCLUDED.deductions,
    net_amount = EXCLUDED.net_amount, invoice_number = EXCLUDED.invoice_number, po_number = EXCLUDED.po_number,
    part_number = EXCLUDED.part_number, invoice_date = EXCLUDED.invoice_date, due_date = EXCLUDED.due_date,
    tax_amount = EXCLUDED.tax_amount, subtotal = EXCLUDED.subtotal, total_amount = EXCLUDED.total_amount,
    attachment = EXCLUDED.attachment, commission_type = EXCLUDED.commission_type,
    commission_rate = EXCLUDED.commission_rate, gross_amount = EXCLUDED.gross_amount,
    commission_amount = EXCLUDED.commission_amount, credit_notes_total = EXCLUDED.credit_notes_total,
    debit_notes_total = EXCLUDED.debit_notes_total, transactions = EXCLUDED.transactions,
    audit_log = EXCLUDED.audit_log, active = EXCLUDED.active, deleted_at = EXCLUDED.deleted_at,
    created_by = EXCLUDED.created_by, updated_by = EXCLUDED.updated_by, updated_at = EXCLUDED.updated_at
`;

async function main() {
  const jsonPath = path.join(__dirname, "..", "data", "payments.json");
  const jsonPayments = JSON.parse(fs.readFileSync(jsonPath, "utf-8"));
  console.log(`Read ${jsonPayments.length} payments from payments.json.`);

  await pool.query(CREATE_TABLE_SQL);
  console.log("Ensured payouts table exists.");

  // workOrderIds in payments.json are pre-UUID-migration integers (the old sequential JSON
  // work order id). work_order_no ("Wo-0001", "WO-3866", ...) preserved that same numbering
  // through the UUID migration, so it's the crosswalk back to the current UUID work order id.
  const woRes = await pool.query("SELECT id, work_order_no FROM work_orders");
  const woByNumber = new Map();
  for (const row of woRes.rows) {
    const n = parseInt(String(row.work_order_no || "").replace(/\D/g, ""), 10);
    if (!Number.isNaN(n)) woByNumber.set(n, row.id);
  }
  console.log(`Built work order crosswalk: ${woByNumber.size} numbered work orders in SQL.`);

  let migrated = 0;
  let unmatchedWoIds = 0;
  const unmatchedSamples = [];

  for (const p of jsonPayments) {
    const workOrderIds = [];
    for (const oldId of p.workOrderIds || []) {
      const uuid = woByNumber.get(Number(oldId));
      if (uuid) {
        workOrderIds.push(uuid);
      } else {
        unmatchedWoIds++;
        if (unmatchedSamples.length < 10) unmatchedSamples.push({ paymentId: p.id, oldWorkOrderId: oldId });
      }
    }

    await pool.query(UPSERT_SQL, [
      p.id, p.paymentNumber ?? null, p.type, p.status, p.paymentMethod || "", p.paymentDate || "",
      p.notes || "", JSON.stringify(workOrderIds), !!p.isAdhoc, p.technicianId ?? null, p.agentId ?? null,
      p.distributorId ?? null, p.baseAmount || 0, p.bonus || 0, p.deductions || 0, p.netAmount || 0,
      p.invoiceNumber || "", p.poNumber || "", p.partNumber || "", p.invoiceDate || "", p.dueDate || "",
      p.taxAmount || 0, p.subtotal || 0, p.totalAmount || 0,
      p.attachment ? JSON.stringify(p.attachment) : null, p.commissionType || "Percentage",
      p.commissionRate || 0, p.grossAmount || 0, p.commissionAmount || 0, p.creditNotesTotal || 0,
      p.debitNotesTotal || 0, JSON.stringify(p.transactions || []), JSON.stringify(p.auditLog || []),
      p.active !== false, p.deletedAt || null, p.createdBy || "System", p.updatedBy || "System",
      p.createdAt || new Date().toISOString(), p.updatedAt || new Date().toISOString(),
    ]);
    migrated++;
  }

  console.log(`\nDone — ${migrated} payments migrated.`);
  if (unmatchedWoIds) {
    console.log(`${unmatchedWoIds} workOrderIds entries could not be matched to a SQL work order (kept out of work_order_ids for that payout).`);
    console.log("Samples:", JSON.stringify(unmatchedSamples));
  }

  const check = await pool.query("SELECT COUNT(*) AS total FROM payouts");
  console.log("Final payouts row count:", check.rows[0].total);

  await pool.end();
}

main().catch((e) => {
  console.error("migrate-payments failed:", e.message);
  process.exit(1);
});
