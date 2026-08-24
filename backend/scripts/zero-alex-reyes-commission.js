// Correccion de negocio: Alex Reyes es socio, no cobra comision como agente.
//
//   cd backend && node scripts/zero-alex-reyes-commission.js          # dry-run
//   cd backend && node scripts/zero-alex-reyes-commission.js --apply
//
// No es un error de datos: las 10 obligaciones estaban bien calculadas segun la regla vieja. Lo
// que cambio es la regla, y por eso se pone el monto en 0 en vez de borrar la fila — la obligacion
// existio, y borrarla haria desaparecer el rastro de que alguna vez se le liquidaba comision.
//
// La cabecera work_orders.commission se recalcula como la suma de las obligaciones AGENT de esa
// orden, no restando 15: si alguna tuviera otro agente ademas de Alex, restar a ciegas la
// desalinearia.
require("dotenv").config();
const pool = require("../src/config/db");

const APPLY = process.argv.includes("--apply");
const WOS = ["Wo-3520", "Wo-3528", "Wo-3536", "Wo-3538", "Wo-3539", "Wo-3557", "Wo-3567", "Wo-3593", "Wo-3625", "Wo-3639"];
const money = (n) => "$" + Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

(async () => {
  const c = await pool.connect();
  const foto = async () => {
    const w = (await c.query(`SELECT COALESCE(SUM((payment->>'amount')::numeric),0) pagado,
        COALESCE(SUM(glass_cost),0) glass, COALESCE(SUM(labor_cost),0) labor, COALESCE(SUM(commission),0) comision
      FROM work_orders WHERE active <> false`)).rows[0];
    const p = (await c.query(`SELECT kind, count(*)::int n, SUM(amount)::numeric s
      FROM payable WHERE status='pendiente' GROUP BY 1 ORDER BY 1`)).rows;
    return { w, p };
  };

  try {
    await c.query("BEGIN");
    const antes = await foto();

    // --- guarda: ninguna puede estar pagada ---
    const filas = (await c.query(
      `SELECT id, work_order_no, party, amount, status, payout_id FROM payable
        WHERE kind='AGENT' AND work_order_no = ANY($1) AND party ILIKE '%Alex Reyes%'`, [WOS])).rows;
    if (filas.length !== WOS.length) throw new Error(`Se esperaban ${WOS.length} obligaciones, hay ${filas.length}`);
    const pagadas = filas.filter((f) => f.status !== "pendiente" || f.payout_id !== null);
    if (pagadas.length) {
      throw new Error("PARAR — estas ya estan pagadas o en un lote: " +
        pagadas.map((f) => `${f.work_order_no} (${f.status}, lote ${f.payout_id})`).join(", "));
    }
    const suma = filas.reduce((a, f) => a + Number(f.amount), 0);
    console.log(`las 10: todas pendientes y sin lote · suman ${money(suma)}`);

    // --- poner en 0 ---
    const upd = await c.query(
      "UPDATE payable SET amount = 0, updated_at = now() WHERE id = ANY($1::bigint[]) RETURNING 1",
      [filas.map((f) => f.id)]);

    // --- cabecera = suma de sus obligaciones AGENT ---
    const cab = await c.query(`
      UPDATE work_orders w SET commission = COALESCE(sub.s, 0), updated_at = now()
        FROM (SELECT work_order_no, SUM(amount) s FROM payable
               WHERE kind='AGENT' AND work_order_no = ANY($1) GROUP BY 1) sub
       WHERE w.work_order_no = sub.work_order_no AND w.active <> false
      RETURNING w.work_order_no, w.commission`, [WOS]);

    const despues = await foto();
    const esperado = { comision: 52046.47, agentPend: 3882.26, pagado: 1502199.13, glass: 436290.19, labor: 417160.94 };
    const ag = despues.p.find((x) => x.kind === "AGENT");
    const agAntes = antes.p.find((x) => x.kind === "AGENT");
    const totalPend = despues.p.reduce((a, x) => a + Number(x.s), 0);

    let ok = true;
    const linea = (l, val, esp) => {
      const bien = Math.abs(Number(val) - esp) < 0.01; if (!bien) ok = false;
      console.log(`  ${l.padEnd(22)} ${money(val).padStart(14)} ${money(esp).padStart(14)}   ${bien ? "OK" : "FALLA"}`);
    };
    console.log(`\nobligaciones en 0: ${upd.rowCount} · cabeceras recalculadas: ${cab.rowCount}\n`);
    console.log("magnitud                       ahora       esperado    ok");
    linea("commission total", despues.w.comision, esperado.comision);
    linea("pendiente agentes", ag.s, esperado.agentPend);
    linea("pendiente total", totalPend, 177017.69);
    linea("payment.amount", despues.w.pagado, esperado.pagado);
    linea("glass_cost", despues.w.glass, esperado.glass);
    linea("labor_cost", despues.w.labor, esperado.labor);
    for (const k of ["TECH", "DISTRIBUTOR"]) {
      const a = antes.p.find((x) => x.kind === k), d = despues.p.find((x) => x.kind === k);
      const bien = Math.abs(Number(a.s) - Number(d.s)) < 0.01 && a.n === d.n; if (!bien) ok = false;
      console.log(`  ${("pendiente " + k).padEnd(22)} ${money(d.s).padStart(14)} ${"sin cambio".padStart(14)}   ${bien ? "OK" : "FALLA"}`);
    }
    // El conteo: las obligaciones en 0 siguen siendo pendientes, asi que no bajan de 434.
    console.log(`\n  obligaciones AGENT pendientes: ${agAntes.n} -> ${ag.n}`);

    if (APPLY && ok) { await c.query("COMMIT"); console.log("\nAPLICADO"); }
    else { await c.query("ROLLBACK"); console.log(ok ? "\nROLLBACK — dry-run" : "\nROLLBACK — validaciones en falla"); }
  } catch (e) {
    await c.query("ROLLBACK").catch(() => {});
    console.log("ERROR: " + e.message);
  } finally { c.release(); await pool.end(); }
})();
