const pool = require("../config/db");
const listCache = require("./listCache");

// Closed = "de esta orden ya no se debe nada" (Antonio, 15-sep-2026). Paid dice que el cliente
// pagó; Closed dice que además ya se les pagó a todos los que la hicieron posible. Lo que está en
// Paid y no en Closed es, por definición, una orden donde todavía le debemos a alguien.
//
// Las condiciones, todas sobre `payable` (la fuente de verdad de "esto ya se pagó"):
//   - la orden está Paid, o es incobrable (queda en Completed: el trabajo se hizo, el cobro no)
//   - TÉCNICO: tiene obligación y ninguna sigue pendiente
//   - AGENTE: tiene obligación y ninguna sigue pendiente — salvo Alex Reyes, socio que no cobra
//     comisión: la suya queda en $0 pendiente para siempre y no debe impedir el cierre
//   - DISTRIBUTOR: ninguna pendiente. Tenerla solo se exige si la orden trae costo de vidrio: un
//     Chip Repair, un Labor o un Trip no compran parte y el sync no les crea obligación a propósito
//
// "Saldada" es cualquier estado que no sea 'pendiente': 'pagado', 'acreditado' (el distribuidor la
// abonó) y 'retirada' (nunca se cobró). Una comisión de $0 de cualquier OTRO agente sí bloquea: en
// payableSync un $0 de agente es "monto por capturar", no "no se debe".
const SIN_COMISION = ["Alex Reyes"];

async function evaluate(workOrderNos, client = pool) {
  const r = await client.query(
    `SELECT w.id, w.work_order_no, w.status, (w.uncollectible_at IS NOT NULL) AS incobrable,
            (
              EXISTS (SELECT 1 FROM payable p WHERE p.work_order_no = w.work_order_no AND p.kind = 'TECH')
              AND NOT EXISTS (SELECT 1 FROM payable p WHERE p.work_order_no = w.work_order_no AND p.kind = 'TECH' AND p.status = 'pendiente')
              AND EXISTS (SELECT 1 FROM payable p WHERE p.work_order_no = w.work_order_no AND p.kind = 'AGENT')
              AND NOT EXISTS (SELECT 1 FROM payable p WHERE p.work_order_no = w.work_order_no AND p.kind = 'AGENT' AND p.status = 'pendiente'
                                AND COALESCE(btrim(p.party), '') <> ALL($2::text[]))
              AND NOT EXISTS (SELECT 1 FROM payable p WHERE p.work_order_no = w.work_order_no AND p.kind = 'DISTRIBUTOR' AND p.status = 'pendiente')
              AND (COALESCE(w.glass_cost, 0) <= 0
                   OR EXISTS (SELECT 1 FROM payable p WHERE p.work_order_no = w.work_order_no AND p.kind = 'DISTRIBUTOR'))
            ) AS saldada
       FROM work_orders w
      WHERE w.active <> false AND ($1::text[] IS NULL OR w.work_order_no = ANY($1::text[]))`,
    [workOrderNos, SIN_COMISION]
  );
  return r.rows;
}

// A qué estado vuelve una orden que deja de estar saldada: la incobrable nunca estuvo Paid.
const estadoAbierto = (row) => (row.incobrable ? "Completed" : "Paid");
const puedeCerrar = (row) => row.saldada && (row.status === "Paid" || (row.incobrable && row.status === "Completed"));

// Cierra las órdenes que ya cumplen y, con `reopen`, reabre las Closed que dejaron de cumplir.
//
// Reabrir es opt-in porque tiene que ir atado a un HECHO que deshace un pago (anular un lote,
// soltar una obligación), no a la condición: si cada guardado reabriera, un Closed puesto a mano
// sobre una orden con algo pendiente se desharía solo la próxima vez que alguien tocara una nota —
// la misma trampa que ya tuvo el paso automático a Paid.
//
// `workOrderNos` null evalúa todas (lo usa el backfill). Solo escribe lo que cambia, con el estado
// de partida en el WHERE para no pisar un cambio que haya llegado entre la lectura y la escritura.
async function syncClosedStatus(workOrderNos, { reopen = false, actor = "System", dryRun = false, client = pool } = {}) {
  const nos = workOrderNos == null ? null : [...new Set(workOrderNos.map((x) => String(x || "").trim()).filter(Boolean))];
  if (nos && !nos.length) return [];
  const cambios = [];
  for (const row of await evaluate(nos, client)) {
    if (puedeCerrar(row)) cambios.push({ id: row.id, workOrderNo: row.work_order_no, from: row.status, to: "Closed" });
    else if (reopen && row.status === "Closed" && !row.saldada) {
      cambios.push({ id: row.id, workOrderNo: row.work_order_no, from: row.status, to: estadoAbierto(row) });
    }
  }
  if (dryRun || !cambios.length) return cambios;
  for (const to of new Set(cambios.map((c) => c.to))) {
    const grupo = cambios.filter((c) => c.to === to);
    for (const from of new Set(grupo.map((c) => c.from))) {
      await client.query(
        `UPDATE work_orders SET status = $1, updated_at = now(), updated_by = $2
          WHERE id::text = ANY($3::text[]) AND status = $4`,
        [to, actor, grupo.filter((c) => c.from === from).map((c) => String(c.id)), from]
      );
    }
  }
  listCache.invalidate("workorders");
  return cambios;
}

module.exports = { syncClosedStatus, evaluate, SIN_COMISION };
