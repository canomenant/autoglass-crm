// PASO 8: lo que el export llama BONUS en un pago a distribuidor son NOTAS DE DEBITO.
//
//   cd backend && node scripts/relabel-distributor-debit-notes.js          # dry-run, ROLLBACK
//   cd backend && node scripts/relabel-distributor-debit-notes.js --apply
//
// La columna del CSV se llama BONUS y por eso el backfill la cargo en payouts.bonus. La pantalla de
// AppSheet la rotula "Debit", y Antonio lo confirmo con Dist-0244:
//
//   subtotal 3,574.16 + debito 533.77 - credito 233.00 = 3,874.93
//
// y esos $533.77 son exactamente ND-0308 ($293.77) + ND-0309 ($240.00), las dos notas de debito que
// la pantalla lista dentro de ese pago. La columna DISCOUNT ya se habia identificado igual: sus
// $233.00 son las notas de credito Z09720009-1 y Z09714121-1.
//
// Asi que bonus pasa a debit_notes_total en los pagos a distribuidor. Ningun total se mueve — la
// formula de recomputeAmount() suma los dos terminos con el mismo signo:
//
//   subtotal + bonus - deductions + tax - credit_notes_total + debit_notes_total
//
// Solo toca DISTRIBUTOR. En el lote de tecnico bonus si es un bono de verdad, y el vidrio que se le
// cobra al tecnico vive en parts_deduction; ahi la columna esta bien nombrada.
require("dotenv").config();
const pool = require("../src/config/db");

const APPLY = process.argv.includes("--apply");
const money = (n) => "$" + Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const cerca = (a, b) => Math.abs(Number(a) - Number(b)) < 0.005;

(async () => {
  const c = await pool.connect();
  try {
    await c.query("BEGIN");

    const antes = (await c.query(
      `SELECT round(SUM(total_amount),2) total, round(SUM(bonus),2) bonus, round(SUM(debit_notes_total),2) debito
         FROM payouts WHERE type='DISTRIBUTOR' AND active <> false`)).rows[0];

    // Solo donde debit_notes_total esta libre: si ya tiene algo, el bonus es otra cosa y sumarselo
    // encima perderia la distincion en vez de aclararla.
    const plan = (await c.query(
      `SELECT id, payment_number, bonus FROM payouts
        WHERE type='DISTRIBUTOR' AND active <> false AND bonus <> 0 AND COALESCE(debit_notes_total,0) = 0
        ORDER BY id`)).rows;

    for (const p of plan) {
      await c.query(
        "UPDATE payouts SET bonus = 0, debit_notes_total = $2, updated_at = now() WHERE id = $1",
        [p.id, p.bonus]);
    }

    const desp = (await c.query(
      `SELECT round(SUM(total_amount),2) total, round(SUM(bonus),2) bonus, round(SUM(debit_notes_total),2) debito
         FROM payouts WHERE type='DISTRIBUTOR' AND active <> false`)).rows[0];

    // La identidad tiene que seguir cerrando lote por lote, no solo en el agregado.
    const rotos = (await c.query(
      `SELECT count(*)::int n FROM payouts WHERE type='DISTRIBUTOR' AND active <> false
        AND abs(subtotal + bonus - deductions + COALESCE(tax_amount,0) - credit_notes_total + debit_notes_total - total_amount) > 0.005`
    )).rows[0].n;

    console.log(APPLY ? "=== APLICANDO ===" : "=== DRY-RUN (termina en ROLLBACK) ===");
    console.log(`lotes de distribuidor re-etiquetados: ${plan.length}  ${money(plan.reduce((s, x) => s + Number(x.bonus), 0))}`);
    console.log(`  bonus            ${money(antes.bonus)}  ->  ${money(desp.bonus)}`);
    console.log(`  debit_notes_total ${money(antes.debito)}  ->  ${money(desp.debito)}`);
    console.log(`  total pagado     ${money(antes.total)}  ->  ${money(desp.total)}`);
    console.log(`  lotes con la identidad rota: ${rotos}`);

    if (!cerca(antes.total, desp.total)) throw new Error("el total se movio, y no debia");
    if (rotos) throw new Error(`${rotos} lote(s) dejaron de cuadrar`);

    console.log("");
    console.table((await c.query(
      `SELECT id, payment_number, subtotal, bonus, deductions, debit_notes_total, credit_notes_total, total_amount
         FROM payouts WHERE payment_number = 'Dist-0244'`)).rows);

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
