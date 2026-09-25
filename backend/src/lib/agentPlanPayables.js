const pool = require("../config/db");
const agentCommission = require("./agentCommission");
const { resolveAgentCompany } = require("./payableSync");

// Lo que el plan del agente paga FUERA de la comisión de cada orden (Antonio, 24-sep-2026):
//   1. Lead vendido: una cantidad fija por lead, cuando el comprador ya pagó.
//   2. Bono semanal: 10/20/30 trabajos cobrados en la semana (lunes a domingo) → $, y se paga
//      SOLO el escalón más alto que alcanzó.
//
// Los dos entran a Por Pagar como obligaciones AGENT, así que se le pagan en el mismo lote que sus
// órdenes — y como todo lo de Por Pagar, nada sale hasta que Antonio arma y aprueba ese lote.
//
// Su work_order_no NO es el de una orden ("Lead-12", "Bono-2026-09-28"): con el número de la orden,
// payableSync las vería como obligaciones del agente de esa orden y las borraría como sobrantes o
// dejaría de gestionar la comisión de la orden. Tampoco llevan el prefijo 'auto:' por lo mismo.

const TZ = "America/Chicago";

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

// ── Lead vendido ─────────────────────────────────────────────────────────────────────────────
// Se llama cuando la venta pasa a pagada (leadSales.markPaid). El agente es el de la cotización de
// la orden de la que salió el lead. Idempotente por external_id.
async function recordLeadCommission(sale) {
  if (!sale || !["paid", "delivered"].includes(sale.status)) return null;
  const workordersStore = require("../store/workorders.store");
  const quotesStore = require("../store/quotes.store");
  const planStore = require("../store/agentCommissionPlan.store");
  const agentsStore = require("../store/agents.store");

  const wo = sale.workOrderId ? await workordersStore.get(sale.workOrderId) : null;
  const quoteId = sale.quoteId || wo?.quoteId;
  const quote = quoteId ? await quotesStore.get(quoteId) : null;
  if (!quote?.agentId) return null;

  const fecha = agentCommission.businessDate(sale.paidAt || new Date());
  const { versions } = await planStore.versionsForAgent(quote.agentId);
  const version = agentCommission.versionFor(versions, fecha);
  const amount = round2(version?.lead?.value);
  if (!(amount > 0)) return null;

  const agent = agentsStore.listBasic().find((a) => a.id === Number(quote.agentId));
  const party = String(agent?.name || quote.agentName || "").trim();
  if (!party) return null;
  const company = await resolveAgentCompany(pool, party);
  const r = await pool.query(
    `INSERT INTO payable (work_order_no, kind, party, company, amount, status, work_date, source, external_id, part_description)
     VALUES ($1, 'AGENT', $2, $3, $4, 'pendiente', $5::date, 'plan_lead', $6, $7)
     ON CONFLICT (external_id) DO NOTHING RETURNING id`,
    [`Lead-${sale.id}`, party, company, amount, fecha, `plan-lead:${sale.id}`, `Lead vendido de ${sale.workOrderNo || "la orden"}`]
  );
  return r.rowCount ? { id: r.rows[0].id, amount, party } : null;
}

// ── Semanas ──────────────────────────────────────────────────────────────────────────────────
function addDays(iso, n) {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// El lunes de la semana de `iso` (YYYY-MM-DD).
function mondayOf(iso) {
  const d = new Date(`${iso}T12:00:00Z`);
  const dow = d.getUTCDay(); // 0 = domingo
  return addDays(iso, dow === 0 ? -6 : 1 - dow);
}

function weekOf(dateLike) {
  const hoy = agentCommission.businessDate(dateLike || new Date());
  const start = mondayOf(hoy);
  return { start, end: addDays(start, 6) };
}

// El escalón alcanzado y el siguiente, con las metas de la versión vigente al cierre de la semana.
function goalProgress(count, goals) {
  const lista = Array.isArray(goals) ? goals : [];
  const reached = [...lista].reverse().find((g) => count >= g.jobs) || null;
  const next = lista.find((g) => count < g.jobs) || null;
  return { reached, next, remaining: next ? next.jobs - count : 0 };
}

// Los trabajos COBRADOS de cada agente en la semana: pagados en esas fechas (hora de Texas), sin
// canceladas, incobrables ni contracargos. Solo cuenta desde que existe paid_at (24-sep-2026).
async function paidJobsByAgent(start, end) {
  const r = await pool.query(
    `SELECT q.agent_id, w.id, w.work_order_no, w.customer_name, w.total_sale, w.paid_at
       FROM work_orders w JOIN quotes q ON q.id = w.quote_id
      WHERE w.active <> false AND q.agent_id IS NOT NULL
        AND w.paid_at IS NOT NULL
        AND (w.paid_at AT TIME ZONE '${TZ}')::date BETWEEN $1::date AND $2::date
        AND COALESCE(w.payment->>'paid', 'false') = 'true'
        AND w.status <> 'Cancelled' AND w.uncollectible_at IS NULL AND COALESCE(w.is_chargeback, false) = false
      ORDER BY w.paid_at`,
    [start, end]
  );
  const porAgente = new Map();
  for (const row of r.rows) {
    const id = Number(row.agent_id);
    if (!porAgente.has(id)) porAgente.set(id, []);
    porAgente.get(id).push({
      id: row.id,
      workOrderNo: row.work_order_no,
      customerName: row.customer_name || "",
      totalSale: Number(row.total_sale || 0),
      paidAt: row.paid_at,
    });
  }
  return porAgente;
}

// El tablero de metas de una semana: por agente, cuántos lleva, qué escalón ganó y cuánto le falta.
// `agentIds` limita a esos agentes (el portal del agente pide solo el suyo).
async function weeklyGoals({ date, agentIds } = {}) {
  const planStore = require("../store/agentCommissionPlan.store");
  const agentsStore = require("../store/agents.store");
  const { start, end } = weekOf(date ? `${date}T18:00:00Z` : new Date());
  const trabajos = await paidJobsByAgent(start, end);
  const agentes = agentsStore
    .listBasic()
    .filter((a) => a.status !== "Inactive" && (!agentIds || agentIds.includes(a.id)));
  const filas = [];
  for (const a of agentes) {
    const { versions } = await planStore.versionsForAgent(a.id);
    const version = agentCommission.versionFor(versions, end);
    const goals = version?.goals || [];
    const orders = trabajos.get(a.id) || [];
    // Un agente sin metas y sin trabajos en la semana no aporta nada al tablero.
    if (!goals.length && !orders.length) continue;
    filas.push({ agentId: a.id, agentName: a.name, companyName: a.companyName || "", count: orders.length, goals, ...goalProgress(orders.length, goals), orders });
  }
  filas.sort((x, y) => y.count - x.count || x.agentName.localeCompare(y.agentName));
  const hoy = agentCommission.businessDate(new Date());
  return { weekStart: start, weekEnd: end, closed: hoy > end, daysLeft: hoy > end ? 0 : Math.round((new Date(`${end}T12:00:00Z`) - new Date(`${hoy}T12:00:00Z`)) / 86400000) + 1, agents: filas };
}

// Cierra las semanas ya terminadas: por cada agente que alcanzó un escalón, su bono como obligación
// pendiente. Idempotente (external_id por agente y semana) y se repasan las últimas semanas: si una
// orden se deshace (el pago se quita, se marca incobrable), el bono PENDIENTE se ajusta o se quita.
// Uno ya pagado no se toca — es dinero que salió.
async function closeFinishedWeeks({ weeksBack = 6 } = {}) {
  const agentsStore = require("../store/agents.store");
  const hoy = agentCommission.businessDate(new Date());
  const estaSemana = mondayOf(hoy);
  const resumen = [];
  for (let i = weeksBack; i >= 1; i -= 1) {
    const start = addDays(estaSemana, -7 * i);
    const tablero = await weeklyGoals({ date: start });
    const porAgente = new Map(tablero.agents.map((f) => [f.agentId, f]));
    // También los que no aparecen: si tenían bono pendiente y ya no llegan, se retira.
    const existentes = await pool.query(
      "SELECT id, external_id, amount, status, payout_id FROM payable WHERE source = 'plan_bonus' AND external_id LIKE $1",
      [`plan-bonus:%:${start}`]
    );
    const yaHay = new Map(existentes.rows.map((r) => [r.external_id, r]));
    const ids = new Set([...porAgente.keys(), ...existentes.rows.map((r) => Number(String(r.external_id).split(":")[1]))]);
    for (const agentId of ids) {
      const fila = porAgente.get(agentId);
      const extId = `plan-bonus:${agentId}:${start}`;
      const actual = yaHay.get(extId);
      const monto = round2(fila?.reached?.bonus);
      if (actual && (actual.status === "pagado" || actual.payout_id != null)) continue;
      if (!(monto > 0)) {
        if (actual) {
          await pool.query("DELETE FROM payable WHERE id = $1 AND status = 'pendiente' AND payout_id IS NULL", [actual.id]);
          resumen.push({ week: start, agentId, action: "retirar" });
        }
        continue;
      }
      if (actual) {
        if (round2(actual.amount) !== monto) {
          await pool.query("UPDATE payable SET amount = $2, part_description = $3, updated_at = now() WHERE id = $1", [
            actual.id,
            monto,
            `Bono semanal ${start} a ${tablero.weekEnd}: ${fila.count} trabajos cobrados (meta ${fila.reached.jobs})`,
          ]);
          resumen.push({ week: start, agentId, action: "ajustar", amount: monto });
        }
        continue;
      }
      const agent = agentsStore.listBasic().find((a) => a.id === agentId);
      const party = String(agent?.name || fila.agentName || "").trim();
      if (!party) continue;
      const company = await resolveAgentCompany(pool, party);
      await pool.query(
        `INSERT INTO payable (work_order_no, kind, party, company, amount, status, work_date, source, external_id, part_description)
         VALUES ($1, 'AGENT', $2, $3, $4, 'pendiente', $5::date, 'plan_bonus', $6, $7)
         ON CONFLICT (external_id) DO NOTHING`,
        [`Bono-${start}`, party, company, monto, tablero.weekEnd, extId, `Bono semanal ${start} a ${tablero.weekEnd}: ${fila.count} trabajos cobrados (meta ${fila.reached.jobs})`]
      );
      resumen.push({ week: start, agentId, action: "crear", amount: monto });
    }
  }
  return resumen;
}

module.exports = { recordLeadCommission, weeklyGoals, closeFinishedWeeks, weekOf, goalProgress };
