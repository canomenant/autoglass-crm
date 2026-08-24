// PASO 6: las obligaciones de vidrio roto que el distribuidor ya abono dejan de contar como deuda.
//
//   cd backend && node scripts/settle-credited-payables.js          # dry-run, ROLLBACK
//   cd backend && node scripts/settle-credited-payables.js --apply
//
// Las 114 obligaciones con nota de credito seguian en payable como 'pendiente'. El distribuidor ya
// nos abono ese vidrio y el abono ya se descontó de su lote de pago, asi que ese dinero se estaba
// contando dos veces: $11,076.07 de los $113,281.49 que el sistema reporta como deuda con
// distribuidores no era deuda.
//
// Es una correccion de negocio, no un arreglo de datos: la obligacion se calculo bien bajo la
// regla vieja, y lo que cambio es la regla. Mismo criterio que con la comision de Alex Reyes.
//
// Estado propio, 'acreditado', y no 'pagado'. Saldada porque el distribuidor la abono no es lo
// mismo que saldada porque le pagamos, y colapsar las dos borra la unica diferencia que importa
// cuando alguien pregunte por que ese vidrio no salio de la caja.
//
// payout_id se queda NULO a proposito. Quien registra en que lote se neteo el credito es
// credit_debit_note.payout_id, que ya lo tiene en las 114. Copiarlo aqui ademas de duplicar el
// dato romperia payable.store.forPayout(), que lee por payout_id para mostrar el contenido de un
// lote: las obligaciones acreditadas apareceria como pagadas y el lote se veria $11,076.07 mas
// grande de lo que fue. Y cancel() revierte a 'pendiente' por payout_id, asi que anular un lote
// tampoco debe devolverlas.
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
      "SELECT count(*)::int n, COALESCE(SUM(amount),0)::numeric s FROM payable WHERE kind='DISTRIBUTOR' AND status='pendiente' AND amount > 0"
    )).rows[0];

    // Una obligacion se acredita cuando tiene nota de credito viva apuntandola. El monto de la
    // nota tiene que igualar el de la obligacion: un abono parcial no la salda, y marcarla
    // saldada perderia la diferencia.
    const candidatas = (await c.query(
      `SELECT p.id, p.party, p.amount, p.status, p.payout_id,
              COALESCE(SUM(n.amount), 0)::numeric AS acreditado,
              count(n.id)::int AS notas,
              string_agg(DISTINCT n.note_number, ', ') AS facturas
         FROM payable p
         JOIN credit_debit_note n ON n.payable_id = p.id AND n.kind = 'CREDIT' AND n.status <> 'Void'
        WHERE p.kind = 'DISTRIBUTOR'
        GROUP BY p.id, p.party, p.amount, p.status, p.payout_id
        ORDER BY p.id`
    )).rows;

    const plan = [];
    const saltadas = [];
    for (const p of candidatas) {
      if (p.status === "acreditado") continue;                       // ya corrido
      if (p.status !== "pendiente") { saltadas.push(`${p.id}: estado ${p.status}`); continue; }
      if (p.payout_id != null) { saltadas.push(`${p.id}: ya esta en el lote ${p.payout_id}`); continue; }
      if (!cerca(p.amount, p.acreditado)) {
        saltadas.push(`${p.id}: obligacion ${money(p.amount)} vs abono ${money(p.acreditado)} (${p.notas} nota/s)`);
        continue;
      }
      plan.push(p);
    }

    console.log(APPLY ? "=== APLICANDO ===" : "=== DRY-RUN (termina en ROLLBACK) ===");
    console.log(`obligaciones de distribuidor con nota de credito: ${candidatas.length}`);
    console.log(`a marcar 'acreditado': ${plan.length}  ${money(plan.reduce((s, x) => s + Number(x.amount), 0))}`);
    if (saltadas.length) console.log(`\n${saltadas.length} saltada(s):\n  ${saltadas.join("\n  ")}`);

    if (plan.length) {
      await c.query(
        "UPDATE payable SET status = 'acreditado', updated_at = now() WHERE id = ANY($1::bigint[])",
        [plan.map((x) => x.id)]
      );
    }

    const desp = (await c.query(
      "SELECT count(*)::int n, COALESCE(SUM(amount),0)::numeric s FROM payable WHERE kind='DISTRIBUTOR' AND status='pendiente' AND amount > 0"
    )).rows[0];

    // Nada mas que estas obligaciones pudo cambiar: los montos no se tocan, solo el estado.
    const total = (await c.query("SELECT COALESCE(SUM(amount),0)::numeric s, count(*)::int n FROM payable")).rows[0];

    console.log(`\ndeuda con distribuidores  ${money(antes.s)} (${antes.n})  ->  ${money(desp.s)} (${desp.n})`);
    console.log(`payable completo, sin cambios: ${total.n} filas, ${money(total.s)}`);
    console.log("");
    console.table((await c.query(
      "SELECT kind, status, count(*)::int n, round(SUM(amount),2) monto FROM payable GROUP BY 1,2 ORDER BY 1,2"
    )).rows);

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
