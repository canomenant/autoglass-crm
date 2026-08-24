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
const SOLO_CON_MONTO = "amount > 0";

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

function normalizeKind(v) {
  const s = String(v || "").toUpperCase();
  if (KINDS.includes(s)) return s;
  if (PAYOUT_TYPE_TO_KIND[s]) return PAYOUT_TYPE_TO_KIND[s];
  return null;
}

// Saldo pendiente agrupado por parte, de mayor a menor. Es la portada de cada vista: a quien le
// debemos y cuanto.
async function balancesByParty(kind) {
  const k = normalizeKind(kind);
  if (!k) throw new Error(`Unknown kind: ${kind}`);
  const r = await pool.query(
    `SELECT COALESCE(NULLIF(btrim(party), ''), '(sin asignar)') AS party,
            count(*)::int AS pending_count,
            SUM(amount)::numeric AS pending_amount,
            MIN(work_date) AS oldest
       FROM payable
      WHERE kind = $1 AND status = 'pendiente' AND ${SOLO_CON_MONTO}
      GROUP BY 1
      ORDER BY pending_amount DESC`,
    [k]
  );
  return r.rows.map((x) => ({
    party: x.party,
    pendingCount: x.pending_count,
    pendingAmount: Number(x.pending_amount),
    oldest: x.oldest,
  }));
}

// Las obligaciones pendientes de una parte, para elegir cuales entran en el lote.
async function pendingForParty(kind, party) {
  const k = normalizeKind(kind);
  if (!k) throw new Error(`Unknown kind: ${kind}`);
  const r = await pool.query(
    `SELECT p.id, p.work_order_no, p.party, p.amount, p.work_date, w.customer_name
       FROM payable p
       LEFT JOIN work_orders w ON w.work_order_no = p.work_order_no AND w.active <> false
      WHERE p.kind = $1 AND p.status = 'pendiente' AND p.${SOLO_CON_MONTO}
        AND COALESCE(NULLIF(btrim(p.party), ''), '(sin asignar)') = $2
      ORDER BY p.work_date NULLS LAST, p.work_order_no`,
    [k, party]
  );
  return r.rows.map((x) => ({
    id: Number(x.id),
    workOrderNo: x.work_order_no,
    party: x.party,
    amount: Number(x.amount),
    workDate: x.work_date,
    customerName: x.customer_name || "",
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
async function forPayout(payoutId) {
  const r = await pool.query(
    `SELECT id, work_order_no, kind, party, amount, work_date FROM payable
      WHERE payout_id = $1 ORDER BY work_order_no`,
    [payoutId]
  );
  return r.rows.map((x) => ({ ...x, id: Number(x.id), amount: Number(x.amount) }));
}

module.exports = { KINDS, KIND_TO_PAYOUT_TYPE, normalizeKind, balancesByParty, pendingForParty, summary, forPayout };
