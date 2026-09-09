require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
// Le pone a la orden el número de pieza que su cotización sí tiene, en el RENGLÓN.
//
// createFromQuote lo tomaba de quote.partNumber —la columna vieja de cabecera, hoy siempre vacía—
// mientras que la descripción NAGS sí salía del line item. Resultado: órdenes con descripción
// completa y sin número. Sólo se corregía si alguien volvía a guardar la orden desde su pantalla,
// que lee el renglón; las demás se quedaban en blanco, y con ellas la columna "parte instalada" de
// los lotes de pago (Antonio, 9-sep-2026). El origen ya está arreglado en workorders.store.js.
//
// Sólo toca órdenes con el número VACÍO: una que ya tenga algo escrito manda ella, aunque difiera
// del renglón. Sin --apply sólo enseña lo que cambiaría.
const fs = require("fs");
const path = require("path");
const pool = require("../src/config/db");

const APPLY = process.argv.includes("--apply");

(async () => {
  const r = await pool.query(
    `SELECT w.work_order_no, w.id, w.nags_description,
            btrim(q.line_items->0->>'partNumber') AS parte
       FROM work_orders w JOIN quotes q ON q.id = w.quote_id
      WHERE w.active <> false
        AND COALESCE(btrim(w.part_number), '') = ''
        AND COALESCE(btrim(q.line_items->0->>'partNumber'), '') <> ''
      ORDER BY w.work_order_no`
  );
  console.log(APPLY ? "APLICANDO" : "SOLO PRUEBA (usa --apply para escribir)", "| órdenes a corregir:", r.rowCount);
  console.table(r.rows.map((x) => ({ orden: x.work_order_no, parte: x.parte, descripcion: String(x.nags_description || "").slice(0, 45) })));
  if (!APPLY || !r.rowCount) { await pool.end(); return; }

  const respaldo = path.join(__dirname, `workorder-part-number-backup-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  fs.writeFileSync(respaldo, JSON.stringify(r.rows.map((x) => ({ workOrderNo: x.work_order_no, id: x.id, partNumberAntes: "" })), null, 2));
  console.log("Respaldo:", respaldo);

  const w = await pool.query(
    `UPDATE work_orders AS w SET part_number = v.parte, updated_at = now()
       FROM unnest($1::uuid[], $2::text[]) AS v(id, parte)
      WHERE w.id = v.id`,
    [r.rows.map((x) => x.id), r.rows.map((x) => x.parte)]
  );
  console.log("Órdenes actualizadas:", w.rowCount);
  await pool.end();
})().catch((e) => { console.error(e); process.exit(1); });
