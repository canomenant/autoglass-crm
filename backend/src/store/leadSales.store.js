const crypto = require("crypto");
const pool = require("../config/db");

// Leads vendidos (ver leadBuyers.store.js para el modelo). Una fila por venta; las ofertas a cada
// comprador van en `offers` (jsonb): cada una con su token (la credencial del link público
// /lead/<token>) y su estado. Se lo queda el primero que paga: el resto pasa a "lost".
//
// package = foto de los datos del trabajo al momento de vender (cliente, vehículo, vidrio,
// zona, fecha) — lo que el comprador recibe al pagar. teaser = lo que ve antes de pagar (sin
// contacto). Nunca se guardan precios ni costos de Reyes en el paquete.

let ensured = false;
async function ensure() {
  if (ensured) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS lead_sales (
      id SERIAL PRIMARY KEY,
      work_order_id TEXT NOT NULL,
      work_order_no TEXT NOT NULL DEFAULT '',
      quote_id TEXT,
      price NUMERIC(10,2) NOT NULL,
      status TEXT NOT NULL DEFAULT 'offered',
      offers JSONB NOT NULL DEFAULT '[]',
      package JSONB NOT NULL DEFAULT '{}',
      teaser JSONB NOT NULL DEFAULT '{}',
      buyer_id INTEGER,
      buyer_name TEXT,
      paid_at TIMESTAMPTZ,
      paid_via TEXT,
      payment_ref TEXT,
      delivered_at TIMESTAMPTZ,
      delivery JSONB NOT NULL DEFAULT '{}',
      customer_notified_at TIMESTAMPTZ,
      expires_at TIMESTAMPTZ,
      created_by TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      cancelled_at TIMESTAMPTZ,
      cancel_reason TEXT
    )`);
  await pool.query("CREATE INDEX IF NOT EXISTS lead_sales_wo_idx ON lead_sales (work_order_id)");
  await pool.query("CREATE INDEX IF NOT EXISTS lead_sales_status_idx ON lead_sales (status, created_at)");
  ensured = true;
}

function mapRow(r) {
  if (!r) return null;
  return {
    id: r.id,
    workOrderId: r.work_order_id,
    workOrderNo: r.work_order_no,
    quoteId: r.quote_id,
    price: Number(r.price),
    status: r.status, // offered | paid | delivered | expired | cancelled
    offers: r.offers || [],
    package: r.package || {},
    teaser: r.teaser || {},
    buyerId: r.buyer_id,
    buyerName: r.buyer_name,
    paidAt: r.paid_at,
    paidVia: r.paid_via,
    paymentRef: r.payment_ref,
    deliveredAt: r.delivered_at,
    delivery: r.delivery || {},
    customerNotifiedAt: r.customer_notified_at,
    expiresAt: r.expires_at,
    createdBy: r.created_by,
    createdAt: r.created_at,
    cancelledAt: r.cancelled_at,
    cancelReason: r.cancel_reason,
  };
}

const genToken = () => crypto.randomBytes(12).toString("hex");

async function create({ workOrderId, workOrderNo, quoteId, price, buyers, pkg, teaser, expiresHours, createdBy }) {
  await ensure();
  const offers = buyers.map((b) => ({ buyerId: b.id, buyerName: b.name, phone: b.phone, email: b.email, token: genToken(), status: "offered", sentAt: null, sendResult: null }));
  const expiresAt = new Date(Date.now() + Number(expiresHours || 24) * 3600 * 1000).toISOString();
  const r = await pool.query(
    `INSERT INTO lead_sales (work_order_id, work_order_no, quote_id, price, offers, package, teaser, expires_at, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
    [String(workOrderId), workOrderNo || "", quoteId ? String(quoteId) : null, price, JSON.stringify(offers), JSON.stringify(pkg), JSON.stringify(teaser), expiresAt, createdBy || null]
  );
  return mapRow(r.rows[0]);
}

async function get(id) {
  await ensure();
  const r = await pool.query("SELECT * FROM lead_sales WHERE id=$1", [id]);
  return mapRow(r.rows[0]);
}

async function byToken(token) {
  await ensure();
  const r = await pool.query("SELECT * FROM lead_sales WHERE offers @> $1::jsonb LIMIT 1", [JSON.stringify([{ token }])]);
  const sale = mapRow(r.rows[0]);
  if (!sale) return null;
  const offer = sale.offers.find((o) => o.token === token);
  return { sale, offer };
}

async function forWorkOrder(workOrderId) {
  await ensure();
  const r = await pool.query("SELECT * FROM lead_sales WHERE work_order_id=$1 ORDER BY created_at DESC", [String(workOrderId)]);
  return r.rows.map(mapRow);
}

async function list({ status, buyerId, from, to } = {}) {
  await ensure();
  const where = [], params = [];
  if (status) { params.push(status); where.push(`status=$${params.length}`); }
  if (buyerId) { params.push(Number(buyerId)); where.push(`buyer_id=$${params.length}`); }
  if (from) { params.push(from); where.push(`created_at >= $${params.length}`); }
  if (to) { params.push(to); where.push(`created_at < ($${params.length}::date + 1)`); }
  const r = await pool.query(`SELECT * FROM lead_sales ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY created_at DESC LIMIT 500`, params);
  return r.rows.map(mapRow);
}

async function setOffers(id, offers) {
  await ensure();
  const r = await pool.query("UPDATE lead_sales SET offers=$2 WHERE id=$1 RETURNING *", [id, JSON.stringify(offers)]);
  return mapRow(r.rows[0]);
}

// El comprador pagó: se lo queda; las demás ofertas se pierden. Atómico: solo si seguía "offered".
async function markPaid(id, { buyerId, buyerName, via, ref }) {
  await ensure();
  const cur = await get(id);
  if (!cur) return null;
  if (cur.status !== "offered") return cur; // ya vendido/cancelado: no se pisa
  const offers = cur.offers.map((o) => ({ ...o, status: o.buyerId === buyerId ? "paid" : "lost" }));
  const r = await pool.query(
    `UPDATE lead_sales SET status='paid', buyer_id=$2, buyer_name=$3, paid_at=now(), paid_via=$4, payment_ref=$5, offers=$6
     WHERE id=$1 AND status='offered' RETURNING *`,
    [id, buyerId, buyerName || null, via || null, ref || null, JSON.stringify(offers)]
  );
  return mapRow(r.rows[0]) || (await get(id));
}

async function markDelivered(id, delivery, customerNotified) {
  await ensure();
  const r = await pool.query(
    `UPDATE lead_sales SET status='delivered', delivered_at=now(), delivery=$2, customer_notified_at=CASE WHEN $3 THEN now() ELSE customer_notified_at END WHERE id=$1 RETURNING *`,
    [id, JSON.stringify(delivery || {}), Boolean(customerNotified)]
  );
  return mapRow(r.rows[0]);
}

async function cancel(id, reason, user) {
  await ensure();
  const r = await pool.query(
    "UPDATE lead_sales SET status='cancelled', cancelled_at=now(), cancel_reason=$2 WHERE id=$1 AND status IN ('offered','expired') RETURNING *",
    [id, `${reason || ""}${user ? ` (${user})` : ""}`.trim()]
  );
  return mapRow(r.rows[0]) || (await get(id));
}

async function expireStale() {
  await ensure();
  await pool.query("UPDATE lead_sales SET status='expired' WHERE status='offered' AND expires_at < now()");
}

module.exports = { create, get, byToken, forWorkOrder, list, setOffers, markPaid, markDelivered, cancel, expireStale };
