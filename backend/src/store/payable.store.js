const pool = require("../config/db");

// Nivel 1 de cuentas por pagar: la obligacion. Una por work order y por parte.
//
// Es la fuente de verdad de "esto ya se pago" — no payouts.work_order_ids, que es derivado y
// razona por orden cuando la deuda es por orden Y por parte: 490 work orders tienen mas de una
// obligacion de distribuidor y 44 le deben a dos distribuidores distintos.
//
// Las cabeceras de work_orders (labor_cost, commission, glass_cost) quedan como totales derivados:
// coinciden con la suma de obligaciones y se reconcilian por script, pero quien manda es esto.

// Una obligacion de $0.00 es un REGISTRO HISTORICO, no una deuda. Significa que esa orden tuvo un
// agente o un tecnico asignado y no genero pago — por ejemplo Alex Reyes, que es socio y no cobra
// comision. Se conservan tal cual: no se borran ni se marcan pagadas, porque son la prueba de que
// la asignacion existio.
//
// Pero no son plata que se deba, asi que las vistas de saldo las excluyen. Es un filtro de
// PRESENTACION: los montos no cambian (sumar cero no mueve nada), solo los conteos. Hoy son 675 de
// las 2,408 pendientes — 488 de distribuidor, 186 de agente y 1 de tecnico.
// ACTUALIZADO: las de $0 vuelven a mostrarse, a pedido de la oficina.
//
// El razonamiento de arriba sigue siendo cierto —no son plata que se deba— pero esconderlas hacía
// que una orden asignada sin comisión desapareciera de la pantalla, y desde fuera eso no se
// distingue de "falta una orden". Ahora aparecen y se cuentan aparte: el saldo no cambia (sumar
// cero no mueve nada), lo que cambia es que se ven.
//
// Ya no se filtra por monto en las consultas; esta expresión sólo se usa para DESGLOSAR el
// conteo entre lo que se debe y lo que es registro histórico. Lleva `%s` donde va el prefijo de
// tabla, porque una de las dos consultas hace join y necesita calificar la columna.
const CON_MONTO = (prefijo = "") => `${prefijo}amount > 0`;

// 'acreditado' es una obligacion que el distribuidor salió abonando: se rompió el vidrio, se le
// emitió nota de debito, y el la acepto y devolvio el importe con una nota de credito que ya se
// neteo contra su lote de pago. No es deuda — seguian contadas como pendientes y eso inflaba el
// saldo con distribuidores en $11,076.07 sobre 114 obligaciones.
//
// Estado propio y no 'pagado': saldada porque nos la abonaron no es saldada porque la pagamos, y
// esa diferencia es justo la que hace falta cuando alguien pregunte por que ese vidrio nunca
// salio de la caja. En que lote se neteo el credito lo guarda credit_debit_note.payout_id, no
// payable.payout_id, que en estas queda nulo a proposito: forPayout() lee por ahi para mostrar el
// contenido de un lote y las mostraria como pagadas.

const KINDS = ["TECH", "AGENT", "DISTRIBUTOR"];
// Los tipos de lote de payouts usan otra palabra para lo mismo.
const KIND_TO_PAYOUT_TYPE = { TECH: "TECHNICIAN", AGENT: "AGENT", DISTRIBUTOR: "DISTRIBUTOR" };
const PAYOUT_TYPE_TO_KIND = { TECHNICIAN: "TECH", AGENT: "AGENT", DISTRIBUTOR: "DISTRIBUTOR" };

// pg entrega DATE como objeto Date, y String(date).slice(0, 10) da "Mon Feb 02" en vez de
// "2026-02-02" — la pantalla del pago lo mostraba asi. Se normaliza aca y no en cada vista, que es
// donde ya se habia colado dos veces. A mano y no con toISOString(): el Date viene a medianoche
// LOCAL, y toISOString lo corre un dia entero segun el huso.
function fechaISO(v) {
  if (!v) return null;
  if (v instanceof Date) {
    return `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, "0")}-${String(v.getDate()).padStart(2, "0")}`;
  }
  return String(v).slice(0, 10);
}

function normalizeKind(v) {
  const s = String(v || "").toUpperCase();
  if (KINDS.includes(s)) return s;
  if (PAYOUT_TYPE_TO_KIND[s]) return PAYOUT_TYPE_TO_KIND[s];
  return null;
}

// Al agente se le paga por COMPANIA, no por persona: Digiclique tiene tres con saldo — David Cruz,
// Ashley Diaz y Kayla Lopez — y se les paga junto, en un lote. Agrupar por agente obligaba a hacer
// tres pagos donde el negocio hace uno.
//
// Los distribuidores no se agrupan. En CAT_COMPANY cada sucursal de Mygrant es una compania
// distinta, no la sucursal de una matriz; que Dist-0244 pagara a tres a la vez es una excepcion del
// historico, no una regla que la vista deba reproducir.
const AGRUPA_POR_COMPANIA = (k) => k === "AGENT";
const COLUMNA_DE_GRUPO = (k) =>
  AGRUPA_POR_COMPANIA(k)
    ? "COALESCE(NULLIF(btrim(company), ''), NULLIF(btrim(party), ''), '(sin asignar)')"
    : "COALESCE(NULLIF(btrim(party), ''), '(sin asignar)')";

// Saldo pendiente agrupado, de mayor a menor. Es la portada de cada vista: a quien le debemos y
// cuanto.
async function balancesByParty(kind) {
  const k = normalizeKind(kind);
  if (!k) throw new Error(`Unknown kind: ${kind}`);
  const r = await pool.query(
    `SELECT ${COLUMNA_DE_GRUPO(k)} AS party,
            count(*)::int AS pending_count,
            count(*) FILTER (WHERE ${CON_MONTO()})::int AS payable_count,
            count(*) FILTER (WHERE NOT (${CON_MONTO()}))::int AS zero_count,
            count(DISTINCT NULLIF(btrim(party), ''))::int AS member_count,
            SUM(amount)::numeric AS pending_amount,
            MIN(work_date) AS oldest
       FROM payable
      WHERE kind = $1 AND status = 'pendiente'
      GROUP BY 1
      ORDER BY pending_amount DESC`,
    [k]
  );
  return r.rows.map((x) => ({
    party: x.party,
    pendingCount: x.pending_count,
    // Desglose del conteo: cuántas se deben de verdad y cuántas son registro histórico sin
    // importe. La pantalla las separa para que "12 pendientes, $0.00" no parezca un error.
    payableCount: x.payable_count,
    zeroCount: x.zero_count,
    // Cuantas personas hay dentro del renglon. Se muestra solo cuando es mas de una, que es lo que
    // avisa que ese pago cubre a varios a la vez.
    memberCount: x.member_count,
    pendingAmount: Number(x.pending_amount),
    oldest: fechaISO(x.oldest),
  }));
}

// Las obligaciones pendientes de una parte, para elegir cuales entran en el lote.
async function pendingForParty(kind, party) {
  const k = normalizeKind(kind);
  if (!k) throw new Error(`Unknown kind: ${kind}`);
  const r = await pool.query(
    `SELECT p.id, p.work_order_no, p.party, p.company, p.amount, p.work_date,
            w.customer_name, w.id AS work_order_id, w.status AS work_order_status
       FROM payable p
       LEFT JOIN work_orders w ON w.work_order_no = p.work_order_no AND w.active <> false
      WHERE p.kind = $1 AND p.status = 'pendiente'
        AND ${COLUMNA_DE_GRUPO(k).replace(/\b(company|party)\b/g, "p.$1")} = $2
      ORDER BY p.party, p.work_date NULLS LAST, p.work_order_no`,
    [k, party]
  );
  return r.rows.map((x) => ({
    id: Number(x.id),
    workOrderNo: x.work_order_no,
    // De quien es la comision dentro de la compania. En un pago a Digiclique hay trabajos de tres
    // agentes distintos, y sin esto la lista no diria de quien es cada renglon.
    party: x.party,
    company: x.company || "",
    amount: Number(x.amount),
    workDate: fechaISO(x.work_date),
    customerName: x.customer_name || "",
    // Para poder abrir la orden desde la lista. Puede venir null: hay obligaciones del import
    // historico cuyo work_order_no ya no corresponde a ninguna orden activa, y en ese caso la
    // pantalla muestra el numero sin enlace en vez de un enlace roto.
    workOrderId: x.work_order_id || null,
    workOrderStatus: x.work_order_status || "",
  }));
}

// Totales de la portada general.
async function summary() {
  // pendingCount cuenta solo lo que se debe de verdad; las de $0 quedan aparte en historicalCount
  // para que el numero no aparezca sin explicacion.
  const r = await pool.query(
    `SELECT kind, status, count(*) FILTER (WHERE amount > 0)::int AS n,
            count(*) FILTER (WHERE amount = 0)::int AS ceros, SUM(amount)::numeric AS s
       FROM payable GROUP BY 1, 2`
  );
  const out = {};
  for (const k of KINDS) {
    out[k] = { pendingCount: 0, pendingAmount: 0, historicalCount: 0, paidCount: 0, paidAmount: 0, creditedCount: 0, creditedAmount: 0 };
  }
  for (const row of r.rows) {
    if (!out[row.kind]) continue;
    if (row.status === "pendiente") {
      out[row.kind].pendingCount = row.n;
      out[row.kind].pendingAmount = Number(row.s);
      out[row.kind].historicalCount = row.ceros;
    } else if (row.status === "acreditado") {
      out[row.kind].creditedCount = row.n;
      out[row.kind].creditedAmount = Number(row.s);
    } else {
      // Suma, no asigna: con un solo estado ademas de 'pendiente' asignar alcanzaba, pero al
      // aparecer 'acreditado' la segunda vuelta pisaba a la primera y el conteo de pagadas
      // quedaba en el de la ultima fila que llegara.
      out[row.kind].paidCount += row.n;
      out[row.kind].paidAmount += Number(row.s);
    }
  }
  return out;
}

// Contenido de un lote, leido desde las obligaciones y no desde work_order_ids.
// El numero de parte va aca porque la deuda es por orden Y POR PARTE: sin el, una orden con dos
// piezas se ve como una fila repetida sin explicacion. Wo-2825 en Dist-0244 son $11.35 de una
// moldura y $70.50 del parabrisas.
// Cliente y vehiculo salen de la work order, no de payable: son de la orden, no de la deuda, y
// copiarlos aqui seria duplicar un dato que ya tiene dueno. Hacen falta porque el numero de parte
// solo existe del lado del distribuidor — en un lote de tecnico lo que identifica el trabajo es
// de quien era el carro, no que vidrio se puso.
async function forPayout(payoutId) {
  const r = await pool.query(
    `SELECT p.id, p.work_order_no, p.kind, p.party, p.amount, p.work_date,
            p.part_number, p.part_description,
            w.customer_name,
            NULLIF(btrim(concat_ws(' ', w.vehicle_year, w.vehicle_make, w.vehicle_model)), '') AS vehicle
       FROM payable p
       LEFT JOIN work_orders w ON w.work_order_no = p.work_order_no AND w.active <> false
      WHERE p.payout_id = $1 ORDER BY p.work_order_no, p.part_number NULLS LAST`,
    [payoutId]
  );
  return r.rows.map((x) => ({ ...x, id: Number(x.id), amount: Number(x.amount), work_date: fechaISO(x.work_date) }));
}

// Estado de pago de una orden, por tipo (técnico/agente/distribuidor). Para el panel de la orden:
// dice si a cada uno ya se le pagó o está pendiente. `payout_id` es la ÚNICA fuente de "esto ya
// se pagó" (una obligación entra en un lote y queda con su payout_id). Una orden puede tener
// varias del mismo tipo (p. ej. dos distribuidores), así que se agrega: pagado sólo si TODAS las
// de ese tipo lo están.
async function statusForWorkOrder(workOrderNo) {
  const r = await pool.query(
    `SELECT kind, amount, payout_id FROM payable WHERE work_order_no = $1`,
    [workOrderNo]
  );
  const agg = {};
  for (const row of r.rows) {
    const k = row.kind;
    if (!agg[k]) agg[k] = { amount: 0, count: 0, paidCount: 0 };
    agg[k].amount += Number(row.amount) || 0;
    agg[k].count += 1;
    if (row.payout_id != null) agg[k].paidCount += 1;
  }
  const out = {};
  for (const k of KINDS) {
    const a = agg[k];
    out[k] = a && a.count
      ? { exists: true, amount: a.amount, paid: a.paidCount === a.count }
      : { exists: false, amount: 0, paid: false };
  }
  return out;
}

module.exports = { KINDS, KIND_TO_PAYOUT_TYPE, normalizeKind, balancesByParty, pendingForParty, summary, forPayout, statusForWorkOrder };
