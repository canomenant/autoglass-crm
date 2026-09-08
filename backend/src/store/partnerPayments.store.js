const crypto = require("crypto");
const pool = require("../config/db");

// Pagos hechos al socio a cuenta de sus distribuciones (Antonio, 7-sep-2026: "tengo cheques de la
// compañía con los que se han ido pagando esas comisiones"). Es un libro aparte de las
// distribuciones: la distribución dice cuánto se ganó por cada orden; el pago dice cuánto se le
// entregó y cuándo. El saldo es la diferencia.
let ensured = false;
async function ensure() {
  if (ensured) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS partner_payments (
      id UUID PRIMARY KEY,
      partner_id INTEGER NOT NULL,
      partner_name TEXT NOT NULL,
      payment_date DATE NOT NULL,
      amount NUMERIC(12,2) NOT NULL,
      method TEXT NOT NULL DEFAULT '',
      reference TEXT NOT NULL DEFAULT '',
      notes TEXT NOT NULL DEFAULT '',
      created_by TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`);
  await pool.query("CREATE INDEX IF NOT EXISTS partner_payments_partner_idx ON partner_payments (partner_id, payment_date)");
  ensured = true;
}

function mapRow(r) {
  return {
    id: r.id, partnerId: Number(r.partner_id), partnerName: r.partner_name,
    paymentDate: r.payment_date instanceof Date ? r.payment_date.toISOString().slice(0, 10) : String(r.payment_date).slice(0, 10),
    amount: Number(r.amount) || 0, method: r.method || "", reference: r.reference || "", notes: r.notes || "",
    createdBy: r.created_by || "", createdAt: r.created_at,
  };
}

async function list({ partnerId, dateFrom, dateTo } = {}) {
  await ensure();
  const cond = []; const params = [];
  if (partnerId) { params.push(Number(partnerId)); cond.push(`partner_id = $${params.length}`); }
  if (dateFrom) { params.push(dateFrom); cond.push(`payment_date >= $${params.length}`); }
  if (dateTo) { params.push(dateTo); cond.push(`payment_date <= $${params.length}`); }
  const r = await pool.query(`SELECT * FROM partner_payments ${cond.length ? "WHERE " + cond.join(" AND ") : ""} ORDER BY payment_date DESC, created_at DESC`, params);
  return r.rows.map(mapRow);
}

// Saldo por socio sin filtro de fechas: todo lo distribuido menos todo lo pagado.
async function balances() {
  await ensure();
  const d = await pool.query("SELECT partner_id, partner_name, sum(amount)::float AS s FROM partner_distributions GROUP BY partner_id, partner_name");
  const p = await pool.query("SELECT partner_id, sum(amount)::float AS s FROM partner_payments GROUP BY partner_id");
  const pagado = new Map(p.rows.map((r) => [Number(r.partner_id), Number(r.s) || 0]));
  const out = new Map();
  for (const r of d.rows) {
    const id = Number(r.partner_id); const dist = Number(r.s) || 0; const paid = pagado.get(id) || 0;
    out.set(id, { partnerId: id, partnerName: r.partner_name, distributedAllTime: dist, paidAllTime: paid, balance: Math.round((dist - paid) * 100) / 100 });
  }
  for (const [id, paid] of pagado) if (!out.has(id)) out.set(id, { partnerId: id, partnerName: "", distributedAllTime: 0, paidAllTime: paid, balance: -paid });
  return out;
}

async function create(data, user) {
  await ensure();
  const amount = Math.round((Number(data.amount) || 0) * 100) / 100;
  if (!(amount > 0)) throw new Error("A payment amount greater than zero is required");
  if (!data.partnerId) throw new Error("partnerId is required");
  const date = String(data.paymentDate || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("paymentDate must be YYYY-MM-DD");
  const id = crypto.randomUUID();
  await pool.query(
    `INSERT INTO partner_payments (id, partner_id, partner_name, payment_date, amount, method, reference, notes, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [id, Number(data.partnerId), String(data.partnerName || ""), date, amount, String(data.method || ""), String(data.reference || ""), String(data.notes || ""), user || ""]
  );
  return (await list({ partnerId: data.partnerId })).find((x) => x.id === id);
}

async function remove(id) {
  await ensure();
  const r = await pool.query("DELETE FROM partner_payments WHERE id = $1", [id]);
  return r.rowCount > 0;
}

module.exports = { list, balances, create, remove };
