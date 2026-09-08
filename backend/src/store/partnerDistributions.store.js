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

// Fecha del trabajo: la cita de la orden. Es la que manda para la ventana de distribución y para
// el mes del P&L. No se usa el historial de pagos porque en las órdenes importadas sus asientos
// son correcciones de 2026 y mandarían todo 2025 fuera de la ventana (visto el 7-sep-2026).
function paymentDateOf(workOrder) {
  const h = workOrder.paymentHistory || [];
  const last = h[h.length - 1];
  const raw = workOrder.appointmentDate || last?.timestamp || null;
  const d = raw ? new Date(raw) : null;
  return d && !Number.isNaN(d.getTime()) ? d : new Date();
}

// Ganancia bruta de la orden: lo cobrado menos pieza, labor y comisión (misma cuenta que la
// columna Gross Profit de la lista y el P&L).
function grossProfitOf(workOrder) {
  const n = (v) => Number(v) || 0;
  return n(workOrder.payment?.amount) - n(workOrder.glassCost) - n(workOrder.laborCost) - n(workOrder.commission);
}

// Reglas de Antonio (7-sep-2026): la orden está pagada, cae en la ventana de fechas de la
// configuración, su ganancia bruta es MAYOR al mínimo del socio, y el técnico no es el socio.
function qualifies(workOrder, partner, settings) {
  if (!workOrder.payment?.paid) return false;
  if (!settings.startDate) return false;
  const paidAt = paymentDateOf(workOrder);
  const dia = paidAt.toISOString().slice(0, 10);
  if (dia < String(settings.startDate).slice(0, 10)) return false;
  if (settings.endDate && dia > String(settings.endDate).slice(0, 10)) return false;
  if (partner.minGrossProfit != null && !(grossProfitOf(workOrder) > Number(partner.minGrossProfit))) return false;
  const excl = String(partner.excludeTechnicianName || "").trim().toLowerCase();
  if (excl && String(workOrder.tech || "").trim().toLowerCase() === excl) return false;
  return true;
}

// Deja las distribuciones de UNA orden como deben estar hoy: crea las que faltan para los
// socios que califican y borra las que ya no califican (una orden que se corrige y baja de la
// ganancia mínima, o que se marca no pagada). Idempotente; se llama en cada guardado de la
// orden y desde el backfill. Devuelve qué hizo, para el reporte.
async function syncForWorkOrder(workOrder, { dryRun = false } = {}) {
  const settings = await settingsStore.get();
  const partners = businessPartnersStore.list().filter((p) => p.active);
  const existing = (await pool.query("SELECT id, partner_id, amount FROM partner_distributions WHERE work_order_id = $1", [workOrder.id])).rows;
  const jobTypesById = new Map(jobTypesStore.list().map((jt) => [jt.id, jt]));
  const jobType = await resolveMainJobType(workOrder);
  const paidAt = paymentDateOf(workOrder);
  const changes = [];
  for (const partner of partners) {
    const ok = qualifies(workOrder, partner, settings);
    const amount = ok ? businessPartnersStore.rateForJobType(partner, jobType, jobTypesById) : 0;
    const row = existing.find((e) => Number(e.partner_id) === Number(partner.id));
    if (ok && amount > 0 && !row) {
      changes.push({ partner: partner.name, action: "crear", amount });
      if (!dryRun) await pool.query(
        `INSERT INTO partner_distributions (id, work_order_id, work_order_no, partner_id, partner_name, job_type, amount, paid_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [crypto.randomUUID(), workOrder.id, workOrder.workOrderNo, partner.id, partner.name, jobType || "", amount, paidAt]
      );
    } else if ((!ok || !(amount > 0)) && row) {
      changes.push({ partner: partner.name, action: "quitar", amount: Number(row.amount) });
      if (!dryRun) await pool.query("DELETE FROM partner_distributions WHERE id = $1", [row.id]);
    } else if (ok && row && Math.abs(Number(row.amount) - amount) > 0.005) {
      changes.push({ partner: partner.name, action: "ajustar", amount });
      if (!dryRun) await pool.query("UPDATE partner_distributions SET amount = $2 WHERE id = $1", [row.id, amount]);
    }
  }
  // Socios que ya no existen o están inactivos: sus filas sobran.
  for (const e of existing) {
    if (!partners.some((p) => Number(p.id) === Number(e.partner_id))) {
      changes.push({ partner: String(e.partner_id), action: "quitar", amount: Number(e.amount) });
      if (!dryRun) await pool.query("DELETE FROM partner_distributions WHERE id = $1", [e.id]);
    }
  }
  return changes;
}

// Compatibilidad: el guardado de la orden llama esto al pasar a pagada. Hoy delega en sync.
async function generateForWorkOrder(workOrder) {
  return syncForWorkOrder(workOrder);
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

module.exports = { generateForWorkOrder, syncForWorkOrder, qualifies, grossProfitOf, paymentDateOf, query };
