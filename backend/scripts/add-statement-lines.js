require("dotenv").config();
const fs = require("fs");
const pool = require("../src/config/db");

// El renglón del statement: la pieza que faltaba para poder pagar POR STATEMENT.
//
// Hasta ahora el statement era solo una cabecera con su total. Para que al seleccionarlo se
// marquen solas las órdenes de trabajo y las notas que le corresponden, hace falta saber qué
// trae cada renglón: su requisición, su parte, y a qué orden u a qué nota fue a dar.
//
// La clasificación viene del cruce que ya validamos contra las órdenes:
//   INSTALLED  la parte se instaló y tiene su orden -> es obligación a pagar
//   RETURNED   se devolvió -> nació nota de débito, su crédito llega después
//   CREDIT     renglón de un memo de crédito -> nota de crédito
//   ACCESSORY  moldura o primer que viaja con el vidrio de su misma requisición
//   UNDECIDED  sin orden y sin crédito -> hay que decidir si va a técnico, compañía o pérdida
//
// La nota se resuelve por invoice_number, que es justo la requisición (débitos) o el número
// del crédito (Z…). --apply para escribir; sin el flag solo simula.

const APPLY = process.argv.includes("--apply");
const ORIGEN = process.argv.find((a) => a.startsWith("--from="))?.slice(7);

const DDL = `
  CREATE TABLE IF NOT EXISTS distributor_statement_line (
    id             BIGSERIAL PRIMARY KEY,
    statement_id   BIGINT NOT NULL REFERENCES distributor_statement(id) ON DELETE CASCADE,
    req_no         TEXT,
    line_date      DATE,
    qty            NUMERIC(10,2) NOT NULL DEFAULT 1,
    part_number    TEXT,
    amount         NUMERIC(12,2) NOT NULL DEFAULT 0,
    customer_name  TEXT,
    work_order_no  TEXT,
    note_id        BIGINT REFERENCES credit_debit_note(id) ON DELETE SET NULL,
    classification TEXT NOT NULL DEFAULT 'UNDECIDED',
    match_source   TEXT,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE INDEX IF NOT EXISTS statement_line_statement ON distributor_statement_line (statement_id);
  CREATE INDEX IF NOT EXISTS statement_line_wo ON distributor_statement_line (work_order_no);
  CREATE UNIQUE INDEX IF NOT EXISTS statement_line_unica
    ON distributor_statement_line (statement_id, upper(COALESCE(req_no, '')), upper(COALESCE(part_number, '')));
`;

const CLASE = {
  instalada: "INSTALLED",
  devuelta: "RETURNED",
  creditoMemo: "CREDIT",
  accesorio: "ACCESSORY",
  sinOrden: "UNDECIDED",
};
const iso = (f) => {
  const m = String(f || "").match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (!m) return null;
  return `${m[3].length === 2 ? "20" + m[3] : m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
};

(async () => {
  if (!ORIGEN || !fs.existsSync(ORIGEN)) {
    console.error("Pasa el JSON de clasificación con --from=<ruta a clasificacion.json>");
    process.exit(1);
  }
  const cats = JSON.parse(fs.readFileSync(ORIGEN, "utf8"));
  const renglones = [];
  for (const [clase, lista] of Object.entries(cats)) {
    for (const l of lista) {
      if (!l.factura) continue;
      renglones.push({ ...l, clasificacion: CLASE[clase] || "UNDECIDED" });
    }
  }

  const statements = new Map(
    (await pool.query("SELECT id, upper(invoice_number) n FROM distributor_statement WHERE active")).rows
      .map((r) => [r.n, r.id])
  );
  const conStatement = renglones.filter((l) => statements.has(String(l.factura).toUpperCase()));
  const huerfanos = renglones.length - conStatement.length;

  const porClase = {};
  conStatement.forEach((l) => { porClase[l.clasificacion] = (porClase[l.clasificacion] || 0) + 1; });
  console.log(`Renglones con factura: ${renglones.length} · con statement en la tabla: ${conStatement.length} · sin statement: ${huerfanos}`);
  Object.entries(porClase).sort().forEach(([k, v]) => console.log(`   ${k}: ${v}`));
  console.log(`   de los INSTALLED/ACCESSORY, ${conStatement.filter((l) => l.orden).length} traen orden de trabajo`);

  if (!APPLY) { console.log("\nSimulación. Volver a lanzar con --apply para escribir."); await pool.end(); return; }

  await pool.query(DDL);
  console.log("\nTabla distributor_statement_line lista.");

  const client = await pool.connect();
  let n = 0;
  try {
    await client.query("BEGIN");
    for (const l of conStatement) {
      await client.query(
        `INSERT INTO distributor_statement_line
           (statement_id, req_no, line_date, qty, part_number, amount, customer_name,
            work_order_no, note_id, classification, match_source)
         VALUES ($1,$2,$3::date,$4,$5,$6,$7,$8,
                 (SELECT id FROM credit_debit_note
                   WHERE active AND upper(invoice_number) = upper($2)
                     AND status NOT IN ('Void','Cancelled') LIMIT 1),
                 $9,$10)
         ON CONFLICT DO NOTHING`,
        [
          statements.get(String(l.factura).toUpperCase()), l.req, iso(l.fecha), l.qty || 1,
          l.parte, Math.abs(Number(l.net || 0)), l.cliente || null,
          l.orden || null, l.clasificacion, l.via || null,
        ]
      );
      n++;
    }
    await client.query("COMMIT");
  } catch (e) { await client.query("ROLLBACK"); throw e; } finally { client.release(); }

  const r = await pool.query(`
    SELECT classification, count(*)::int n,
           count(work_order_no)::int con_orden, count(note_id)::int con_nota,
           SUM(amount) monto
      FROM distributor_statement_line GROUP BY 1 ORDER BY 1`);
  console.log(`Renglones cargados: ${n}`);
  r.rows.forEach((x) =>
    console.log(`   ${x.classification.padEnd(10)} ${String(x.n).padStart(4)}  $${Number(x.monto).toFixed(2).padStart(10)}  ${x.con_orden} con orden · ${x.con_nota} con nota`));
  await pool.end();
})().catch((e) => { console.error("FALLA:", e.message); process.exit(1); });
