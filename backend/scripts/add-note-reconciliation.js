// PASO 9: la nota de debito deja de ser solo un desenlace y pasa a tener un ciclo de vida.
//
//   cd backend && node scripts/add-note-reconciliation.js          # dry-run, ROLLBACK
//   cd backend && node scripts/add-note-reconciliation.js --apply
//
// Una nota de debito no es un vidrio roto: es una linea de factura que todavia no tiene respuesta.
// El distribuidor factura todo lo recibido, una parte amarra contra work orders y el resto no.
// Ese resto es la nota, y la pregunta que abre es "que paso con esta parte".
//
// El modelo guardaba el desenlace (applied_to) pero no la pregunta, y por eso una nota sin resolver
// era indistinguible de una resuelta: nunca aparecia en ninguna pantalla y nadie la perseguia.
// Resultado medido: $7,913.69 en 72 partes que no se le cobraron a nadie, $5,797.71 de eso con mas
// de un ano encima, y cero abierto con menos de tres meses — la cola no se trabaja, se acumula.
//
// Se separan ademas dos cosas que compartian columna:
//   payout_id        el lote donde la nota se neteo contra la factura del DISTRIBUIDOR
//   charge_payout_id el lote de TECNICO que recupero el costo
// Las 116 notas importadas que apuntaban a un lote de tecnico usaban payout_id para lo segundo,
// que es lo que obligo a filtrar por entity_type en recalculatePayment para no contar dos veces.
require("dotenv").config();
const pool = require("../src/config/db");

const APPLY = process.argv.includes("--apply");
const money = (n) => "$" + Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

(async () => {
  const c = await pool.connect();
  try {
    await c.query("BEGIN");

    // --- 1. columnas del ciclo de vida ---
    // resolution NULL = abierta. Es el estado que faltaba y el unico que importa operativamente.
    await c.query("ALTER TABLE credit_debit_note ADD COLUMN IF NOT EXISTS resolution TEXT");
    await c.query("ALTER TABLE credit_debit_note ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMPTZ");
    await c.query("ALTER TABLE credit_debit_note ADD COLUMN IF NOT EXISTS resolved_by TEXT");
    // Salida INSTALLED: la parte estaba en bodega y termino instalandose. Cierra contra esa orden.
    await c.query("ALTER TABLE credit_debit_note ADD COLUMN IF NOT EXISTS resolution_work_order_no TEXT");
    // Quien carga con el costo, distinto de quien facturo el vidrio.
    await c.query("ALTER TABLE credit_debit_note ADD COLUMN IF NOT EXISTS charged_to_type TEXT");
    await c.query("ALTER TABLE credit_debit_note ADD COLUMN IF NOT EXISTS charge_payout_id INTEGER REFERENCES payouts(id) ON DELETE SET NULL");
    await c.query("CREATE INDEX IF NOT EXISTS cdn_abiertas_idx ON credit_debit_note (kind, resolution) WHERE resolution IS NULL");
    await c.query("CREATE INDEX IF NOT EXISTS cdn_charge_idx ON credit_debit_note (charge_payout_id)");

    // --- 2. el cobro al tecnico se muda a su propia columna ---
    const mudadas = await c.query(
      `UPDATE credit_debit_note n SET charge_payout_id = n.payout_id, payout_id = NULL,
              charged_to_type = 'TECHNICIAN', updated_at = now()
         FROM payouts p
        WHERE p.id = n.payout_id AND p.type = 'TECHNICIAN' AND n.kind = 'DEBIT' AND n.active
       RETURNING 1`);

    // --- 3. estado inicial de cada nota, derivado de lo que REALMENTE paso con la parte ---
    // No de la etiqueta sola: "Tech" sin llegar a un pago no es cobrada, y "Company" sin nota de
    // credito no es devuelta. Esa distincion es justamente la que el modelo viejo no podia hacer.
    const marcar = async (resolution, extra, where, args = []) => {
      const r = await c.query(
        `UPDATE credit_debit_note SET resolution = $1, resolved_at = COALESCE(resolved_at, updated_at),
           resolved_by = COALESCE(resolved_by, 'appsheet_import')${extra}, updated_at = now()
          WHERE kind = 'DEBIT' AND active AND resolution IS NULL AND ${where} RETURNING amount`,
        [resolution, ...args]);
      return { n: r.rowCount, monto: r.rows.reduce((s, x) => s + Number(x.amount || 0), 0) };
    };

    // Devuelta: existe una nota de credito viva que la resuelve.
    const devueltas = await marcar("RETURNED", ", charged_to_type = 'COMPANY'",
      `EXISTS (SELECT 1 FROM credit_debit_note cr WHERE cr.debit_note_id = credit_debit_note.id
                 AND cr.kind = 'CREDIT' AND cr.active AND cr.status NOT IN ('Void','Cancelled'))`);
    // Cobrada al tecnico: llego a un lote de pago suyo.
    const cobradas = await marcar("TECH", "", "charge_payout_id IS NOT NULL");
    // Perdida declarada.
    const perdidas = await marcar("LOSS", ", charged_to_type = 'COMPANY'", "applied_to = 'Loss'");

    // Todo lo demas queda ABIERTO a proposito, pero en dos estados distintos.
    //
    // Las de applied_to='Tech' que nunca llegaron a un pago SI fueron clasificadas — alguien decidio
    // que el vidrio era del tecnico — y lo que falto fue el cobro. Quedan en resolution='TECH' con
    // charge_payout_id nulo, que es precisamente el estado "asignada y sin cobrar". Siguen abiertas
    // porque la regla es que la etiqueta no cierra nada; el cobro si.
    await c.query(
      `UPDATE credit_debit_note SET resolution = 'TECH', charged_to_type = 'TECHNICIAN',
         resolved_at = COALESCE(resolved_at, updated_at), resolved_by = COALESCE(resolved_by, 'appsheet_import'),
         updated_at = now()
        WHERE kind = 'DEBIT' AND active AND resolution IS NULL AND applied_to = 'Tech'
          AND COALESCE(btrim(technician), '') <> ''`);

    const abiertas = (await c.query(
      `SELECT count(*)::int n, COALESCE(SUM(amount),0)::numeric m,
              count(*) FILTER (WHERE charged_to_type = 'TECHNICIAN')::int tech
         FROM credit_debit_note WHERE kind = 'DEBIT' AND active AND resolution IS NULL`)).rows[0];

    // Las de credito no tienen ciclo propio: son la resolucion de una de debito.
    await c.query(
      `UPDATE credit_debit_note SET resolution = 'APPLIED', resolved_at = COALESCE(resolved_at, updated_at),
         resolved_by = COALESCE(resolved_by, 'appsheet_import'), updated_at = now()
        WHERE kind = 'CREDIT' AND active AND resolution IS NULL AND payout_id IS NOT NULL`);

    console.log(APPLY ? "=== APLICANDO ===" : "=== DRY-RUN (termina en ROLLBACK) ===");
    console.log(`cobro al tecnico mudado a charge_payout_id: ${mudadas.rowCount} nota(s)\n`);
    console.table([
      { estado: "RETURNED  devuelta al distribuidor", notas: devueltas.n, monto: money(devueltas.monto) },
      { estado: "TECH      cobrada al tecnico", notas: cobradas.n, monto: money(cobradas.monto) },
      { estado: "LOSS      dada por perdida", notas: perdidas.n, monto: money(perdidas.monto) },
      { estado: "ABIERTA   sin resolver", notas: abiertas.n, monto: money(abiertas.m) },
    ]);
    console.log(`de las abiertas, ${abiertas.tech} ya tienen tecnico asignado\n`);

    console.log("--- antiguedad de lo abierto ---");
    console.table((await c.query(
      `SELECT CASE
                WHEN issue_date < now() - interval '365 days' THEN 'mas de 1 ano'
                WHEN issue_date < now() - interval '180 days' THEN '6-12 meses'
                WHEN issue_date < now() - interval '90 days'  THEN '3-6 meses'
                ELSE 'menos de 3 meses' END AS tramo,
              count(*)::int partes, round(SUM(amount),2) monto
         FROM credit_debit_note WHERE kind='DEBIT' AND active AND resolution IS NULL
        GROUP BY 1 ORDER BY min(issue_date)`)).rows);

    // Los totales de nota por lote no pueden moverse: mudar el cobro al tecnico a otra columna
    // saca esas notas de payout_id, que es de donde recalculatePayment nunca las sumaba igual.
    // Cada tipo guarda su monto en una columna distinta, asi que la identidad se comprueba por
    // tipo y lote a lote, no sumando los tres con la formula del distribuidor.
    const rotos = (await c.query(
      `SELECT count(*)::int n FROM payouts WHERE active <> false AND abs(
         CASE type
           WHEN 'TECHNICIAN'  THEN base_amount + bonus - deductions - cash_advance - parts_deduction + parts_return - credit_notes_total + debit_notes_total - net_amount
           WHEN 'DISTRIBUTOR' THEN subtotal + bonus - deductions + COALESCE(tax_amount,0) - credit_notes_total + debit_notes_total - total_amount
           ELSE gross_amount + bonus - deductions - credit_notes_total + debit_notes_total - commission_amount
         END) > 0.005`)).rows[0].n;
    console.log(`\nlotes donde la identidad no cierra: ${rotos}`);
    if (rotos) throw new Error(`${rotos} lote(s) dejaron de cuadrar`);

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
