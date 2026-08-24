// PASO 5: importa las notas de credito y debito de AppSheet y las conecta con las obligaciones
// y los lotes que ya estan en la base.
//
//   cd backend && node scripts/import-appsheet-notes.js          # dry-run, ROLLBACK
//   cd backend && node scripts/import-appsheet-notes.js --apply
//
// El modelo de AppSheet: se rompe un vidrio y se emite una NOTA DE DEBITO contra el distribuidor
// que lo facturo. APPLIED_TO dice quien come el costo — Tech (se le descuenta al tecnico de su
// pago), Company (lo absorbe la empresa) o Loss (se da por perdido). Si el distribuidor acepta la
// devolucion emite una NOTA DE CREDITO, que se netea contra el siguiente pago a ese distribuidor.
//
// Una sola tabla parametrizada por kind, no dos: es la misma deuda vista desde los dos lados y
// comparte todas las columnas menos dos. Mismo criterio que payable.
//
// Verificado antes de escribir una linea:
//   - 296 de 302 notas de debito apuntan a una obligacion de payable via ID_SERVICEPART, con el
//     distribuidor coincidiendo en 296/296 y el monto en 295/296.
//   - las 114 notas de credito llegan a esa obligacion a traves de su nota de debito, sin huecos.
//   - la suma de notas de credito por lote de distribuidor iguala la columna DISCOUNT del export
//     en los 64 lotes, con diferencia $0.00.
//
// La fase 4 mueve esos $11,076.07 de payouts.deductions a payouts.credit_notes_total. Tienen que
// vivir en un solo lado: la formula de recomputeAmount() resta ambos, asi que dejarlos duplicados
// descuenta el mismo dinero dos veces. La nota es la fuente de verdad y deductions queda para
// ajustes manuales sin nota detras.
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const pool = require("../src/config/db");

const APPLY = process.argv.includes("--apply");
const DIR = path.join(__dirname, "..", "imports", "appsheet", "csv");

function parseCSV(t) {
  const R = [];
  let r = [], f = "", q = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (q) {
      if (c === '"') { if (t[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c;
    } else if (c === '"') q = true;
    else if (c === ",") { r.push(f); f = ""; }
    else if (c === "\n") { r.push(f); R.push(r); r = []; f = ""; }
    else if (c !== "\r") f += c;
  }
  if (f || r.length) { r.push(f); R.push(r); }
  const h = R.shift().map((x) => x.trim());
  return R.filter((x) => x.length > 1).map((x) => Object.fromEntries(h.map((k, i) => [k, (x[i] ?? "").trim()])));
}
const num = (v) => { const n = Number(String(v ?? "").replace(/[$,]/g, "")); return Number.isFinite(n) ? n : 0; };
const money = (n) => "$" + Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fecha = (v) => {
  const s = String(v ?? "").trim();
  if (!s) return null;
  if (/^\d+$/.test(s)) {
    const d = new Date(Date.UTC(1899, 11, 30) + Number(s) * 86400000);
    return isNaN(d) ? null : d.toISOString().slice(0, 10);
  }
  const d = new Date(s);
  return isNaN(d) ? null : d.toISOString().slice(0, 10);
};
const col = (row, re) => Object.keys(row).find((k) => re.test(k));
const load = (f) => parseCSV(fs.readFileSync(path.join(DIR, f), "utf8"));
const cerca = (a, b) => Math.abs(Number(a) - Number(b)) < 0.005;
const nulo = (v) => { const s = String(v ?? "").trim(); return s === "" ? null : s; };

(async () => {
  const dn = load("BD_DEBITNOTE.csv");
  const cn = load("BD_CREDITNOTE.csv");
  const pTech = load("BD_PAYMENTTECH.csv");
  const pDist = load("BD_PAYMENTDISTRIBUTOR.csv");

  // Los lotes no guardan el id de AppSheet, asi que el puente es la numeracion del export:
  // ID_PAYMENTTECH -> BD_PAYMENTTECH.Consecutive -> payouts.payment_number.
  const cNumT = col(pTech[0], /Consecutive Payment Tech/i);
  const cNumD = col(pDist[0], /CONSECUTIVE DISTRIBUTOR/i);
  const numeroLoteTech = new Map(pTech.map((r) => [r.ID, r[cNumT]]));
  const numeroLoteDist = new Map(pDist.map((r) => [r.ID, r[cNumD]]));

  const c = await pool.connect();
  const avance = { debito: 0, credito: 0, yaEstaban: 0 };
  const sinPayable = [];
  const sinLote = [];

  try {
    await c.query("BEGIN");

    // --- 1. esquema ---
    await c.query(`CREATE TABLE IF NOT EXISTS credit_debit_note (
      id BIGSERIAL PRIMARY KEY,
      kind TEXT NOT NULL,                       -- DEBIT | CREDIT
      note_number TEXT,                         -- ND-0001 en debito, factura de abono en credito
      issue_date DATE,
      amount NUMERIC(12,2) NOT NULL DEFAULT 0,
      distributor TEXT,                         -- quien facturo el vidrio
      distributor_ext_id TEXT,
      applied_to TEXT,                          -- DEBIT: Tech | Company | Loss
      technician TEXT,                          -- DEBIT, poblado cuando applied_to = Tech
      technician_ext_id TEXT,
      part_number TEXT,
      payable_id BIGINT REFERENCES payable(id) ON DELETE SET NULL,     -- la obligacion del vidrio
      payout_id INTEGER REFERENCES payouts(id) ON DELETE SET NULL,     -- el lote donde se neteo
      debit_note_id BIGINT REFERENCES credit_debit_note(id) ON DELETE SET NULL,  -- CREDIT -> su ND
      status TEXT NOT NULL DEFAULT 'Active',
      note TEXT,
      source TEXT,
      external_id TEXT UNIQUE,                  -- id de AppSheet: hace el import idempotente
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
    await c.query("CREATE INDEX IF NOT EXISTS cdn_kind_idx ON credit_debit_note (kind, status)");
    await c.query("CREATE INDEX IF NOT EXISTS cdn_payout_idx ON credit_debit_note (payout_id)");
    await c.query("CREATE INDEX IF NOT EXISTS cdn_payable_idx ON credit_debit_note (payable_id)");
    await c.query("CREATE INDEX IF NOT EXISTS cdn_debit_idx ON credit_debit_note (debit_note_id)");

    const idPayable = async (extServicePart) => {
      if (!extServicePart) return null;
      const r = await c.query("SELECT id FROM payable WHERE external_id = $1", ["dist:" + extServicePart]);
      return r.rows[0] ? Number(r.rows[0].id) : null;
    };
    const idLote = async (numero, tipo) => {
      if (!numero) return null;
      const r = await c.query("SELECT id FROM payouts WHERE payment_number = $1 AND type = $2 AND active <> false", [numero, tipo]);
      return r.rows[0] ? Number(r.rows[0].id) : null;
    };

    // --- 2. notas de debito ---
    const idPorExterno = new Map();
    for (const r of dn) {
      const ext = "dn:" + r.ID;
      const payableId = await idPayable(r.ID_SERVICEPART);
      if (!payableId) sinPayable.push(r["# DEBIT NOTE"] || r.ID);

      // Se le descuenta al tecnico solo si la nota apunta a un lote de pago suyo. 39 notas
      // cargadas a un tecnico nunca llegaron a descontarse: quedan con payout_id nulo, que es
      // justamente lo que las hace visibles.
      let payoutId = null;
      if (r.ID_PAYMENTTECH) {
        payoutId = await idLote(numeroLoteTech.get(r.ID_PAYMENTTECH), "TECHNICIAN");
        if (!payoutId) sinLote.push((r["# DEBIT NOTE"] || r.ID) + " -> pago tech " + r.ID_PAYMENTTECH);
      }

      const res = await c.query(
        `INSERT INTO credit_debit_note (kind, note_number, issue_date, amount, distributor, distributor_ext_id,
           applied_to, technician, technician_ext_id, part_number, payable_id, payout_id, note, source, external_id)
         VALUES ('DEBIT',$1,$2::date,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'appsheet',$13)
         ON CONFLICT (external_id) DO NOTHING RETURNING id`,
        [nulo(r["# DEBIT NOTE"]), fecha(r.DATE), num(r.GLASS_COST), nulo(r.DISTRIBUTOR_LABEL), nulo(r.ID_DISTRIBUTOR),
         nulo(r.APPLIED_TO), nulo(r.TECH_LABEL), nulo(r.ID_TECH), nulo(r.PARTNUMBER_LABEL),
         payableId, payoutId, nulo(r.NOTE), ext]
      );
      if (res.rows[0]) { avance.debito++; idPorExterno.set(r.ID, Number(res.rows[0].id)); }
      else {
        avance.yaEstaban++;
        const y = await c.query("SELECT id FROM credit_debit_note WHERE external_id = $1", [ext]);
        if (y.rows[0]) idPorExterno.set(r.ID, Number(y.rows[0].id));
      }
    }

    // --- 3. notas de credito ---
    // Heredan distribuidor, parte y obligacion de su nota de debito: son la misma pieza de vidrio
    // vista desde el otro lado, y duplicar el dato invita a que las dos versiones se separen.
    const dnPorId = new Map(dn.map((r) => [r.ID, r]));
    for (const r of cn) {
      const ext = "cn:" + r.ID;
      const padre = dnPorId.get(r.ID_DEBITNOTE);
      const debitNoteId = idPorExterno.get(r.ID_DEBITNOTE) ?? null;
      const payableId = padre ? await idPayable(padre.ID_SERVICEPART) : null;
      const numero = numeroLoteDist.get(r["ID_PAYMENT DISTRIBUTOR"]);
      const payoutId = await idLote(numero, "DISTRIBUTOR");
      if (r["ID_PAYMENT DISTRIBUTOR"] && !payoutId) sinLote.push((r.CREDIT_INVOICE || r.ID) + " -> pago dist " + r["ID_PAYMENT DISTRIBUTOR"]);

      const res = await c.query(
        `INSERT INTO credit_debit_note (kind, note_number, issue_date, amount, distributor, distributor_ext_id,
           part_number, payable_id, payout_id, debit_note_id, note, source, external_id)
         VALUES ('CREDIT',$1,$2::date,$3,$4,$5,$6,$7,$8,$9,$10,'appsheet',$11)
         ON CONFLICT (external_id) DO NOTHING RETURNING id`,
        [nulo(r.CREDIT_INVOICE), fecha(r.DATE), num(r["GLASS COST"]),
         padre ? nulo(padre.DISTRIBUTOR_LABEL) : null, padre ? nulo(padre.ID_DISTRIBUTOR) : null,
         nulo(r.PARTNUMBER_LABEL), payableId, payoutId, debitNoteId, nulo(r.NOTE), ext]
      );
      if (res.rows[0]) avance.credito++; else avance.yaEstaban++;
    }

    // --- 4. el descuento del lote pasa a ser la suma de sus notas ---
    // Solo se mueve cuando deductions iguala exactamente la suma de las notas de credito de ese
    // lote. Si no coincide, deductions contiene algo mas que las notas y moverlo perderia ese algo.
    const candidatos = (await c.query(
      `SELECT p.id, p.payment_number, p.deductions, p.credit_notes_total, p.total_amount,
              COALESCE(SUM(n.amount), 0) AS notas
         FROM payouts p
         JOIN credit_debit_note n ON n.payout_id = p.id AND n.kind = 'CREDIT' AND n.status <> 'Void'
        WHERE p.type = 'DISTRIBUTOR' AND p.active <> false
        GROUP BY p.id, p.payment_number, p.deductions, p.credit_notes_total, p.total_amount`
    )).rows;

    let movidos = 0, montoMovido = 0;
    const noMovidos = [];
    for (const p of candidatos) {
      if (cerca(p.credit_notes_total, p.notas) && cerca(p.deductions, 0)) continue;  // ya migrado
      if (!cerca(p.deductions, p.notas)) {
        noMovidos.push(`${p.payment_number}: deductions ${money(p.deductions)} vs notas ${money(p.notas)}`);
        continue;
      }
      await c.query(
        "UPDATE payouts SET deductions = 0, credit_notes_total = $2, updated_at = now() WHERE id = $1",
        [p.id, p.notas]
      );
      movidos++; montoMovido += Number(p.notas);
    }

    // --- 5. ningun total pudo moverse ---
    const t = (await c.query(
      `SELECT round(SUM(subtotal + bonus - deductions + COALESCE(tax_amount,0) - credit_notes_total + debit_notes_total), 2) AS formula,
              round(SUM(total_amount), 2) AS guardado
         FROM payouts WHERE type = 'DISTRIBUTOR' AND active <> false`
    )).rows[0];

    console.log(APPLY ? "=== APLICANDO ===" : "=== DRY-RUN (termina en ROLLBACK) ===");
    console.log(`notas de debito insertadas : ${avance.debito}`);
    console.log(`notas de credito insertadas: ${avance.credito}`);
    console.log(`ya estaban                 : ${avance.yaEstaban}`);
    console.log(`lotes migrados a credit_notes_total: ${movidos}  ${money(montoMovido)}`);
    console.log(`\ndistribuidor -> formula ${money(t.formula)} vs total guardado ${money(t.guardado)}`);
    if (!cerca(t.formula, t.guardado)) throw new Error("la formula dejo de reproducir el total guardado");

    if (sinPayable.length) console.log(`\n${sinPayable.length} nota(s) de debito sin obligacion en payable: ${sinPayable.join(", ")}`);
    if (sinLote.length) console.log(`\n${sinLote.length} nota(s) sin lote resoluble:\n  ${sinLote.join("\n  ")}`);
    if (noMovidos.length) console.log(`\n${noMovidos.length} lote(s) no migrados (deductions no iguala las notas):\n  ${noMovidos.join("\n  ")}`);

    const resumen = (await c.query(
      `SELECT kind, applied_to, count(*) AS n, round(SUM(amount), 2) AS monto,
              count(*) FILTER (WHERE payout_id IS NOT NULL) AS con_lote
         FROM credit_debit_note GROUP BY 1, 2 ORDER BY 1, 2`
    )).rows;
    console.log("");
    console.table(resumen);

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
