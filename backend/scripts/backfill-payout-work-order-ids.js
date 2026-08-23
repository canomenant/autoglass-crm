// Rellena payouts.work_order_ids desde las obligaciones, para los lotes historicos importados
// que quedaron con el array vacio.
//
//   cd backend && node scripts/backfill-payout-work-order-ids.js          # dry-run
//   cd backend && node scripts/backfill-payout-work-order-ids.js --apply
//
// work_order_ids es un campo DERIVADO: se escribe desde payable y esta solo para mostrar el
// contenido de un lote. Nunca se lee para decidir si algo ya se pago — esa pregunta la responde
// payable.payout_id. El backfill no cambia ningun monto: solo repuebla una lista descriptiva.
//
// De paso escribe en ANALISIS_IMPORT_APPSHEET.md las obligaciones que quedaron marcadas pagadas
// sin lote vinculado: su ID_PAYMENT* en el export apunta a un lote que los CSV de pago no traen.
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const pool = require("../src/config/db");

const APPLY = process.argv.includes("--apply");
const OUT = path.join(__dirname, "..", "..", "ANALISIS_IMPORT_APPSHEET.md");
const money = (n) => "$" + Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

(async () => {
  const c = await pool.connect();
  const totales = async () => (await c.query(`SELECT
      COALESCE(SUM((payment->>'amount')::numeric),0) pagado, COALESCE(SUM(glass_cost),0) glass,
      COALESCE(SUM(labor_cost),0) labor, COALESCE(SUM(commission),0) comision
    FROM work_orders WHERE active <> false`)).rows[0];
  const porEstado = async () => (await c.query("SELECT kind, status, count(*) n, SUM(amount) s FROM payable GROUP BY 1,2 ORDER BY 1,2")).rows;

  try {
    await c.query("BEGIN");
    const antes = await totales();
    const estadoAntes = JSON.stringify(await porEstado());

    const vacios = (await c.query(
      "SELECT count(*) n FROM payouts WHERE jsonb_array_length(COALESCE(work_order_ids,'[]'::jsonb)) = 0")).rows[0].n;

    const r = await c.query(`
      UPDATE payouts o
         SET work_order_ids = COALESCE(sub.wos, '[]'::jsonb), updated_at = now()
        FROM (SELECT payout_id, jsonb_agg(DISTINCT work_order_no) AS wos
                FROM payable WHERE payout_id IS NOT NULL AND work_order_no IS NOT NULL
               GROUP BY payout_id) sub
       WHERE o.id = sub.payout_id
         AND jsonb_array_length(COALESCE(o.work_order_ids,'[]'::jsonb)) = 0
      RETURNING 1`);

    const despues = await totales();
    const estadoDespues = JSON.stringify(await porEstado());
    const ok = ["pagado", "glass", "labor", "comision"].every((k) => Math.abs(Number(antes[k]) - Number(despues[k])) < 0.01)
      && estadoAntes === estadoDespues;

    console.log(`lotes con work_order_ids vacio: ${vacios} · rellenados: ${r.rowCount}`);
    console.log(`totales de work_orders sin cambio: ${ok ? "OK" : "FALLA"}`);
    console.log(`estado de obligaciones sin cambio: ${estadoAntes === estadoDespues ? "OK" : "FALLA"}`);

    // --- las pagadas sin lote ---
    const huerfanas = (await c.query(`
      SELECT kind, party, work_order_no, amount FROM payable
       WHERE status = 'pagado' AND payout_id IS NULL
       ORDER BY kind, amount DESC`)).rows;
    const suma = huerfanas.reduce((a, x) => a + Number(x.amount), 0);
    const L = ["", "---", "", `## ${huerfanas.length} obligaciones pagadas sin lote vinculado`, "",
      `Suman **${money(suma)}**. Su \`ID_PAYMENT*\` en el export apunta a un lote que los CSV de pago no traen,`,
      "así que quedaron marcadas como pagadas pero sin comprobante asociado. No se tocaron.", "",
      "| Tipo | Parte | Work order | Monto |", "|---|---|---|---:|",
      ...huerfanas.map((x) => `| ${x.kind} | ${x.party || "(sin parte)"} | ${x.work_order_no || "(sin WO)"} | ${money(x.amount)} |`), ""];
    if (APPLY) fs.appendFileSync(OUT, L.join("\n") + "\n");
    console.log(`pagadas sin lote: ${huerfanas.length} · ${money(suma)}${APPLY ? " -> escritas en ANALISIS_IMPORT_APPSHEET.md" : ""}`);

    if (APPLY && ok) { await c.query("COMMIT"); console.log("\nAPLICADO"); }
    else { await c.query("ROLLBACK"); console.log(ok ? "\nROLLBACK — dry-run" : "\nROLLBACK — validaciones en falla"); }
  } catch (e) {
    await c.query("ROLLBACK").catch(() => {});
    console.log("ERROR:", e.message);
  } finally { c.release(); await pool.end(); }
})();
