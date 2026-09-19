const pool = require("../config/db");

// Tarjeta "en archivo" (card on file) para cobrar el trabajo al terminar. Antonio, 19-sep-2026.
//
// La tarjeta NUNCA se guarda aquí: el cliente la captura en la página de Stripe (Checkout en modo
// setup) y Stripe la guarda; el CRM solo guarda la referencia (customer + payment method) y lo
// que se puede mostrar (marca, últimos 4, vencimiento). Con eso se cobra después sin volver a
// pedirla (PaymentIntent off_session). Es lo que exige PCI y lo que hacen los demás CRM.
//
// Una fila por tarjeta guardada; se liga a la orden que la pidió y al cliente, para poder
// reutilizarla en órdenes siguientes del mismo cliente. Se "revoca" (revoked_at), no se borra.

let ensured = false;
async function ensure() {
  if (ensured) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS stripe_cards (
      id SERIAL PRIMARY KEY,
      work_order_id TEXT NOT NULL,
      customer_id TEXT,
      stripe_customer_id TEXT NOT NULL,
      payment_method_id TEXT NOT NULL,
      brand TEXT NOT NULL DEFAULT '',
      last4 TEXT NOT NULL DEFAULT '',
      exp_month INTEGER,
      exp_year INTEGER,
      fingerprint TEXT,
      livemode BOOLEAN NOT NULL DEFAULT false,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      revoked_at TIMESTAMPTZ,
      revoked_by TEXT
    )`);
  await pool.query("CREATE INDEX IF NOT EXISTS stripe_cards_wo_idx ON stripe_cards (work_order_id)");
  await pool.query("CREATE INDEX IF NOT EXISTS stripe_cards_customer_idx ON stripe_cards (customer_id)");
  ensured = true;
}

function mapRow(r) {
  if (!r) return null;
  return {
    id: r.id,
    workOrderId: r.work_order_id,
    customerId: r.customer_id,
    stripeCustomerId: r.stripe_customer_id,
    paymentMethodId: r.payment_method_id,
    brand: r.brand,
    last4: r.last4,
    expMonth: r.exp_month,
    expYear: r.exp_year,
    livemode: r.livemode,
    createdAt: r.created_at,
  };
}

// Lo que se le enseña a cualquiera (orden, link público): sin ids de Stripe.
function publicView(card) {
  if (!card) return null;
  return { brand: card.brand, last4: card.last4, expMonth: card.expMonth, expYear: card.expYear, savedAt: card.createdAt, scope: card.scope || "order" };
}

async function save(data) {
  await ensure();
  // Misma tarjeta (fingerprint) ya guardada para la orden → no duplicar, solo refrescar.
  if (data.fingerprint) {
    const dup = await pool.query(
      "SELECT id FROM stripe_cards WHERE work_order_id=$1 AND fingerprint=$2 AND revoked_at IS NULL",
      [String(data.workOrderId), data.fingerprint]
    );
    if (dup.rows.length) {
      const r = await pool.query(
        "UPDATE stripe_cards SET stripe_customer_id=$2, payment_method_id=$3, brand=$4, last4=$5, exp_month=$6, exp_year=$7, created_at=now() WHERE id=$1 RETURNING *",
        [dup.rows[0].id, data.stripeCustomerId, data.paymentMethodId, data.brand || "", data.last4 || "", data.expMonth || null, data.expYear || null]
      );
      return mapRow(r.rows[0]);
    }
  }
  const r = await pool.query(
    `INSERT INTO stripe_cards (work_order_id, customer_id, stripe_customer_id, payment_method_id, brand, last4, exp_month, exp_year, fingerprint, livemode)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
    [String(data.workOrderId), data.customerId ? String(data.customerId) : null, data.stripeCustomerId, data.paymentMethodId,
     data.brand || "", data.last4 || "", data.expMonth || null, data.expYear || null, data.fingerprint || null, Boolean(data.livemode)]
  );
  return mapRow(r.rows[0]);
}

// La tarjeta de la orden; si no tiene, la más reciente del mismo cliente (de otra orden).
async function forWorkOrder(workOrderId, customerId) {
  await ensure();
  const own = await pool.query(
    "SELECT * FROM stripe_cards WHERE work_order_id=$1 AND revoked_at IS NULL ORDER BY created_at DESC LIMIT 1",
    [String(workOrderId)]
  );
  if (own.rows.length) return { ...mapRow(own.rows[0]), scope: "order" };
  if (!customerId) return null;
  const cust = await pool.query(
    "SELECT * FROM stripe_cards WHERE customer_id=$1 AND revoked_at IS NULL ORDER BY created_at DESC LIMIT 1",
    [String(customerId)]
  );
  return cust.rows.length ? { ...mapRow(cust.rows[0]), scope: "customer" } : null;
}

// Stripe customer ya creado para este cliente (para no crear uno por orden).
async function stripeCustomerFor(customerId) {
  if (!customerId) return null;
  await ensure();
  const r = await pool.query(
    "SELECT stripe_customer_id FROM stripe_cards WHERE customer_id=$1 ORDER BY created_at DESC LIMIT 1",
    [String(customerId)]
  );
  return r.rows[0]?.stripe_customer_id || null;
}

async function revoke(id, user) {
  await ensure();
  const r = await pool.query("UPDATE stripe_cards SET revoked_at=now(), revoked_by=$2 WHERE id=$1 AND revoked_at IS NULL RETURNING *", [id, user || null]);
  return mapRow(r.rows[0]);
}

module.exports = { save, forWorkOrder, stripeCustomerFor, revoke, publicView };
