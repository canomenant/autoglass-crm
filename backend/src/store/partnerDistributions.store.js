const crypto = require("crypto");
const pool = require("../config/db");
const quotesStore = require("./quotes.store");
const jobTypesStore = require("./jobTypes.store");
const businessPartnersStore = require("./businessPartners.store");
const settingsStore = require("./partnerDistributionSettings.store");

// The "main" job type for commission purposes is the highest-priced line item on the source
// quote (follows the money, not entry order). Work orders don't carry their own line items —
// only 2 historical orders (Wo-3036, Wo-1312) lack a linked quote at all, so those fall back to
// the single jobType string already stored on the work order.
async function resolveMainJobType(workOrder) {
  if (workOrder.quoteId) {
    const quote = await quotesStore.get(workOrder.quoteId);
    const lineItems = quote?.lineItems || [];
    if (lineItems.length > 0) {
      const top = lineItems.reduce((max, li) => (Number(li.pricePart || 0) > Number(max.pricePart || 0) ? li : max));
      if (top.jobType) return top.jobType;
    }
  }
  return workOrder.jobType || "";
}

async function hasDistributionsFor(workOrderId) {
  const r = await pool.query("SELECT 1 FROM partner_distributions WHERE work_order_id = $1 LIMIT 1", [workOrderId]);
  return r.rows.length > 0;
}

// Called once, right when a work order's payment.paid flips false -> true. Idempotent: does
// nothing if this work order already has distribution rows (guards a paid -> unpaid -> paid
// correction from double-generating), and does nothing at all until an admin has explicitly set
// a cutoff date — no cutoff configured means no distributions, by design, so the feature can't
// silently start generating before someone has deliberately opted in.
async function generateForWorkOrder(workOrder) {
  const settings = await settingsStore.get();
  if (!settings.startDate) return;

  const paidAt = new Date();
  if (paidAt < new Date(settings.startDate)) return;

  if (await hasDistributionsFor(workOrder.id)) return;

  const jobType = await resolveMainJobType(workOrder);
  if (!jobType) return;

  const partners = businessPartnersStore.list().filter((p) => p.active);
  if (partners.length === 0) return;

  const jobTypesById = new Map(jobTypesStore.list().map((jt) => [jt.id, jt]));

  for (const partner of partners) {
    const amount = businessPartnersStore.rateForJobType(partner, jobType, jobTypesById);
    if (amount === undefined || amount <= 0) continue;

    await pool.query(
      `INSERT INTO partner_distributions (id, work_order_id, work_order_no, partner_id, partner_name, job_type, amount, paid_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [crypto.randomUUID(), workOrder.id, workOrder.workOrderNo, partner.id, partner.name, jobType, amount, paidAt]
    );
  }
}

function inRangeClause(dateFrom, dateTo) {
  const conditions = [];
  const params = [];
  if (dateFrom) {
    params.push(dateFrom);
    conditions.push(`paid_at >= $${params.length}`);
  }
  if (dateTo) {
    params.push(`${dateTo} 23:59:59`);
    conditions.push(`paid_at <= $${params.length}`);
  }
  return { where: conditions.length ? `WHERE ${conditions.join(" AND ")}` : "", params };
}

async function query({ dateFrom, dateTo } = {}) {
  const { where, params } = inRangeClause(dateFrom, dateTo);
  const r = await pool.query(
    `SELECT id, work_order_id, work_order_no, partner_id, partner_name, job_type, amount, paid_at
     FROM partner_distributions ${where} ORDER BY paid_at DESC`,
    params
  );
  return r.rows.map((row) => ({
    id: row.id,
    workOrderId: row.work_order_id,
    workOrderNo: row.work_order_no,
    partnerId: row.partner_id,
    partnerName: row.partner_name,
    jobType: row.job_type,
    amount: Number(row.amount) || 0,
    paidAt: row.paid_at,
  }));
}

module.exports = { generateForWorkOrder, query };
