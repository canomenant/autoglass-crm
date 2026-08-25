// PASO 16: los 5 lotes de agente cuyo subtotal no coincide con sus renglones.
//
//   cd backend && node scripts/reconcile-agent-subtotals.js          # dry-run, ROLLBACK
//   cd backend && node scripts/reconcile-agent-subtotals.js --apply
//
// El descuadre viene de AppSheet, no del import: alli mismo el subtotal del lote y la suma de sus
// comisiones no coinciden en 6 de 251 lotes. Uno se resolvio calculando totales que nunca se
// calcularon (Agent-0132). Los otros 5 no tienen explicacion en los datos, y Antonio decidio
// cuadrarlos igual, sabiendo que no la hay.
//
// El subtotal pasa a ser lo que suman los renglones — que es lo unico verificable — y la diferencia
// se registra como ajuste del lote:
//
//   hueco positivo (el subtotal decia de mas)  -> al bono
//   hueco negativo (el subtotal decia de menos) -> a descuentos
//
// commission_amount = gross_amount + bonus - deductions, asi que EL TOTAL PAGADO NO SE MUEVE en
// ninguno. Solo cambia como se compone.
//
// Se descarto desligar las comisiones sobrantes de Agent-0003 y Agent-0057. Habria cuadrado igual,
// pero las manda a "pendiente", y AppSheet las marca STATUS=True: el sistema pasaria a reclamar
// $90 que ya se pagaron. Toda esta sesion fue quitar deuda fantasma — los $11,076.07 de vidrio ya
// abonado — y crear $90 nueva para ordenar una pantalla habria sido ir en reversa.
//
// El motivo queda escrito en cada lote para que nadie lea el ajuste como un bono real.
require("dotenv").config();
const pool = require("../src/config/db");

const APPLY = process.argv.includes("--apply");
const money = (n) => "$" + Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const cerca = (a, b) => Math.abs(Number(a) - Number(b)) < 0.005;
const MOTIVO = "Ajuste sin respaldo en obligaciones, heredado de AppSheet: el subtotal del lote no coincidia con sus comisiones y no hay dato que lo explique. El total pagado no cambio.";

(async () => {
  const c = await pool.connect();
  try {
    await c.query("BEGIN");

    const filas = (await c.query(
      `SELECT o.id, o.payment_number, o.gross_amount, o.bonus, o.deductions, o.commission_amount,
              o.notes, COALESCE(x.suma, 0)::numeric AS renglones
         FROM payouts o
         LEFT JOIN (SELECT payout_id, SUM(amount) suma FROM payable GROUP BY 1) x ON x.payout_id = o.id
        WHERE o.type = 'AGENT' AND o.active <> false
          AND abs(o.gross_amount - COALESCE(x.suma, 0)) >= 0.005
        ORDER BY o.payment_number`)).rows;

    const plan = [];
    for (const f of filas) {
      const hueco = Number(f.gross_amount) - Number(f.renglones);
      const bonus = Number(f.bonus) + (hueco > 0 ? hueco : 0);
      const deducciones = Number(f.deductions) + (hueco < 0 ? -hueco : 0);
      const total = Number(f.renglones) + bonus - deducciones;
      plan.push({
        id: f.id, numero: f.payment_number, gross: Number(f.renglones), bonus, deducciones,
        totalAntes: Number(f.commission_amount), totalDespues: total,
        via: hueco > 0 ? "bono" : "descuentos", hueco, notes: f.notes,
      });
    }

    console.log(APPLY ? "=== APLICANDO ===" : "=== DRY-RUN (termina en ROLLBACK) ===");
    console.table(plan.map((x) => ({
      lote: x.numero, "subtotal nuevo": money(x.gross), hueco: money(x.hueco), "va a": x.via,
      bono: money(x.bonus), descuentos: money(x.deducciones),
      "total antes": money(x.totalAntes), "total despues": money(x.totalDespues),
      "total intacto": cerca(x.totalAntes, x.totalDespues) ? "si" : "NO",
    })));

    const movidos = plan.filter((x) => !cerca(x.totalAntes, x.totalDespues));
    if (movidos.length) throw new Error(`${movidos.length} lote(s) cambiarian de total; no se escribe nada`);

    for (const x of plan) {
      await c.query(
        `UPDATE payouts SET gross_amount = $2, bonus = $3, deductions = $4,
           bonus_reason = CASE WHEN $5 = 'bono' THEN $6 ELSE bonus_reason END,
           notes = CASE WHEN $5 = 'descuentos' THEN btrim(COALESCE(notes,'') || ' | ' || $6, ' |') ELSE notes END,
           updated_at = now()
         WHERE id = $1`,
        [x.id, x.gross, x.bonus, x.deducciones, x.via, MOTIVO]);
    }

    const quedan = (await c.query(
      `SELECT count(*)::int n FROM payouts o
         LEFT JOIN (SELECT payout_id, SUM(amount) suma FROM payable GROUP BY 1) x ON x.payout_id = o.id
        WHERE o.type = 'AGENT' AND o.active <> false AND abs(o.gross_amount - COALESCE(x.suma,0)) >= 0.005`)).rows[0].n;
    const tot = (await c.query(
      "SELECT round(SUM(commission_amount),2) s, count(*)::int n FROM payouts WHERE type='AGENT' AND active <> false")).rows[0];

    console.log(`\nlotes de agente que aun no cuadran: ${quedan}`);
    console.log(`total pagado a agentes: ${money(tot.s)} en ${tot.n} lotes`);

    // La identidad de recomputeAmount tiene que seguir cerrando lote por lote.
    const rotos = (await c.query(
      `SELECT count(*)::int n FROM payouts WHERE type='AGENT' AND active <> false
        AND abs(gross_amount + bonus - deductions - credit_notes_total + debit_notes_total - commission_amount) > 0.005`)).rows[0].n;
    console.log(`lotes donde la formula no cierra: ${rotos}`);
    if (rotos) throw new Error("la formula dejo de cerrar");

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
