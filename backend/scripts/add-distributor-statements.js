require("dotenv").config();
const pool = require("../src/config/db");

// Los statements del distribuidor solo existían DENTRO del pago que los saldó (payouts.invoices),
// así que una factura recibida y todavía no pagada no existía en ningún lado. Con 60 días de
// crédito en Mygrant eso deja dos meses ciegos: no había forma de contestar "cuánto le debo".
//
// Esta tabla los guarda desde que LLEGAN. El pago llega después y solo los marca saldados.
// Un memo de crédito (kind CREDIT_MEMO, monto negativo) que sigue en 'pending' es, literalmente,
// una nota de crédito pendiente de aplicar.
//
// El backfill toma las 410 facturas que ya viven dentro de los pagos y las da por pagadas.
// --apply para escribir; sin el flag solo simula.

const APPLY = process.argv.includes("--apply");
const PLAZO = 60; // días de crédito acordados con Mygrant

const DDL = `
  CREATE TABLE IF NOT EXISTS distributor_statement (
    id              BIGSERIAL PRIMARY KEY,
    invoice_number  TEXT NOT NULL,
    distributor     TEXT,
    branch          TEXT,
    kind            TEXT NOT NULL DEFAULT 'INVOICE',
    issue_date      DATE,
    due_date        DATE,
    amount          NUMERIC(12,2) NOT NULL DEFAULT 0,
    paid_amount     NUMERIC(12,2) NOT NULL DEFAULT 0,
    status          TEXT NOT NULL DEFAULT 'pending',
    payout_id       INTEGER REFERENCES payouts(id) ON DELETE SET NULL,
    terms_days      INTEGER NOT NULL DEFAULT ${PLAZO},
    active          BOOLEAN NOT NULL DEFAULT true,
    source          TEXT,
    notes           TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE UNIQUE INDEX IF NOT EXISTS distributor_statement_numero
    ON distributor_statement (upper(invoice_number)) WHERE active;
  CREATE INDEX IF NOT EXISTS distributor_statement_estado
    ON distributor_statement (status) WHERE active;
  CREATE INDEX IF NOT EXISTS distributor_statement_pago
    ON distributor_statement (payout_id);
`;

(async () => {
  // Lo que ya vive dentro de los pagos: esas facturas están saldadas por definición.
  const filas = (await pool.query(`
    SELECT p.id AS payout_id, p.payment_number, p.payment_date,
           (SELECT string_agg(DISTINCT btrim(pa.party), ', ') FROM payable pa WHERE pa.payout_id = p.id) AS party,
           f.value ->> 'number' AS numero,
           f.value ->> 'date'   AS fecha,
           (f.value ->> 'amount')::numeric AS monto
      FROM payouts p, jsonb_array_elements(p.invoices) f
     WHERE p.type = 'DISTRIBUTOR' AND p.active <> false
       AND jsonb_array_length(COALESCE(p.invoices, '[]'::jsonb)) > 0
       AND COALESCE(f.value ->> 'number', '') <> ''`)).rows;

  const vistos = new Map();
  const duplicadas = [];
  for (const f of filas) {
    const k = f.numero.trim().toUpperCase();
    if (vistos.has(k)) { duplicadas.push({ numero: f.numero, en: [vistos.get(k).payment_number, f.payment_number] }); continue; }
    vistos.set(k, f);
  }

  console.log(`Facturas dentro de pagos: ${filas.length} · únicas: ${vistos.size} · repetidas en dos pagos: ${duplicadas.length}`);
  if (duplicadas.length) {
    console.log("  (una factura pagada en dos partes es normal — se guarda una vez y se le suma lo pagado)");
    duplicadas.slice(0, 6).forEach((d) => console.log(`   ${d.numero} en ${d.en.join(" y ")}`));
  }
  const memos = [...vistos.values()].filter((f) => Number(f.monto) < 0).length;
  console.log(`  de esas, ${memos} son memos de crédito (monto negativo)`);

  if (!APPLY) { console.log("\nSimulación. Volver a lanzar con --apply para escribir."); await pool.end(); return; }

  await pool.query(DDL);
  console.log("\nTabla distributor_statement lista.");

  const client = await pool.connect();
  let n = 0;
  try {
    await client.query("BEGIN");
    for (const f of vistos.values()) {
      const monto = Number(f.monto || 0);
      const pagadoExtra = duplicadas
        .filter((d) => d.numero.trim().toUpperCase() === f.numero.trim().toUpperCase()).length;
      await client.query(
        `INSERT INTO distributor_statement
           (invoice_number, distributor, branch, kind, issue_date, due_date, amount, paid_amount,
            status, payout_id, terms_days, source, notes)
         VALUES ($1,$2,NULL,$3,$4::date,$4::date + $5::int, $6, $6, 'paid', $7, $5::int, 'backfill_payouts', $8)
         ON CONFLICT DO NOTHING`,
        [
          f.numero.trim(), f.party || null, monto < 0 ? "CREDIT_MEMO" : "INVOICE",
          f.fecha || null, PLAZO, monto, f.payout_id,
          pagadoExtra ? "Aparece en más de un pago; ver el historial del pago" : null,
        ]
      );
      n++;
    }
    await client.query("COMMIT");
  } catch (e) { await client.query("ROLLBACK"); throw e; } finally { client.release(); }

  const r = await pool.query(`
    SELECT kind, status, count(*)::int n, SUM(amount) s
      FROM distributor_statement WHERE active GROUP BY 1,2 ORDER BY 1,2`);
  console.log(`Statements cargados: ${n}`);
  r.rows.forEach((x) => console.log(`   ${x.kind} · ${x.status}: ${x.n}  $${Number(x.s).toFixed(2)}`));
  await pool.end();
})().catch((e) => { console.error("FALLA:", e.message); process.exit(1); });
