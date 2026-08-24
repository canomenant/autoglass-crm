// PASO 7: lleva credit_debit_note de "tabla de import" a tabla que la app puede usar, y trae las
// notas que quedaron en notes.json.
//
//   cd backend && node scripts/extend-notes-schema.js          # dry-run, ROLLBACK
//   cd backend && node scripts/extend-notes-schema.js --apply
//
// El import solo necesitaba el lado del distribuidor, asi que la tabla quedo con `distributor` y
// `distributor_ext_id`. La app tambien emite notas contra tecnicos y agentes, asi que esas dos
// columnas pasan a ser genericas y aparece entity_type. Renombrar es seguro: la tabla es de ayer y
// no tiene mas contenido que el import de AppSheet, todo con entity_type = DISTRIBUTOR.
//
// Se agregan ademas los campos que la app ya escribia contra el JSON y que la tabla no tenia:
// reason, attachment, created_by/updated_by y audit_log.
//
// `active` existe para que borrar una nota no borre la fila. Una nota de credito es un documento
// contable: si desaparece, desaparece tambien la razon por la que un pago fue menor de lo que la
// suma de sus obligaciones decia. Mismo criterio que con las obligaciones de Alex Reyes, que se
// pusieron en cero en vez de borrarse.
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const pool = require("../src/config/db");

const APPLY = process.argv.includes("--apply");
const money = (n) => "$" + Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

(async () => {
  const c = await pool.connect();
  try {
    await c.query("BEGIN");

    const tiene = async (col) =>
      (await c.query("SELECT 1 FROM information_schema.columns WHERE table_name='credit_debit_note' AND column_name=$1", [col])).rowCount > 0;

    // --- 1. columnas genericas ---
    if (await tiene("distributor")) await c.query("ALTER TABLE credit_debit_note RENAME COLUMN distributor TO entity_name");
    if (await tiene("distributor_ext_id")) await c.query("ALTER TABLE credit_debit_note RENAME COLUMN distributor_ext_id TO entity_ext_id");

    await c.query("ALTER TABLE credit_debit_note ADD COLUMN IF NOT EXISTS entity_type TEXT NOT NULL DEFAULT 'DISTRIBUTOR'");
    await c.query("ALTER TABLE credit_debit_note ADD COLUMN IF NOT EXISTS reason TEXT");
    await c.query("ALTER TABLE credit_debit_note ADD COLUMN IF NOT EXISTS attachment JSONB");
    await c.query("ALTER TABLE credit_debit_note ADD COLUMN IF NOT EXISTS created_by TEXT");
    await c.query("ALTER TABLE credit_debit_note ADD COLUMN IF NOT EXISTS updated_by TEXT");
    await c.query("ALTER TABLE credit_debit_note ADD COLUMN IF NOT EXISTS audit_log JSONB NOT NULL DEFAULT '[]'::jsonb");
    await c.query("ALTER TABLE credit_debit_note ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT true");
    await c.query("CREATE INDEX IF NOT EXISTS cdn_entity_idx ON credit_debit_note (entity_type, entity_name)");

    await c.query("UPDATE credit_debit_note SET created_by = 'appsheet_import' WHERE created_by IS NULL AND source = 'appsheet'");

    // --- 2. las notas que quedaron en notes.json ---
    // Tres, de julio, creadas por "Demo Admin". Se traen en vez de descartarlas porque no me toca
    // decidir que la captura de otro fue de prueba, pero la #1 pierde su vinculo con el lote: es
    // una nota de credito de un distribuidor apuntando a un lote de pago de TECNICO, y aplicarla
    // habria bajado el pago de un tecnico por un abono de Mygrant. Nunca llego a aplicarse — todos
    // los lotes tenian credit_notes_total en cero — asi que soltar el vinculo no mueve un peso.
    const FILE = path.join(__dirname, "..", "data", "notes.json");
    let traidas = 0, sinVinculo = [];
    if (fs.existsSync(FILE)) {
      const viejas = JSON.parse(fs.readFileSync(FILE, "utf8"));
      for (const n of viejas) {
        const ext = "json:" + n.id;
        const tipoNota = n.noteType === "DEBIT" ? "DEBIT" : "CREDIT";
        const tipoLote = { DISTRIBUTOR: "DISTRIBUTOR", TECHNICIAN: "TECHNICIAN", AGENT: "AGENT" }[n.entityType] || "DISTRIBUTOR";

        let payoutId = null;
        const rel = Number(n.relatedPaymentId);
        if (Number.isFinite(rel) && rel > 0) {
          const r = await c.query("SELECT id, type FROM payouts WHERE id = $1 AND active <> false", [rel]);
          if (r.rows[0] && r.rows[0].type === tipoLote) payoutId = rel;
          else if (r.rows[0]) sinVinculo.push(`${n.noteNumber}: nota ${n.entityType} sobre lote ${rel} que es ${r.rows[0].type}`);
          else sinVinculo.push(`${n.noteNumber}: el lote ${rel} no existe`);
        }

        const res = await c.query(
          `INSERT INTO credit_debit_note (kind, note_number, issue_date, amount, entity_type, entity_name, entity_ext_id,
             payout_id, status, reason, note, attachment, created_by, source, external_id, created_at, updated_at)
           VALUES ($1,$2,$3::date,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'notes.json',$14,$15,$16)
           ON CONFLICT (external_id) DO NOTHING RETURNING id`,
          [tipoNota, n.noteNumber, n.issueDate || null, Number(n.amount || 0), n.entityType || "DISTRIBUTOR",
           n.entityName || null, n.entityId != null ? String(n.entityId) : null, payoutId, n.status || "Active",
           n.reason || null, n.description || null, n.attachment ? JSON.stringify(n.attachment) : null,
           n.createdBy || null, ext, n.createdAt || new Date().toISOString(), n.updatedAt || new Date().toISOString()]
        );
        if (res.rows[0]) traidas++;
      }
    }

    console.log(APPLY ? "=== APLICANDO ===" : "=== DRY-RUN (termina en ROLLBACK) ===");
    console.log(`notas traidas de notes.json: ${traidas}`);
    if (sinVinculo.length) console.log(`vinculo de lote soltado en ${sinVinculo.length}:\n  ${sinVinculo.join("\n  ")}`);

    console.table((await c.query(
      `SELECT kind, entity_type, source, count(*)::int n, round(SUM(amount),2) monto,
              count(*) FILTER (WHERE payout_id IS NOT NULL)::int con_lote
         FROM credit_debit_note WHERE active GROUP BY 1,2,3 ORDER BY 3,1,2`
    )).rows);

    // Los totales de nota por lote no pueden haber cambiado: lo que entra viene sin lote o con uno
    // que ya coincidia en tipo.
    const t = (await c.query(
      `SELECT round(SUM(subtotal + bonus - deductions + COALESCE(tax_amount,0) - credit_notes_total + debit_notes_total),2) formula,
              round(SUM(total_amount),2) guardado FROM payouts WHERE type='DISTRIBUTOR' AND active <> false`
    )).rows[0];
    console.log(`\ndistribuidor -> formula ${money(t.formula)} vs guardado ${money(t.guardado)}`);

    if (APPLY) { await c.query("COMMIT"); console.log("\nCOMMIT"); }
    else { await c.query("ROLLBACK"); console.log("\nROLLBACK: nada quedo escrito. Corre con --apply."); }
  } catch (e) {
    await c.query("ROLLBACK");
    console.error("ROLLBACK:", e.message);
    process.exitCode = 1;
  } finally {
    c.release();
    await pool.end();
  }
})().catch((e) => { console.error(e); process.exit(1); });
