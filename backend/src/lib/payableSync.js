const db = require("../config/db");

// Crea y mantiene al día las obligaciones de pago de una orden de trabajo.
//
// El problema que resuelve: hasta ahora las obligaciones (lo que se le debe a un agente, a un
// técnico o a un distribuidor) sólo existían porque las creó el import de AppSheet, hasta Wo-3865.
// La aplicación NO las generaba al convertir un presupuesto ni al editar la orden, así que cada
// orden nueva con comisión/labor/vidrio quedaba fuera de Cuentas por Pagar (p. ej. Wo-3933).
//
// Reglas, pensadas para no tocar nunca lo que no es suyo:
//   - Sólo gestiona obligaciones creadas por él (source='auto_sync'), identificadas de forma
//     determinista por external_id = 'auto:<kind>:<work_order_no>'.
//   - Si una orden ya tiene una obligación de ese tipo de OTRA procedencia (el import, o una
//     manual), no la duplica ni la toca: esa manda.
//   - Nunca modifica una obligación ya pagada (status='pagado' o con payout_id): es dinero que
//     ya salió, es historia.
//   - Si el monto de un tipo baja a 0 (se quitó la comisión, se desasignó el técnico), su
//     obligación auto PENDIENTE se elimina, porque ya no se debe.
//
// amount por tipo: AGENT = commission, TECH = laborCost, DISTRIBUTOR = glassCost.

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

// La compañía con la que se agrupa a un agente al pagarle (Digiclique junta a tres). NO está en el
// catálogo de agentes —companyName viene vacío— sino en el histórico de pagos, así que se resuelve
// desde ahí: la compañía más usada para ese agente. Si no hay histórico, la compañía es el propio
// nombre (agente independiente, como Edgar Medina). Cacheado por ejecución.
const _companyCache = new Map();
async function resolveAgentCompany(client, agentName) {
  const name = String(agentName || "").trim();
  if (!name) return null;
  if (_companyCache.has(name)) return _companyCache.get(name);
  const r = await client.query(
    `SELECT company FROM payable
      WHERE kind = 'AGENT' AND btrim(party) = $1 AND company IS NOT NULL AND btrim(company) <> ''
      GROUP BY company ORDER BY count(*) DESC LIMIT 1`,
    [name]
  );
  const company = r.rows[0] ? r.rows[0].company : name;
  _companyCache.set(name, company);
  return company;
}

function clearAgentCompanyCache() {
  _companyCache.clear();
}

// Los tres tipos que puede tener una orden, con de dónde sale el monto y la parte.
//
// El distribuidor NO siempre está en workOrder.distributor: en las órdenes creadas en la app ese
// campo suele venir vacío y el distribuidor real vive en la línea del presupuesto. El caller
// resuelve eso (igual que el panel de la orden) y lo pasa en distributorName; si no, se cae al
// campo de la orden.
// Cuando la orden la hicieron varios técnicos hay una obligación TECH por cabeza, no una sola.
//
// El técnico principal conserva el external_id de siempre -'auto:tech:<orden>', sin sufijo- para
// que las obligaciones que ya existen se sigan reconociendo como propias; los adicionales llevan
// su id de técnico pegado. Su monto NO se reparte: cada uno trae el suyo (en Wo-3384 son $120 y
// $200, no mitad y mitad), y como labor_cost es el total de la orden, al principal le toca lo que
// queda después de los demás.
function techTargets(workOrder, wo) {
  const extras = Array.isArray(workOrder.extraTechs) ? workOrder.extraTechs : [];
  const sumaExtras = extras.reduce((acc, t) => acc + round2(t?.laborCost), 0);
  const principal = {
    kind: "TECH",
    extId: `auto:tech:${wo}`,
    amount: round2(round2(workOrder.laborCost) - round2(sumaExtras)),
    party: String(workOrder.tech || "").trim(),
    needsCompany: false,
  };
  return [
    principal,
    ...extras.map((t, i) => ({
      kind: "TECH",
      // El id del técnico es lo estable; el índice sólo salva al que se capturó sin id.
      extId: `auto:tech:${wo}:${t?.technicianId || `n${i}`}`,
      amount: round2(t?.laborCost),
      party: String(t?.name || "").trim(),
      needsCompany: false,
    })),
  ];
}

function targetsFor(workOrder, agentName, distributorName, wo) {
  return [
    { kind: "AGENT", extId: `auto:agent:${wo}`, amount: round2(workOrder.commission), party: String(agentName || "").trim(), needsCompany: true },
    ...techTargets(workOrder, wo),
    { kind: "DISTRIBUTOR", extId: `auto:distributor:${wo}`, amount: round2(workOrder.glassCost), party: String(distributorName || workOrder.distributor || "").trim(), needsCompany: false },
  ];
}

function workDateOf(workOrder) {
  const raw = workOrder.appointmentDate || workOrder.createdAt || null;
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

// Sincroniza las tres obligaciones de una orden. Devuelve un resumen de lo que hizo, útil para el
// dry-run del backfill. `client` permite correr dentro de una transacción; por defecto usa el pool.
async function syncObligationsForWorkOrder(workOrder, { agentName, distributorName, client = db, dryRun = false } = {}) {
  const wo = workOrder.workOrderNo;
  if (!wo) return { workOrderNo: null, changes: [] };
  const workDate = workDateOf(workOrder);
  const changes = [];

  const targets = targetsFor(workOrder, agentName, distributorName, wo);

  // Todos los external_id que este sync reconoce como suyos, agrupados por tipo. Con varios
  // técnicos hay más de una obligación TECH nuestra, y comparando contra uno solo cada una vería a
  // la otra como "de otra fuente": las dos se saltarían y no se crearía ninguna.
  const propiosPorTipo = new Map();
  for (const t of targets) {
    if (!propiosPorTipo.has(t.kind)) propiosPorTipo.set(t.kind, []);
    propiosPorTipo.get(t.kind).push(t.extId);
  }

  for (const target of targets) {
    const extId = target.extId;

    // ¿Existe ya alguna obligación de este tipo para esta orden que NO sea la nuestra?
    // (el import, o una creada a mano). Si la hay, manda ella: ni se duplica ni se toca.
    //
    // "Nuestra" es cualquiera con el prefijo 'auto:', no sólo las que este pase va a escribir. La
    // diferencia importa al quitar un técnico adicional: su obligación deja de estar entre los
    // objetivos, y compararla contra la lista de objetivos la haría pasar por ajena. Eso hacía que
    // el sync se saltara TAMBIÉN al principal, que se quedaba con el monto viejo. Las sobrantes se
    // borran más abajo.
    const ajena = await client.query(
      `SELECT 1 FROM payable
        WHERE work_order_no = $1 AND kind = $2
          AND (external_id IS NULL OR external_id NOT LIKE 'auto:%')
        LIMIT 1`,
      [wo, target.kind]
    );
    if (ajena.rows.length) {
      changes.push({ kind: target.kind, action: "skip-otra-fuente" });
      continue;
    }

    // La nuestra, si existe.
    const propia = await client.query(
      `SELECT id, amount, party, company, status, payout_id FROM payable WHERE external_id = $1`,
      [extId]
    );
    const actual = propia.rows[0] || null;
    // Ya pagada / en un lote: no se toca.
    if (actual && (actual.status === "pagado" || actual.payout_id != null)) {
      changes.push({ kind: target.kind, action: "skip-pagada" });
      continue;
    }

    const debe = target.amount > 0 && !!target.party;

    if (!debe) {
      // No se debe nada de este tipo: si teníamos una pendiente, sobra.
      if (actual) {
        changes.push({ kind: target.kind, action: "eliminar", from: Number(actual.amount) });
        if (!dryRun) await client.query(`DELETE FROM payable WHERE id = $1`, [actual.id]);
      }
      continue;
    }

    const company = target.needsCompany ? await resolveAgentCompany(client, target.party) : null;

    if (!actual) {
      changes.push({ kind: target.kind, action: "crear", amount: target.amount, party: target.party, company });
      if (!dryRun) {
        await client.query(
          `INSERT INTO payable (work_order_no, kind, party, company, amount, status, work_date, source, external_id)
           VALUES ($1,$2,$3,$4,$5,'pendiente',$6::date,'auto_sync',$7)
           ON CONFLICT (external_id) DO NOTHING`,
          [wo, target.kind, target.party, company, target.amount, workDate, extId]
        );
      }
    } else {
      // Existe una pendiente nuestra: se ajusta a lo que dice la orden ahora.
      const cambia =
        round2(actual.amount) !== target.amount ||
        String(actual.party || "").trim() !== target.party ||
        String(actual.company || "") !== String(company || "");
      if (cambia) {
        changes.push({ kind: target.kind, action: "actualizar", from: Number(actual.amount), to: target.amount, party: target.party });
        if (!dryRun) {
          await client.query(
            `UPDATE payable SET amount = $2, party = $3, company = $4, work_date = $5::date, updated_at = now() WHERE id = $1`,
            [actual.id, target.amount, target.party, company, workDate]
          );
        }
      } else {
        changes.push({ kind: target.kind, action: "sin-cambio" });
      }
    }
  }

  // Obligaciones nuestras que ya no le corresponden a nadie: quedan cuando se quita un técnico
  // adicional de la orden. El bucle de arriba sólo recorre los objetivos actuales, así que una
  // obligación cuyo técnico ya no está no la visita nadie y se quedaría cobrándose sola.
  //
  // Sólo las pendientes y sin lote: si ya se pagó, es dinero que salió y es historia, igual que en
  // el resto de este archivo.
  for (const [kind, mios] of propiosPorTipo) {
    const sobrantes = await client.query(
      `SELECT id, party, amount FROM payable
        WHERE work_order_no = $1 AND kind = $2
          AND external_id LIKE 'auto:%' AND external_id <> ALL($3::text[])
          AND status <> 'pagado' AND payout_id IS NULL`,
      [wo, kind, mios]
    );
    for (const s of sobrantes.rows) {
      changes.push({ kind, action: "eliminar-sobrante", party: s.party, from: Number(s.amount) });
      if (!dryRun) await client.query(`DELETE FROM payable WHERE id = $1`, [s.id]);
    }
  }

  return { workOrderNo: wo, changes: changes.filter((c) => !["sin-cambio", "skip-otra-fuente", "skip-pagada"].includes(c.action)) };
}

module.exports = { syncObligationsForWorkOrder, resolveAgentCompany, clearAgentCompanyCache };
