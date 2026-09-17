const pool = require("../config/db");
const { formatDate, formatTimestamp } = require("../lib/sqlMappers");

// Los statements del distribuidor, desde que LLEGAN y no desde que se pagan.
//
// Con 60 días de crédito en Mygrant, una factura vive dos meses antes de tocar un pago. Antes eso
// era invisible: `payouts.invoices` solo existe una vez saldado el pago, así que no había forma de
// contestar "¿cuánto le debo hoy a Mygrant?". Esta tabla es esa respuesta.
//
// Un memo de crédito (kind CREDIT_MEMO, monto negativo) en estado 'pending' es, literalmente, una
// nota de crédito que el distribuidor ya emitió y que todavía no se descuenta de ningún pago.
// Por eso el saldo se calcula sumando ambos: facturas por pagar MENOS créditos por aplicar.

const PLAZO_DEFAULT = 60;
const ESTADOS = ["pending", "partial", "paid"];

function mapStatement(row) {
  if (!row) return null;
  const monto = Number(row.amount || 0);
  const pagado = Number(row.paid_amount || 0);
  return {
    id: String(row.id),
    invoiceNumber: row.invoice_number,
    distributor: row.distributor || "",
    branch: row.branch || "",
    kind: row.kind,
    isCreditMemo: row.kind === "CREDIT_MEMO",
    issueDate: formatDate(row.issue_date),
    dueDate: formatDate(row.due_date),
    amount: monto,
    paidAmount: pagado,
    balance: Math.round((monto - pagado) * 100) / 100,
    status: row.status,
    payoutId: row.payout_id ? String(row.payout_id) : null,
    paymentNumber: row.payment_number || null,
    termsDays: row.terms_days ?? PLAZO_DEFAULT,
    daysOverdue: row.days_overdue == null ? null : Number(row.days_overdue),
    source: row.source || null,
    notes: row.notes || null,
    createdAt: formatTimestamp(row.created_at),
    updatedAt: formatTimestamp(row.updated_at),
  };
}

const SELECT = `
  SELECT s.*, p.payment_number,
         CASE WHEN s.status <> 'paid' AND s.due_date IS NOT NULL
              THEN (CURRENT_DATE - s.due_date) END AS days_overdue
    FROM distributor_statement s
    LEFT JOIN payouts p ON p.id = s.payout_id`;

async function list(filtros = {}) {
  const where = ["s.active"];
  const args = [];
  // Devuelve el marcador ($1, $2…) del valor recién agregado, para poder reusarlo en varias
  // columnas sin volver a pasarlo.
  const par = (val) => { args.push(val); return `$${args.length}`; };

  if (filtros.status && ESTADOS.includes(filtros.status)) where.push(`s.status = ${par(filtros.status)}`);
  if (filtros.pendientes === true) where.push("s.status <> 'paid'");
  if (filtros.kind) where.push(`s.kind = ${par(filtros.kind)}`);
  if (filtros.distributor) where.push(`s.distributor ILIKE ${par(`%${filtros.distributor}%`)}`);
  // La búsqueda entra también al DETALLE, no solo a la cabecera. La pregunta real de Antonio no
  // es "¿existe esta factura?" sino "¿en qué statement quedó esta parte?" — y con el número de
  // parte, la requisición o la orden en la mano, buscar por número de factura no sirve de nada.
  if (filtros.search) {
    const p = par(`%${filtros.search}%`);
    where.push(`(s.invoice_number ILIKE ${p} OR s.distributor ILIKE ${p} OR s.branch ILIKE ${p}
                 OR EXISTS (SELECT 1 FROM distributor_statement_line l
                             WHERE l.statement_id = s.id
                               AND (l.part_number ILIKE ${p} OR l.req_no ILIKE ${p}
                                    OR l.work_order_no ILIKE ${p} OR l.customer_name ILIKE ${p})))`);
  }
  if (filtros.from) where.push(`s.issue_date >= ${par(filtros.from)}::date`);
  if (filtros.to) where.push(`s.issue_date <= ${par(filtros.to)}::date`);

  const sqlWhere = where.join(" AND ");

  const limit = Math.min(Number(filtros.limit) || 200, 1000);
  const offset = Math.max(Number(filtros.offset) || 0, 0);
  const r = await pool.query(
    `${SELECT} WHERE ${sqlWhere} ORDER BY s.issue_date DESC NULLS LAST, s.invoice_number DESC LIMIT ${limit} OFFSET ${offset}`,
    args
  );
  const total = await pool.query(
    `SELECT count(*)::int n, COALESCE(SUM(s.amount - s.paid_amount), 0) saldo
       FROM distributor_statement s WHERE ${sqlWhere}`,
    args
  );
  const statements = r.rows.map(mapStatement);

  // Y devuelve QUÉ renglón coincidió. Encontrar el statement es media respuesta: si la búsqueda
  // fue por una parte, lo que hace falta ver es esa parte —su requisición, su monto, a qué orden
  // fue— sin tener que abrir cada factura a mano.
  if (filtros.search && statements.length) {
    const coincidencias = await pool.query(
      `SELECT l.statement_id, l.req_no, l.part_number, l.amount, l.work_order_no, l.customer_name,
              l.classification, w.id AS work_order_id
         FROM distributor_statement_line l
         LEFT JOIN work_orders w ON w.work_order_no = l.work_order_no AND w.active <> false
        WHERE l.statement_id = ANY($1::bigint[])
          AND (l.part_number ILIKE $2 OR l.req_no ILIKE $2 OR l.work_order_no ILIKE $2 OR l.customer_name ILIKE $2)
        ORDER BY l.statement_id, l.amount DESC`,
      [statements.map((s) => Number(s.id)), `%${filtros.search}%`]
    );
    const porStatement = new Map();
    for (const l of coincidencias.rows) {
      const k = String(l.statement_id);
      if (!porStatement.has(k)) porStatement.set(k, []);
      porStatement.get(k).push({
        reqNo: l.req_no,
        partNumber: l.part_number,
        amount: Number(l.amount || 0),
        workOrderNo: l.work_order_no,
        workOrderId: l.work_order_id != null ? String(l.work_order_id) : null,
        customerName: l.customer_name || "",
        classification: l.classification,
      });
    }
    for (const s of statements) s.matchedLines = porStatement.get(s.id) || [];
  }

  return {
    statements,
    total: total.rows[0].n,
    balance: Number(total.rows[0].saldo),
  };
}

async function get(id) {
  const r = await pool.query(`${SELECT} WHERE s.id = $1`, [id]);
  return mapStatement(r.rows[0]);
}

// La pregunta que motivó todo esto: cuánto le debemos, en cuántos statements, y qué notas
// siguen sin aplicarse.
async function summary(distribuidor) {
  const filtro = distribuidor ? "AND s.distributor ILIKE $1" : "";
  const args = distribuidor ? [`%${distribuidor}%`] : [];

  const saldos = (await pool.query(`
    SELECT
      count(*) FILTER (WHERE s.kind = 'INVOICE'     AND s.status <> 'paid')::int         AS facturas_n,
      COALESCE(SUM(s.amount - s.paid_amount) FILTER (WHERE s.kind = 'INVOICE'     AND s.status <> 'paid'), 0) AS facturas_monto,
      count(*) FILTER (WHERE s.kind = 'CREDIT_MEMO' AND s.status <> 'paid')::int         AS memos_n,
      COALESCE(SUM(s.amount - s.paid_amount) FILTER (WHERE s.kind = 'CREDIT_MEMO' AND s.status <> 'paid'), 0) AS memos_monto,
      count(*) FILTER (WHERE s.status = 'partial')::int                                  AS parciales_n,
      COALESCE(SUM(s.amount - s.paid_amount) FILTER (WHERE s.status = 'partial'), 0)     AS parciales_saldo
      FROM distributor_statement s WHERE s.active ${filtro}`, args)).rows[0];

  // Antigüedad contra el plazo pactado: lo vencido primero, que es lo que urge.
  const aging = (await pool.query(`
    SELECT
      count(*) FILTER (WHERE s.due_date < CURRENT_DATE)::int                                          AS vencido_n,
      COALESCE(SUM(s.amount - s.paid_amount) FILTER (WHERE s.due_date < CURRENT_DATE), 0)             AS vencido_monto,
      count(*) FILTER (WHERE s.due_date BETWEEN CURRENT_DATE AND CURRENT_DATE + 15)::int              AS pronto_n,
      COALESCE(SUM(s.amount - s.paid_amount) FILTER (WHERE s.due_date BETWEEN CURRENT_DATE AND CURRENT_DATE + 15), 0) AS pronto_monto,
      count(*) FILTER (WHERE s.due_date > CURRENT_DATE + 15)::int                                     AS holgado_n,
      COALESCE(SUM(s.amount - s.paid_amount) FILTER (WHERE s.due_date > CURRENT_DATE + 15), 0)        AS holgado_monto,
      MIN(s.due_date) FILTER (WHERE s.due_date < CURRENT_DATE)                                        AS mas_vieja
      FROM distributor_statement s
     WHERE s.active AND s.status <> 'paid' AND s.kind = 'INVOICE' ${filtro}`, args)).rows[0];

  // Las notas: un débito 'Active' es una parte facturada que todavía no tiene destino; un débito
  // devuelto sin su crédito es dinero que el distribuidor aún no regresa.
  const notas = (await pool.query(`
    SELECT
      count(*) FILTER (WHERE n.kind = 'DEBIT' AND n.status = 'Active')::int                       AS debitos_n,
      COALESCE(SUM(n.amount) FILTER (WHERE n.kind = 'DEBIT' AND n.status = 'Active'), 0)          AS debitos_monto,
      count(*) FILTER (WHERE n.kind = 'DEBIT' AND n.status = 'Active'
                         AND COALESCE(n.resolution, '') = 'RETURNED')::int                        AS por_acreditar_n,
      COALESCE(SUM(n.amount) FILTER (WHERE n.kind = 'DEBIT' AND n.status = 'Active'
                         AND COALESCE(n.resolution, '') = 'RETURNED'), 0)                         AS por_acreditar_monto,
      count(*) FILTER (WHERE n.kind = 'DEBIT' AND n.status = 'Active' AND n.payout_id IS NULL)::int AS sin_pago_n
      FROM credit_debit_note n
     WHERE n.active AND n.entity_type = 'DISTRIBUTOR' AND n.status NOT IN ('Void','Cancelled')`)).rows[0];

  const porPagar = Number(saldos.facturas_monto);
  const porAplicar = Math.abs(Number(saldos.memos_monto));
  return {
    porPagar: { statements: saldos.facturas_n, monto: Math.round(porPagar * 100) / 100 },
    creditosPorAplicar: { statements: saldos.memos_n, monto: Math.round(porAplicar * 100) / 100 },
    neto: Math.round((porPagar - porAplicar) * 100) / 100,
    parciales: { statements: saldos.parciales_n, saldo: Math.round(Number(saldos.parciales_saldo) * 100) / 100 },
    vencimiento: {
      vencido: { statements: aging.vencido_n, monto: Math.round(Number(aging.vencido_monto) * 100) / 100 },
      proximo: { statements: aging.pronto_n, monto: Math.round(Number(aging.pronto_monto) * 100) / 100 },
      holgado: { statements: aging.holgado_n, monto: Math.round(Number(aging.holgado_monto) * 100) / 100 },
      masVieja: formatDate(aging.mas_vieja),
    },
    notas: {
      debitosAbiertos: { notas: notas.debitos_n, monto: Math.round(Number(notas.debitos_monto) * 100) / 100 },
      creditoPorRecibir: { notas: notas.por_acreditar_n, monto: Math.round(Number(notas.por_acreditar_monto) * 100) / 100 },
      sinPagoAsignado: notas.sin_pago_n,
    },
  };
}

// Saldo abierto por distribuidor, de mayor a menor.
async function byDistributor() {
  const r = await pool.query(`
    SELECT COALESCE(NULLIF(btrim(s.distributor), ''), 'Sin distribuidor') AS distribuidor,
           count(*) FILTER (WHERE s.kind = 'INVOICE')::int                AS facturas,
           count(*) FILTER (WHERE s.kind = 'CREDIT_MEMO')::int            AS memos,
           COALESCE(SUM(s.amount - s.paid_amount), 0)                     AS saldo,
           MIN(s.due_date)                                                AS vence
      FROM distributor_statement s
     WHERE s.active AND s.status <> 'paid'
     GROUP BY 1 ORDER BY saldo DESC`);
  return r.rows.map((x) => ({
    distributor: x.distribuidor,
    invoices: x.facturas,
    creditMemos: x.memos,
    balance: Math.round(Number(x.saldo) * 100) / 100,
    nextDue: formatDate(x.vence),
  }));
}

function normalizar(data, previo = {}) {
  const monto = data.amount != null ? Number(data.amount) : Number(previo.amount || 0);
  const kind = data.kind || previo.kind || (monto < 0 ? "CREDIT_MEMO" : "INVOICE");
  const plazo = data.termsDays != null ? Number(data.termsDays) : previo.terms_days ?? PLAZO_DEFAULT;
  const emision = data.issueDate ?? previo.issue_date ?? null;
  return { monto, kind, plazo, emision };
}

async function create(data, usuario) {
  const numero = String(data.invoiceNumber || "").trim();
  if (!numero) throw new Error("El número de factura es obligatorio");
  const { monto, kind, plazo, emision } = normalizar(data);
  const r = await pool.query(
    `INSERT INTO distributor_statement
       (invoice_number, distributor, branch, kind, issue_date, due_date, amount, paid_amount,
        status, terms_days, source, notes)
     VALUES ($1,$2,$3,$4,$5::date, COALESCE($6::date, $5::date + $7::int), $8, 0, 'pending', $7::int, $9, $10)
     ON CONFLICT (upper(invoice_number)) WHERE active DO UPDATE
        SET distributor = EXCLUDED.distributor, branch = EXCLUDED.branch, kind = EXCLUDED.kind,
            issue_date = EXCLUDED.issue_date, due_date = EXCLUDED.due_date,
            amount = EXCLUDED.amount, notes = EXCLUDED.notes, updated_at = now()
     RETURNING id`,
    [numero, data.distributor || null, data.branch || null, kind, emision, data.dueDate || null,
     plazo, monto, data.source || `manual:${usuario || "sistema"}`, data.notes || null]
  );
  return get(r.rows[0].id);
}

// Guarda los renglones de un statement. Se borran y reescriben: reimportar el mismo archivo
// debe dejar el detalle como dice el archivo, no acumular copias.
async function replaceLines(statementId, lineas = []) {
  if (!lineas.length) return 0;
  // El renglón lleva el MISMO signo que su statement: en un memo de crédito la cabecera es
  // negativa y sus renglones también. Guardarlos en positivo (como se hizo al principio) hacía
  // que la suma del detalle no cuadrara con su cabecera y aparentara un descuadre de $10,593.50
  // que no existía — era el doble del valor de los créditos.
  //
  // Pero forzar el signo A CIEGAS rompe el caso contrario: un memo de crédito trae renglones de
  // "Return Surcharge" que son CARGO — positivos dentro de un documento negativo. Voltearlos
  // descuadraba el memo por el doble del recargo (I05014389-0 por $33.52, I05092522-0 por
  // $24.08). Así que primero se le cree al archivo: si los renglones tal como vienen ya suman su
  // cabecera, se guardan tal cual. Normalizar queda solo para el archivo que no trae signo.
  const cabecera = (await pool.query("SELECT kind, amount FROM distributor_statement WHERE id = $1", [statementId])).rows[0];
  const signo = cabecera?.kind === "CREDIT_MEMO" ? -1 : 1;
  const sumaTalCual = lineas.reduce((s, l) => s + Number(l.amount || 0), 0);
  const respetarSignos = Math.abs(sumaTalCual - Number(cabecera?.amount || 0)) < 0.005;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("DELETE FROM distributor_statement_line WHERE statement_id = $1", [statementId]);
    for (const l of lineas) {
      await client.query(
        `INSERT INTO distributor_statement_line
           (statement_id, req_no, line_date, qty, part_number, amount, customer_name,
            work_order_no, note_id, classification, match_source, related_ref)
         VALUES ($1,$2,$3::date,$4,$5,$6,$7,$8,
                 (SELECT id FROM credit_debit_note
                   WHERE active AND upper(invoice_number) = upper($2)
                     AND status NOT IN ('Void','Cancelled') LIMIT 1),
                 $9,$10,$11)
         ON CONFLICT DO NOTHING`,
        [statementId, l.reqNo || null, l.date || null, l.qty || 1, l.partNumber || null,
         respetarSignos ? Number(l.amount || 0) : signo * Math.abs(Number(l.amount || 0)),
         l.customerName || null, l.workOrderNo || null,
         l.classification || "UNDECIDED", l.matchSource || null, l.relatedRef || null]
      );
    }
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
  return lineas.length;
}

// Carga por lote de un statement completo. Devuelve qué se creó y qué ya existía, sin abortar
// por un duplicado: reimportar el mismo archivo debe ser inofensivo.
async function importMany(filas = [], usuario) {
  const resultado = { creados: 0, actualizados: 0, renglones: 0, errores: [] };
  for (const fila of filas) {
    try {
      const numero = String(fila.invoiceNumber || "").trim();
      if (!numero) { resultado.errores.push({ fila, error: "Sin número de factura" }); continue; }
      const previo = await pool.query(
        "SELECT id FROM distributor_statement WHERE active AND upper(invoice_number) = upper($1)", [numero]);
      const guardado = await create(fila, usuario);
      if (previo.rowCount) resultado.actualizados += 1; else resultado.creados += 1;
      if (Array.isArray(fila.lines) && fila.lines.length) {
        resultado.renglones += await replaceLines(guardado.id, fila.lines);
      }
    } catch (err) {
      resultado.errores.push({ fila: { invoiceNumber: fila.invoiceNumber }, error: err.message });
    }
  }
  return resultado;
}

async function update(id, data, usuario) {
  const previo = (await pool.query("SELECT * FROM distributor_statement WHERE id = $1", [id])).rows[0];
  if (!previo) return null;
  const { monto, kind, plazo, emision } = normalizar(data, previo);
  await pool.query(
    `UPDATE distributor_statement
        SET invoice_number = COALESCE($2, invoice_number),
            distributor = COALESCE($3, distributor), branch = COALESCE($4, branch),
            kind = $5, issue_date = $6::date,
            due_date = COALESCE($7::date, $6::date + $8::int),
            amount = $9, terms_days = $8::int, notes = COALESCE($10, notes),
            source = COALESCE(source, $11), updated_at = now()
      WHERE id = $1`,
    [id, data.invoiceNumber ? String(data.invoiceNumber).trim() : null, data.distributor ?? null,
     data.branch ?? null, kind, emision, data.dueDate || null, plazo, monto,
     data.notes ?? null, `manual:${usuario || "sistema"}`]
  );
  return get(id);
}

// Aplicar statements a un pago: los marca saldados (o parciales si el pago cubre solo una parte).
// El caso parcial es real — Mygrant aplicó $1,500.00 contra una factura de $2,915.57 y dejó saldo.
async function applyToPayout(ids = [], payoutId, montos = {}) {
  const client = await pool.connect();
  const tocados = [];
  try {
    await client.query("BEGIN");
    for (const id of ids) {
      const s = (await client.query("SELECT * FROM distributor_statement WHERE id = $1 FOR UPDATE", [id])).rows[0];
      if (!s) continue;
      const total = Number(s.amount);
      const aplica = montos[id] != null ? Number(montos[id]) : total - Number(s.paid_amount);
      const pagado = Math.round((Number(s.paid_amount) + aplica) * 100) / 100;
      const estado = Math.abs(pagado - total) < 0.005 ? "paid" : pagado === 0 ? "pending" : "partial";
      await client.query(
        `UPDATE distributor_statement SET paid_amount = $2, status = $3, payout_id = $4, updated_at = now()
          WHERE id = $1`, [id, pagado, estado, payoutId || s.payout_id]);
      tocados.push(id);
    }
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
  if (payoutId && tocados.length) await listarEnElPago(payoutId, tocados);
  const r = await pool.query(`${SELECT} WHERE s.id = ANY($1::bigint[])`, [tocados]);
  return r.rows.map(mapStatement);
}

// Las facturas que un pago salda también van en SU lista de facturas (payouts.invoices), con el
// total facturado que de ahí sale. Armar el pago marcando statements las dejaba ligadas pero la
// lista del pago quedaba vacía, y sin total facturado no hay contra qué cuadrar el lote (Antonio,
// 17-sep-2026). No pisa lo ya capturado: una factura que el pago ya lista conserva su PDF.
async function listarEnElPago(payoutId, statementIds) {
  const p = (await pool.query("SELECT type, invoices FROM payouts WHERE id = $1", [Number(payoutId)])).rows[0];
  if (!p || p.type !== "DISTRIBUTOR") return;
  const facturas = Array.isArray(p.invoices) ? [...p.invoices] : [];
  const st = (await pool.query(
    "SELECT invoice_number, issue_date, amount::float AS amount FROM distributor_statement WHERE id = ANY($1::bigint[]) ORDER BY issue_date, invoice_number",
    [statementIds])).rows;
  let cambio = false;
  for (const x of st) {
    const num = String(x.invoice_number || "").trim();
    if (!num || facturas.some((f) => String(f.number || "").trim().toUpperCase() === num.toUpperCase())) continue;
    facturas.push({ date: formatDate(x.issue_date) || "", number: num, amount: Number(x.amount), attachment: null });
    cambio = true;
  }
  if (!cambio) return;
  const total = Math.round(facturas.reduce((a, f) => a + Number(f.amount || 0), 0) * 100) / 100;
  await pool.query("UPDATE payouts SET invoices = $2::jsonb, invoice_total = $3, updated_at = now() WHERE id = $1",
    [Number(payoutId), JSON.stringify(facturas), total]);
}

async function remove(id, usuario) {
  const r = await pool.query(
    `UPDATE distributor_statement SET active = false, updated_at = now(),
            notes = COALESCE(notes, '') || $2 WHERE id = $1 RETURNING id`,
    [id, `\n[retirado por ${usuario || "sistema"}]`]);
  return r.rowCount > 0;
}

// El detalle de un statement: qué trae cada renglón y a dónde fue a dar.
async function lines(statementId) {
  const r = await pool.query(
    // El cliente sale de la ORDEN cuando el statement no lo trae. Mygrant lo escribe sólo en
    // algunos renglones —la mayoría llegan en blanco— y quien lee esta tabla reconoce el trabajo
    // por el cliente, no por la requisición. Si el renglón ya está enganchado a una orden, el
    // nombre existe: no había por qué mostrarlo vacío.
    //
    // La nota se busca también por la requisición, no sólo por note_id. El vínculo por id se
    // escribe al importar, así que un renglón cuya nota nació DESPUÉS —que es como se trabaja:
    // primero llega el statement, luego se decide a quién se le cobra— se quedaba sin mostrarla.
    `SELECT l.*, COALESCE(n.note_number, n2.note_number) AS note_number,
            COALESCE(n.kind, n2.kind) AS note_kind,
            COALESCE(n.id, n2.id) AS note_real_id,
            w.id AS work_order_uuid,
            COALESCE(NULLIF(btrim(l.customer_name), ''), w.customer_name) AS cliente,
            cred.req_no AS credito_req, cred.memo AS credito_memo
       FROM distributor_statement_line l
       LEFT JOIN credit_debit_note n ON n.id = l.note_id
       LEFT JOIN LATERAL (
         SELECT c.id, c.note_number, c.kind FROM credit_debit_note c
          WHERE l.note_id IS NULL AND c.active AND c.status NOT IN ('Void', 'Cancelled')
            AND upper(btrim(c.invoice_number)) = upper(btrim(l.req_no))
          ORDER BY c.id LIMIT 1
       ) n2 ON true
       -- Dónde se aplicó la devolución. El memo de crédito guarda de qué compra viene
       -- (related_ref), así que la respuesta ya estaba escrita: sólo faltaba leerla al revés.
       -- Es el mismo dato que el renglón de crédito muestra como "viene de la compra X", visto
       -- desde el otro lado (pedido de Antonio, 4-sep-2026).
       LEFT JOIN LATERAL (
         SELECT c.req_no, cs.invoice_number AS memo
           FROM distributor_statement_line c
           JOIN distributor_statement cs ON cs.id = c.statement_id
          WHERE c.classification = 'CREDIT'
            AND upper(btrim(c.related_ref)) = upper(btrim(l.req_no))
          ORDER BY c.id LIMIT 1
       ) cred ON true
       LEFT JOIN work_orders w ON w.work_order_no = l.work_order_no AND w.active <> false
      WHERE l.statement_id = $1
      ORDER BY l.line_date NULLS LAST, l.req_no`,
    [statementId]
  );
  return r.rows.map((x) => ({
    id: String(x.id),
    reqNo: x.req_no,
    date: formatDate(x.line_date),
    qty: Number(x.qty),
    partNumber: x.part_number,
    amount: Number(x.amount),
    customerName: x.cliente || "",
    workOrderNo: x.work_order_no,
    workOrderId: x.work_order_uuid || null,
    noteId: x.note_real_id ? String(x.note_real_id) : null,
    noteNumber: x.note_number || null,
    noteKind: x.note_kind || null,
    classification: x.classification,
    matchSource: x.match_source,
    relatedRef: x.related_ref || null,
    // La devolución, vista desde la compra: qué renglón de crédito la cubrió y en qué memo.
    creditedBy: x.credito_req || null,
    creditedIn: x.credito_memo || null,
  }));
}

// Qué facturó el distribuidor por las partes de ESTA orden: la factura de Mygrant, la
// requisición con que se pidió y cuánto costó. Cierra el círculo — desde la orden se ve qué
// statement pagó su vidrio, sin ir a buscarlo.
async function forWorkOrder(workOrderNo) {
  const r = await pool.query(
    `SELECT l.req_no, l.part_number, l.amount, l.line_date, l.classification,
            s.invoice_number, s.distributor, s.branch, s.status AS statement_status,
            p.payment_number
       FROM distributor_statement_line l
       JOIN distributor_statement s ON s.id = l.statement_id AND s.active
       LEFT JOIN payouts p ON p.id = s.payout_id
      WHERE l.work_order_no = $1
      ORDER BY l.line_date, l.req_no`,
    [workOrderNo]
  );
  return r.rows.map((x) => ({
    reqNo: x.req_no,
    partNumber: x.part_number,
    amount: Number(x.amount),
    date: formatDate(x.line_date),
    classification: x.classification,
    invoiceNumber: x.invoice_number,
    distributor: x.distributor || "",
    branch: x.branch || "",
    statementStatus: x.statement_status,
    paymentNumber: x.payment_number || null,
  }));
}

// Todos los renglones POR DECIDIR, de todos los statements: la lista de trabajo de Antonio.
// Cada uno es una parte facturada sin salida — ni orden, ni nota, ni crédito — y necesita una
// decisión: cargo a técnico, gasto de taller o pérdida.
async function undecidedLines() {
  const r = await pool.query(
    `SELECT l.id, l.req_no, l.line_date, l.part_number, l.amount, l.customer_name,
            s.invoice_number, s.distributor, s.branch, s.status AS statement_status,
            s.payout_id, p.payment_number
       FROM distributor_statement_line l
       JOIN distributor_statement s ON s.id = l.statement_id
       LEFT JOIN payouts p ON p.id = s.payout_id
      WHERE l.classification = 'UNDECIDED' AND s.active
      ORDER BY l.line_date DESC NULLS LAST, s.invoice_number, l.req_no`
  );
  return r.rows.map((x) => ({
    id: String(x.id),
    reqNo: x.req_no,
    date: formatDate(x.line_date),
    partNumber: x.part_number,
    amount: Number(x.amount),
    customerName: x.customer_name || "",
    invoiceNumber: x.invoice_number,
    distributor: x.distributor || "",
    branch: x.branch || "",
    statementStatus: x.statement_status,
    paymentNumber: x.payment_number || null,
    payoutId: x.payout_id ? String(x.payout_id) : null,
  }));
}

// Lo que se necesita para armar el pago desde los statements elegidos: las obligaciones de sus
// órdenes de trabajo y las notas que nacieron o se aplican en ellos, listas para marcar.
//
// Devuelve además lo que NO alcanzó a cubrirse — renglones sin orden, o con orden pero sin
// obligación pendiente — porque esa diferencia es justo lo que hay que revisar antes de pagar.
async function selection(statementIds = []) {
  if (!statementIds.length) {
    return { statements: [], payableIds: [], noteIds: [], totals: { statements: 0, payables: 0, debits: 0, credits: 0, undecided: 0 }, gaps: [] };
  }
  const cabeceras = (await pool.query(
    `SELECT id, invoice_number, distributor, kind, amount, status FROM distributor_statement
      WHERE active AND id = ANY($1::bigint[])`, [statementIds])).rows;

  const renglones = (await pool.query(
    `SELECT l.*, s.invoice_number, s.distributor
       FROM distributor_statement_line l
       JOIN distributor_statement s ON s.id = l.statement_id
      WHERE l.statement_id = ANY($1::bigint[])`, [statementIds])).rows;

  const ordenes = [...new Set(renglones.map((l) => l.work_order_no).filter(Boolean))];
  // Solo obligaciones que siguen pendientes: una ya pagada no puede volver a entrar en un lote.
  const obligaciones = ordenes.length
    ? (await pool.query(
        `SELECT id, work_order_no, party, amount FROM payable
          WHERE kind = 'DISTRIBUTOR' AND payout_id IS NULL AND status <> 'pagado'
            AND work_order_no = ANY($1::text[])`, [ordenes])).rows
    : [];

  const notas = [...new Set(renglones.map((l) => l.note_id).filter(Boolean))];
  const notasVivas = notas.length
    ? (await pool.query(
        `SELECT id, note_number, kind, amount, payout_id FROM credit_debit_note
          WHERE active AND status NOT IN ('Void','Cancelled') AND id = ANY($1::bigint[])`, [notas])).rows
    : [];

  const conObligacion = new Set(obligaciones.map((o) => o.work_order_no));
  const gaps = [];
  for (const l of renglones) {
    if (l.classification === "UNDECIDED") {
      gaps.push({ invoice: l.invoice_number, reqNo: l.req_no, partNumber: l.part_number, amount: Number(l.amount), reason: "sin orden ni crédito" });
    } else if (l.work_order_no && !conObligacion.has(l.work_order_no)) {
      gaps.push({ invoice: l.invoice_number, reqNo: l.req_no, partNumber: l.part_number, amount: Number(l.amount), workOrderNo: l.work_order_no, reason: "su obligación ya fue pagada" });
    }
  }

  const suma = (a, f = (x) => Number(x.amount || 0)) => Math.round(a.reduce((s, x) => s + f(x), 0) * 100) / 100;
  return {
    statements: cabeceras.map((c) => ({
      id: String(c.id), invoiceNumber: c.invoice_number, distributor: c.distributor,
      kind: c.kind, amount: Number(c.amount), status: c.status,
      lines: renglones.filter((l) => String(l.statement_id) === String(c.id)).length,
    })),
    payableIds: obligaciones.map((o) => String(o.id)),
    noteIds: notasVivas.filter((n) => !n.payout_id).map((n) => String(n.id)),
    workOrders: [...new Set(obligaciones.map((o) => o.work_order_no))],
    // A quién se le deben esas obligaciones: la orden puede estar a nombre de OTRA sucursal que la
    // del statement, y para marcarlas en el armado del pago hay que abrir también a esa.
    parties: [...new Set([...obligaciones.map((o) => String(o.party || "").trim()), ...cabeceras.map((c) => String(c.distributor || "").trim())].filter(Boolean))],
    totals: {
      statements: suma(cabeceras),
      payables: suma(obligaciones),
      debits: suma(notasVivas.filter((n) => n.kind === "DEBIT")),
      credits: suma(notasVivas.filter((n) => n.kind === "CREDIT")),
      undecided: suma(renglones.filter((l) => l.classification === "UNDECIDED")),
    },
    gaps,
  };
}

// El desglose de las facturas de UN pago, renglón por renglón, con lo que cada renglón significa
// para ese pago: si su orden está dentro, en otro lote, pendiente, si se devolvió o si lo cubre una
// nota. Es el mismo detalle de Distributor Statements, leído desde el pago — no una copia: las
// facturas de `payouts.invoices` y los statements comparten número (Antonio, 17-sep-2026: quería
// cuadrar la factura contra partes instaladas y notas sin salir del pago).
async function forPayout(payoutId) {
  const id = Number(payoutId);
  const p = (await pool.query("SELECT id, type, invoices FROM payouts WHERE id = $1 AND active <> false", [id])).rows[0];
  if (!p || p.type !== "DISTRIBUTOR") return { invoices: [], totals: null };
  const capturadas = (Array.isArray(p.invoices) ? p.invoices : []).map((f) => ({
    number: String(f.number || "").trim(), amount: Number(f.amount || 0), date: f.date || null,
  })).filter((f) => f.number);

  const cab = (await pool.query(
    `SELECT id, invoice_number, distributor, branch, kind, issue_date, amount, status, payout_id
       FROM distributor_statement
      WHERE active AND (payout_id = $1 OR upper(btrim(invoice_number)) = ANY($2::text[]))
      ORDER BY issue_date NULLS LAST, invoice_number`,
    [id, capturadas.map((f) => f.number.toUpperCase())])).rows;

  // Todas las obligaciones de distribuidor de las órdenes que aparecen en los renglones, de una vez.
  const todas = [];
  // En paralelo: con la base remota, una factura tras otra eran ~0.4 s cada una.
  for (const [i, ls] of (await Promise.all(cab.map((c) => lines(c.id)))).entries()) {
    todas.push(...ls.map((l) => ({ ...l, statementId: String(cab[i].id) })));
  }
  const ordenes = [...new Set(todas.map((l) => l.workOrderNo).filter(Boolean))];
  const obs = ordenes.length
    ? (await pool.query(
        `SELECT y.id, y.work_order_no, y.party, y.amount::float AS amount, y.part_number, y.status, y.payout_id, o.payment_number
           FROM payable y LEFT JOIN payouts o ON o.id = y.payout_id
          WHERE y.kind = 'DISTRIBUTOR' AND y.status <> 'retirada' AND y.work_order_no = ANY($1::text[])`, [ordenes])).rows
    : [];
  const notasIds = [...new Set(todas.map((l) => l.noteId).filter(Boolean))];
  const notas = notasIds.length
    ? (await pool.query(
        `SELECT n.id, n.payout_id, o.payment_number FROM credit_debit_note n LEFT JOIN payouts o ON o.id = n.payout_id
          WHERE n.id = ANY($1::bigint[])`, [notasIds])).rows
    : [];
  const notaPor = new Map(notas.map((n) => [String(n.id), n]));

  // "DW02228 GTY SCM" en la factura es "DW02228 GTY" en la obligación: se compara por el arranque.
  const clave = (s) => String(s || "").toUpperCase().split(/[\s,]+/).filter(Boolean).slice(0, 2).join(" ");
  const usadas = new Set();
  const obligacionDe = (l) => {
    const suyas = obs.filter((o) => o.work_order_no === l.workOrderNo);
    const k = clave(l.partNumber);
    const libre = (o) => !usadas.has(o.id);
    const hit = suyas.find((o) => libre(o) && clave(o.part_number).split(" ")[0] === k.split(" ")[0] && k)
      || suyas.find((o) => libre(o) && Number(o.payout_id) === id)
      || suyas.find(libre) || suyas.find((o) => Number(o.payout_id) === id) || suyas[0] || null;
    if (hit) usadas.add(hit.id);
    return hit;
  };

  const delLote = (await pool.query(
    `SELECT y.id, y.work_order_no, y.amount::float AS amount, y.part_number, w.id AS work_order_id, w.customer_name
       FROM payable y LEFT JOIN work_orders w ON w.work_order_no = y.work_order_no AND w.active <> false
      WHERE y.payout_id = $1 AND y.kind = 'DISTRIBUTOR'`, [id])).rows;
  const r2 = (v) => Math.round(v * 100) / 100;
  const facturas = cab.map((c) => {
    const suyos = todas.filter((l) => l.statementId === String(c.id)).map((l) => {
      let state = "undecided";
      let ob = null;
      if (l.classification === "CREDIT") state = "credit";
      // Devuelta: lo dice la clasificación o, aunque diga "instalada", que exista un renglón de
      // crédito que apunta a esta compra (FW04708 de Wo-2425 en Dist-0212: comprada $535.92 y
      // acreditada completa). Sin esto la pieza devuelta se comía la obligación de otra pieza.
      else if (l.classification === "RETURNED" || l.creditedBy) state = "returned";
      else if (l.workOrderNo) {
        ob = obligacionDe(l);
        state = !ob ? "noObligation" : Number(ob.payout_id) === id ? "here" : ob.payout_id ? "otherPayout" : "pending";
      } else if (l.noteId) state = "note";
      else {
        // Sin orden en el statement, pero el pago trae una obligación de esa misma parte por ese
        // mismo monto: es la suya, sólo que el cruce del statement no la encontró (accesorios como
        // 5203 002 o FTUS08-75, que la orden no lleva en su número de parte).
        const k = clave(l.partNumber).split(" ")[0];
        ob = delLote.find((o) => !usadas.has(o.id) && Math.abs(Number(o.amount) - l.amount) < 0.005 && k && clave(o.part_number).split(" ")[0] === k) || null;
        if (ob) { usadas.add(ob.id); state = "here"; l = { ...l, workOrderNo: ob.work_order_no, workOrderId: ob.work_order_id || null, customerName: l.customerName || ob.customer_name || "", matchedByPart: true }; }
      }
      const nota = l.noteId ? notaPor.get(String(l.noteId)) : null;
      return {
        ...l, state,
        obligationAmount: ob ? Number(ob.amount) : null,
        otherPayout: ob && ob.payout_id && Number(ob.payout_id) !== id ? ob.payment_number || `#${ob.payout_id}` : null,
        noteHere: nota ? Number(nota.payout_id) === id : null,
        notePayout: nota && nota.payout_id && Number(nota.payout_id) !== id ? nota.payment_number || `#${nota.payout_id}` : null,
      };
    });
    const por = {};
    for (const l of suyos) por[l.state] = r2((por[l.state] || 0) + l.amount);
    const suma = r2(suyos.reduce((a, l) => a + l.amount, 0));
    return {
      id: String(c.id), invoiceNumber: c.invoice_number, distributor: c.distributor, branch: c.branch || "",
      kind: c.kind, issueDate: formatDate(c.issue_date), amount: Number(c.amount), status: c.status,
      linkedHere: Number(c.payout_id) === id,
      lines: suyos, linesTotal: suma, linesMatch: !suyos.length || Math.abs(suma - Number(c.amount)) < 0.01,
      byState: por,
    };
  });
  // Las capturadas en el pago que no existen como statement: se listan igual, sin renglones.
  const conocidas = new Set(facturas.map((f) => f.invoiceNumber.toUpperCase()));
  for (const f of capturadas) {
    if (!conocidas.has(f.number.toUpperCase())) {
      facturas.push({ id: null, invoiceNumber: f.number, distributor: "", branch: "", kind: f.amount < 0 ? "CREDIT_MEMO" : "INVOICE",
        issueDate: f.date, amount: f.amount, status: "", linkedHere: true, lines: [], linesTotal: 0, linesMatch: true, byState: {}, missing: true });
    }
  }
  // El otro lado del cuadre: obligaciones que el pago SÍ trae y que ninguna factura menciona. En
  // Dist-0212 son dos por $89.25 — justo los dos renglones sin decidir (5203 002 y FTUS08-75).
  const sinFactura = facturas.some((f) => f.lines.length)
    ? (await pool.query(
        `SELECT y.id, y.work_order_no, y.party, y.amount::float AS amount, y.part_number, w.id AS work_order_id, w.customer_name
           FROM payable y LEFT JOIN work_orders w ON w.work_order_no = y.work_order_no AND w.active <> false
          WHERE y.payout_id = $1 AND y.kind = 'DISTRIBUTOR' AND y.id <> ALL($2::bigint[])
          ORDER BY y.work_order_no`, [id, [...usadas]])).rows.map((y) => ({
        id: String(y.id), workOrderNo: y.work_order_no, workOrderId: y.work_order_id || null, customerName: y.customer_name || "",
        party: y.party || "", partNumber: y.part_number || "", amount: Number(y.amount),
      }))
    : [];
  const byState = {};
  for (const f of facturas) for (const [k, v] of Object.entries(f.byState)) byState[k] = r2((byState[k] || 0) + v);
  return {
    invoices: facturas,
    notOnInvoices: sinFactura,
    totals: { invoiced: r2(facturas.reduce((a, f) => a + f.amount, 0)), byState, notOnInvoices: r2(sinFactura.reduce((a, y) => a + y.amount, 0)) },
  };
}

// Antes de guardar lo leído desde un pago: qué se sabe ya de cada factura. Si ya tiene desglose
// (para no pisar correcciones hechas a mano), si está ligada a OTRO pago, y si el pago ya la lista.
async function annotateForPayout(payoutId, blocks = []) {
  const id = Number(payoutId);
  const p = (await pool.query("SELECT invoices FROM payouts WHERE id = $1", [id])).rows[0];
  const listadas = new Set((Array.isArray(p?.invoices) ? p.invoices : []).map((f) => String(f.number || "").trim().toUpperCase()));
  const numeros = blocks.map((b) => String(b.invoiceNumber || "").trim().toUpperCase()).filter(Boolean);
  const previos = numeros.length
    ? (await pool.query(
        `SELECT s.id, upper(btrim(s.invoice_number)) AS num, s.amount::float AS amount, s.payout_id, o.payment_number,
                (SELECT count(*) FROM distributor_statement_line l WHERE l.statement_id = s.id)::int AS lineas
           FROM distributor_statement s LEFT JOIN payouts o ON o.id = s.payout_id
          WHERE s.active AND upper(btrim(s.invoice_number)) = ANY($1::text[])`, [numeros])).rows
    : [];
  const por = new Map(previos.map((x) => [x.num, x]));
  return blocks.map((b) => {
    const num = String(b.invoiceNumber || "").trim().toUpperCase();
    const x = por.get(num);
    return {
      ...b,
      listedInPayout: listadas.has(num),
      existing: x ? {
        id: String(x.id), amount: x.amount, lines: x.lineas,
        otherPayout: x.payout_id && Number(x.payout_id) !== id ? x.payment_number || `#${x.payout_id}` : null,
      } : null,
    };
  });
}

// Guardar desde el pago las facturas leídas de sus PDFs: crea o actualiza el statement, lo liga a
// ESTE pago y la agrega a la lista de facturas del pago con su PDF — un solo paso en vez de capturar
// la factura a mano en el pago y subir el mismo PDF en Distributor Statements (Antonio, 17-sep-2026).
//
// Una factura que ya tiene renglones los CONSERVA salvo que se pida reemplazarlos: ahí pueden vivir
// correcciones hechas a mano (la orden de un renglón), y el cruce automático por parte+fecha las
// volvería a poner mal — así llegó Wo-3871 de Texas a una factura de Fresno.
async function attachToPayout(payoutId, entradas = [], usuario) {
  const id = Number(payoutId);
  const p = (await pool.query("SELECT id, type, status, invoices FROM payouts WHERE id = $1 AND active <> false", [id])).rows[0];
  if (!p) throw new Error("Payment not found");
  if (p.type !== "DISTRIBUTOR") throw new Error("Only distributor payments carry invoices");
  const facturas = Array.isArray(p.invoices) ? [...p.invoices] : [];
  const resultado = { saved: [], skipped: [] };

  for (const e of entradas) {
    const numero = String(e.invoiceNumber || "").trim();
    if (!numero) { resultado.skipped.push({ invoiceNumber: "", reason: "sin número de factura" }); continue; }
    const previo = (await pool.query(
      `SELECT s.id, s.payout_id, s.notes, o.payment_number,
              (SELECT count(*) FROM distributor_statement_line l WHERE l.statement_id = s.id)::int AS lineas
         FROM distributor_statement s LEFT JOIN payouts o ON o.id = s.payout_id
        WHERE s.active AND upper(btrim(s.invoice_number)) = upper($1)`, [numero])).rows[0];
    if (previo?.payout_id && Number(previo.payout_id) !== id) {
      resultado.skipped.push({ invoiceNumber: numero, reason: `ya está en ${previo.payment_number || "otro pago"}` });
      continue;
    }
    const conservar = previo && previo.lineas > 0 && !e.replaceLines;
    const guardado = await create({
      invoiceNumber: numero, distributor: e.distributor, branch: e.branch, kind: e.kind,
      issueDate: e.issueDate, amount: e.amount, source: e.source || `upload:pago:${usuario || "sistema"}`,
      // create() reescribe las notas al actualizar: se conservan las que el statement ya traía.
      notes: e.notes || previo?.notes || null,
    }, usuario);
    let renglones = previo?.lineas || 0;
    if (!conservar && Array.isArray(e.lines) && e.lines.length) renglones = await replaceLines(guardado.id, e.lines);

    // Ligado al pago; si el pago ya está pagado, la factura queda saldada (misma regla que apply).
    if (p.status === "Paid" && !previo?.payout_id) await applyToPayout([guardado.id], id);
    else await pool.query("UPDATE distributor_statement SET payout_id = $2, updated_at = now() WHERE id = $1", [guardado.id, id]);

    const i = facturas.findIndex((f) => String(f.number || "").trim().toUpperCase() === numero.toUpperCase());
    const fila = {
      date: String(e.issueDate || (i >= 0 ? facturas[i].date : "") || "").slice(0, 10),
      number: numero,
      amount: Number(e.amount || 0),
      attachment: e.attachment?.url
        ? { name: String(e.attachment.name || `${numero}.pdf`), url: String(e.attachment.url) }
        : (i >= 0 ? facturas[i].attachment || null : null),
    };
    if (i >= 0) facturas[i] = fila; else facturas.push(fila);
    resultado.saved.push({ invoiceNumber: numero, amount: fila.amount, lines: renglones, linesKept: !!conservar, isNew: !previo });
  }

  if (resultado.saved.length) {
    // Con lista de facturas, el total facturado ES su suma (misma regla que payments.store.update).
    const total = Math.round(facturas.reduce((a, f) => a + Number(f.amount || 0), 0) * 100) / 100;
    await pool.query(
      `UPDATE payouts SET invoices = $2::jsonb, invoice_total = $3, updated_at = now(), updated_by = $4,
              audit_log = COALESCE(audit_log, '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
                'timestamp', now(), 'user', $4::text, 'action', 'Invoices attached from PDF', 'newValue', $5::jsonb))
        WHERE id = $1`,
      [id, JSON.stringify(facturas), total, usuario || "System",
       JSON.stringify({ invoices: resultado.saved.map((s) => s.invoiceNumber), invoiceTotal: total })]);
    resultado.invoiceTotal = total;
  }
  return resultado;
}

module.exports = { annotateForPayout, attachToPayout, forPayout, list, get, lines, replaceLines, undecidedLines, forWorkOrder, selection, summary, byDistributor, create, importMany, update, applyToPayout, remove };
