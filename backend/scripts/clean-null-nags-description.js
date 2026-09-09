require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
// Descripciones NAGS que dicen literalmente el texto "NULL". Vienen de una importación que escribió
// la palabra en vez de dejar el campo vacío, y se ven en la columna "parte instalada" de los lotes
// de pago (Antonio, 9-sep-2026). Se dejan en blanco: no hay descripción que recuperar, y un campo
// vacío al menos no miente.
//
// Se limpia también el renglón de la cotización, que es de donde la orden la copia al convertir:
// arreglar solo la orden la traería de vuelta en la siguiente que salga de esa cotización.
// Sin --apply solo enseña lo que cambiaría.
const fs = require("fs");
const path = require("path");
const pool = require("../src/config/db");

const APPLY = process.argv.includes("--apply");
const ES_NULL = "btrim(nags_description) IN ('NULL','null')";

(async () => {
  const wos = await pool.query(
    `SELECT work_order_no, id, job_type, part_number, nags_description
       FROM work_orders WHERE active <> false AND ${ES_NULL} ORDER BY work_order_no`
  );
  const quotes = await pool.query(
    `SELECT quote_no, id FROM quotes
      WHERE active <> false
        AND EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(line_items,'[]'::jsonb)) li
                     WHERE btrim(li->>'nagsDescription') IN ('NULL','null'))
      ORDER BY quote_no`
  );
  console.log(APPLY ? "APLICANDO" : "SOLO PRUEBA (usa --apply para escribir)");
  console.log("Órdenes:", wos.rowCount, "| Cotizaciones con algún renglón así:", quotes.rowCount);
  console.table(wos.rows.map((x) => ({ orden: x.work_order_no, trabajo: x.job_type, parte: x.part_number, descripcion: x.nags_description })));
  console.table(quotes.rows.map((x) => ({ cotizacion: x.quote_no })));
  if (!APPLY) { await pool.end(); return; }

  const respaldo = path.join(__dirname, `null-nags-backup-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  fs.writeFileSync(respaldo, JSON.stringify({ workOrders: wos.rows, quotes: quotes.rows }, null, 2));
  console.log("Respaldo:", respaldo);

  const w = await pool.query(
    `UPDATE work_orders SET nags_description = '', updated_at = now() WHERE active <> false AND ${ES_NULL}`
  );
  // jsonb_set renglón por renglón: solo el campo que dice "NULL", el resto del line item intacto.
  const q = await pool.query(
    `UPDATE quotes SET line_items = (
       SELECT jsonb_agg(
         CASE WHEN btrim(li->>'nagsDescription') IN ('NULL','null')
              THEN jsonb_set(li, '{nagsDescription}', '""'::jsonb)
              ELSE li END ORDER BY ord)
         FROM jsonb_array_elements(line_items) WITH ORDINALITY AS t(li, ord)
     ), updated_at = now()
     WHERE id = ANY($1::uuid[])`,
    [quotes.rows.map((x) => x.id)]
  );
  console.log("Órdenes limpiadas:", w.rowCount, "| Cotizaciones limpiadas:", q.rowCount);
  await pool.end();
})().catch((e) => { console.error(e); process.exit(1); });
