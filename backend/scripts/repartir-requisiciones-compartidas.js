require("dotenv").config();
const pool = require("../src/config/db");

// Reparte los renglones de las requisiciones que cubren VARIOS trabajos.
//
// El técnico pide los tres vidrios del día en un solo pedido, y las tres cotizaciones guardan el
// mismo número de requisición. El cruce viejo se quedaba con la primera orden y le daba todos los
// renglones: esa quedaba con el vidrio de las otras dos, y las otras dos sin nada. Son 454
// requisiciones compartidas, con 312 renglones y $35,444.99 repartidos así.
//
// El cruce ya está corregido (statementMatch.deLaRequisicion), pero eso solo arregla lo que entre
// de aquí en adelante. Esto acomoda lo que ya está cargado, y lo hace con la mano MUY quieta:
//
//   · Solo renglones cuya requisición reclaman dos o más órdenes.
//   · Solo cuando la parte del renglón coincide con EXACTAMENTE UNA de esas órdenes. Si coinciden
//     varias o ninguna, no se toca: la requisición sigue diciendo la verdad aunque no diga cuál.
//   · Nunca toca un renglón que alguien movió a mano (los marcados "desasignado" o "devuelta"),
//     ni los que ya están donde deben.
//
// Sin --apply solo enseña qué movería.

const APPLY = process.argv.includes("--apply");
const base = (p) => String(p || "").split(/\s+/).slice(0, 2).join(" ").toUpperCase();

(async () => {
  const candidatas = new Map();
  for (const r of (await pool.query(
    `SELECT upper(btrim(li->>'orderNumber')) AS req, wo.work_order_no,
            COALESCE(NULLIF(btrim(li->>'partNumber'), ''), wo.part_number) AS part_number
       FROM quotes q
       CROSS JOIN LATERAL jsonb_array_elements(q.line_items) li
       JOIN work_orders wo ON wo.quote_id = q.id AND wo.active <> false
      WHERE COALESCE(btrim(li->>'orderNumber'), '') <> ''`
  )).rows) {
    if (!candidatas.has(r.req)) candidatas.set(r.req, []);
    const lista = candidatas.get(r.req);
    if (!lista.some((x) => x.work_order_no === r.work_order_no && base(x.part_number) === base(r.part_number))) {
      lista.push(r);
    }
  }

  const lineas = (await pool.query(
    `SELECT l.id, l.req_no, l.part_number, l.amount, l.work_order_no, l.classification, l.match_source,
            s.invoice_number AS stmt
       FROM distributor_statement_line l
       JOIN distributor_statement s ON s.id = l.statement_id
      WHERE s.active AND l.work_order_no IS NOT NULL
        AND l.classification IN ('INSTALLED', 'ACCESSORY')
        AND COALESCE(l.match_source, '') NOT LIKE 'desasignado%'
        AND COALESCE(l.match_source, '') NOT LIKE 'devuelta%'`
  )).rows;

  const mover = [];
  const ambiguas = [];
  for (const l of lineas) {
    const lista = candidatas.get(String(l.req_no || "").split("-")[0].toUpperCase());
    if (!lista || lista.length < 2) continue;
    const coinciden = lista.filter((c) => base(c.part_number) === base(l.part_number));
    if (coinciden.length !== 1) { ambiguas.push({ ...l, candidatas: lista.length, coinciden: coinciden.length }); continue; }
    if (coinciden[0].work_order_no === l.work_order_no) continue;
    mover.push({ ...l, destino: coinciden[0].work_order_no });
  }

  console.log(`renglones en requisiciones compartidas que cambiarían de orden: ${mover.length}`);
  console.log(`  monto involucrado: $${mover.reduce((s, x) => s + Number(x.amount), 0).toFixed(2)}`);
  console.log(`renglones que se quedan como están por ambiguos: ${ambiguas.length}`);
  console.table(mover.slice(0, 25).map((m) => ({
    stmt: m.stmt, req: m.req_no, parte: m.part_number, monto: Number(m.amount),
    de: m.work_order_no, a: m.destino, como: m.match_source,
  })));
  if (mover.length > 25) console.log(`  … y ${mover.length - 25} más`);

  if (!APPLY) { console.log("\nSIMULACIÓN. --apply para escribir."); await pool.end(); return; }

  for (const m of mover) {
    await pool.query(
      `UPDATE distributor_statement_line
          SET work_order_no = $2, match_source = 'requisición (parte)', updated_at = now()
        WHERE id = $1`,
      [m.id, m.destino]
    );
  }
  console.log(`\nMovidos ${mover.length} renglones.`);
  await pool.end();
})().catch((e) => { console.error(e); process.exit(1); });
