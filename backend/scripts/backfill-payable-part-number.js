// PASO 10: la obligacion de distribuidor guarda QUE parte se pago, no solo cuanto.
//
//   cd backend && node scripts/backfill-payable-part-number.js          # dry-run, ROLLBACK
//   cd backend && node scripts/backfill-payable-part-number.js --apply
//
// La deuda con un distribuidor es por orden Y por parte, pero payable solo guardaba la orden. En
// la pantalla del pago eso se ve como filas repetidas sin explicacion: Wo-2825 aparece dos veces
// en Dist-0244 con $11.35 y $70.50 y nada dice por que. Son dos piezas distintas — una moldura
// WFS F3488 y el parabrisas FW03488 GTN — y con el numero de parte la fila se explica sola.
//
// De paso se llena work_date, que estaba nulo en las 4,643 obligaciones de distribuidor (tecnico
// y agente si lo traian del export). Sale de la fecha de cita de la work order, que es la fecha en
// que el vidrio se instalo.
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
const nulo = (v) => { const s = String(v ?? "").trim(); return s === "" ? null : s; };

(async () => {
  const det = parseCSV(fs.readFileSync(path.join(DIR, "BD_WORKORDER_DETAIL.csv"), "utf8"));
  const porId = new Map(det.map((d) => [d.ID, d]));

  const c = await pool.connect();
  try {
    await c.query("BEGIN");

    await c.query("ALTER TABLE payable ADD COLUMN IF NOT EXISTS part_number TEXT");
    // La descripcion NAGS dice de que vehiculo es la pieza; sin ella el numero de parte solo
    // sirve a quien se lo sepa de memoria.
    await c.query("ALTER TABLE payable ADD COLUMN IF NOT EXISTS part_description TEXT");

    const filas = (await c.query(
      "SELECT id, external_id FROM payable WHERE kind = 'DISTRIBUTOR' AND part_number IS NULL")).rows;

    let escritas = 0, sinCsv = 0, sinParte = 0;
    for (const p of filas) {
      const d = porId.get(String(p.external_id || "").replace(/^dist:/, ""));
      if (!d) { sinCsv++; continue; }
      const parte = nulo(d.PARTNUMBER_LABEL);
      if (!parte) { sinParte++; continue; }
      await c.query("UPDATE payable SET part_number = $2, part_description = $3, updated_at = now() WHERE id = $1",
        [p.id, parte, nulo(d["NAGS DESCRIPTION"])]);
      escritas++;
    }

    // work_date desde la cita de la orden. Solo donde este vacio: lo que ya vino del export manda.
    const fechas = await c.query(
      `UPDATE payable p SET work_date = w.appointment_date, updated_at = now()
         FROM work_orders w
        WHERE w.work_order_no = p.work_order_no AND w.active <> false
          AND p.kind = 'DISTRIBUTOR' AND p.work_date IS NULL AND w.appointment_date IS NOT NULL
       RETURNING 1`);

    console.log(APPLY ? "=== APLICANDO ===" : "=== DRY-RUN (termina en ROLLBACK) ===");
    console.log(`numero de parte escrito : ${escritas}`);
    console.log(`  sin fila en el CSV    : ${sinCsv}`);
    console.log(`  la fila no trae parte : ${sinParte}`);
    console.log(`fecha de trabajo escrita: ${fechas.rowCount}`);

    console.log("\n--- como se vera el lote Dist-0244 ---");
    console.table((await c.query(
      `SELECT work_order_no AS wo, party, part_number AS parte, work_date AS fecha, amount AS monto
         FROM payable WHERE payout_id = 531 ORDER BY work_order_no LIMIT 8`)).rows);

    // Los montos no se tocan: esto solo agrega descripcion a filas que ya existian.
    const t = (await c.query("SELECT count(*)::int n, round(SUM(amount),2) s FROM payable")).rows[0];
    console.log(`\npayable intacto: ${t.n} filas, $${t.s}`);

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
