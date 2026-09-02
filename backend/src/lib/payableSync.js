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
// Cuando cambia algo de una orden que YA está en un lote de técnico o agente, la cabecera del
// lote se vuelve a derivar de sus órdenes — la misma regla que al enlazar y desenlazar
// (payments.store.baseSigueObligaciones). Se derivan la base (labor / comisión bruta) y, en los
// lotes de técnico, el EFECTIVO: la suma de lo cobrado en las órdenes con método Cash (menos su
// comeback), que es el dinero que el técnico cobró y se quedó. DISTINCT por orden porque con
// técnicos adicionales una misma orden pone dos obligaciones y su cash contaría doble. El neto
// pagado no se toca: es dinero del banco.
async function seguirBaseDelLote(client, payoutId) {
  if (!payoutId) return;
  await client.query(
    `UPDATE payouts p
        SET base_amount  = CASE WHEN p.type = 'TECHNICIAN' THEN sub.s ELSE p.base_amount END,
            gross_amount = CASE WHEN p.type = 'AGENT' THEN sub.s ELSE p.gross_amount END,
            cash_advance = CASE WHEN p.type = 'TECHNICIAN' THEN cash.s ELSE p.cash_advance END,
            updated_at = now()
       FROM (SELECT COALESCE(SUM(amount), 0) AS s FROM payable WHERE payout_id = $1) sub,
            (SELECT COALESCE(SUM(
                      COALESCE(NULLIF(w.payment ->> 'amount', '')::numeric, 0)
                    - COALESCE(NULLIF(w.payment ->> 'cashComeback', '')::numeric, 0)), 0) AS s
               FROM (SELECT DISTINCT work_order_no FROM payable WHERE payout_id = $1) o
               JOIN work_orders w ON w.work_order_no = o.work_order_no AND w.active <> false
              WHERE w.payment ->> 'method' ILIKE '%cash%') cash
      WHERE p.id = $1 AND p.type IN ('TECHNICIAN', 'AGENT')`,
    [payoutId]
  );
}

async function syncObligationsForWorkOrder(workOrder, { agentName, distributorName, partPrices = {}, client = db, dryRun = false } = {}) {
  const wo = workOrder.workOrderNo;
  if (!wo) return { workOrderNo: null, changes: [] };
  const workDate = workDateOf(workOrder);
  const changes = [];

  const targets = targetsFor(workOrder, agentName, distributorName, wo);

  // UNA lectura para todo el sync. Antes cada objetivo hacía dos SELECT y cada tipo otro más al
  // final: hasta ocho viajes a la base por guardado, en serie — con la base remota, eso era la
  // mayor parte de lo que tardaba un Save. Todas esas preguntas se responden con las filas de
  // esta orden (más las propias por external_id, por si alguna quedó con otro work_order_no), así
  // que se traen de una vez y el resto del sync filtra en memoria. Las escrituras siguen yendo
  // una a una: en un guardado sin cambios no hay ninguna.
  const filas = (
    await client.query(
      `SELECT id, work_order_no, kind, party, company, amount, status, payout_id, part_number, external_id
         FROM payable WHERE work_order_no = $1 OR external_id = ANY($2::text[])`,
      [wo, targets.map((t) => t.extId)]
    )
  ).rows;

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
    const ajena = {
      rows: filas.filter(
        (r) =>
          r.work_order_no === wo &&
          r.kind === target.kind &&
          (r.external_id == null || !String(r.external_id).startsWith("auto:"))
      ),
    };
    if (ajena.rows.length) {
      // Manda ella — pero el NOMBRE se mantiene al día con la orden. Un party vacío se completa
      // (Wo-0017 / Dist-0014: 513 llegaron de AppSheet sin nombre), y en DISTRIBUIDOR también se
      // corrige uno lleno cuando la orden dice otra cosa (Wo-0093 / Dist-0003: corregir el
      // distribuidor de la orden no llegaba al pago). Es una etiqueta de quién vendió la parte,
      // no dinero: monto, estado y lote no se tocan. TECH/AGENT solo rellenan vacíos — su party
      // es la persona que cobra, y renombrarla en lotes pagados sí reescribiría historia.
      const desactualizadas = target.party
        ? ajena.rows.filter((r) => {
            const actual = String(r.party || "").trim();
            if (!actual) return true;
            return target.kind === "DISTRIBUTOR" && actual !== target.party;
          })
        : [];
      if (desactualizadas.length) {
        changes.push({ kind: target.kind, action: "actualizar-party", to: target.party, count: desactualizadas.length });
        if (!dryRun) {
          await client.query(
            `UPDATE payable SET party = $2, updated_at = now() WHERE id = ANY($1::bigint[])`,
            [desactualizadas.map((r) => r.id), target.party]
          );
        }
      }

      // Un monto en $0 cuando la linea de la cotizacion YA sabe el precio de ESA parte es dato
      // faltante, igual que un party vacio (reportado con Wo-0289/Wo-0782 en Dist-0010: el import
      // trajo la parte a $0 y corregir el precio en la linea no llegaba al pago). Solo de 0 hacia
      // el precio — un monto distinto de cero nunca se toca: eso si seria reescribir dinero. El
      // subtotal del lote NO se recalcula; si el desglose queda por encima, el aviso de descuadre
      // del detalle lo dice, que es la verdad.
      if (target.kind === "DISTRIBUTOR") {
        const sinMonto = ajena.rows.filter((r) => {
          const parte = String(r.part_number || "").trim();
          return Number(r.amount) === 0 && parte && Number(partPrices[parte] || 0) > 0;
        });
        for (const r of sinMonto) {
          const precio = Number(partPrices[String(r.part_number).trim()]);
          changes.push({ kind: target.kind, action: "completar-monto", part: r.part_number, to: precio });
          if (!dryRun) {
            await client.query(`UPDATE payable SET amount = $2, updated_at = now() WHERE id = $1`, [r.id, precio]);
          }
        }
        if (!desactualizadas.length && !sinMonto.length) changes.push({ kind: target.kind, action: "skip-otra-fuente" });
        continue;
      }

      // TECH y AGENT del import: el labor (o la comisión) que Antonio corrige en la orden debe
      // llegarle a la obligación (pedido del 2-sep-2026: corregir desde el panel de vincular).
      // También cuando ya está EN un lote — su flujo real es enlazar primero y corregir después
      // (Wo-3497 en Tech-0275) — porque el monto de la obligación es el desglose, no el dinero:
      // el total pagado del lote no se recalcula, y si el desglose deja de cuadrarle, el aviso
      // de descuadre del detalle lo dice. Solo el caso inequívoco — una obligación, un solo
      // objetivo de ese tipo en la orden — y con varios el reparto es ambiguo y no se adivina.
      // DISTRIBUTOR queda fuera: su deuda es POR PARTE y se corrige en la línea de la cotización.
      if ((target.kind === "TECH" || target.kind === "AGENT") && (propiosPorTipo.get(target.kind) || []).length === 1) {
        const fila = ajena.rows.length === 1 ? ajena.rows[0] : null;
        if (fila && target.amount > 0 && round2(fila.amount) !== target.amount) {
          changes.push({ kind: target.kind, action: "actualizar-monto-import", from: Number(fila.amount), to: target.amount, linked: fila.payout_id != null });
          if (!dryRun) {
            await client.query(`UPDATE payable SET amount = $2, updated_at = now() WHERE id = $1`, [fila.id, target.amount]);
          }
          continue;
        }
      }

      if (!desactualizadas.length) changes.push({ kind: target.kind, action: "skip-otra-fuente" });
      continue;
    }

    // La nuestra, si existe.
    const actual = filas.find((r) => r.external_id === extId) || null;
    // Ya pagada / en un lote: no se toca.
    if (actual && (actual.status === "pagado" || actual.payout_id != null)) {
      // El monto de un lote cerrado es historia y no se toca; el NOMBRE se mantiene al día con
      // la orden, con la misma regla que la rama de otra fuente: vacío se completa siempre, y en
      // DISTRIBUIDOR también se corrige uno lleno que difiera.
      const partyActual = String(actual.party || "").trim();
      const corregir = target.party && (!partyActual || (target.kind === "DISTRIBUTOR" && partyActual !== target.party));
      if (corregir) {
        changes.push({ kind: target.kind, action: "actualizar-party", to: target.party, count: 1 });
        if (!dryRun) {
          await client.query(`UPDATE payable SET party = $2, updated_at = now() WHERE id = $1`, [actual.id, target.party]);
        }
      }
      // El labor (o la comisión) corregido en la orden alcanza también a la obligación TECH o
      // AGENT ya enlazada, con la misma regla que la rama de otra fuente: es desglose, no dinero
      // — el total del lote no se recalcula. Solo el caso inequívoco de una obligación única.
      if (
        (target.kind === "TECH" || target.kind === "AGENT") &&
        (propiosPorTipo.get(target.kind) || []).length === 1 &&
        target.amount > 0 && round2(actual.amount) !== target.amount
      ) {
        changes.push({ kind: target.kind, action: "actualizar-monto-import", from: Number(actual.amount), to: target.amount, linked: true });
        if (!dryRun) {
          await client.query(`UPDATE payable SET amount = $2, updated_at = now() WHERE id = $1`, [actual.id, target.amount]);
        }
      } else if (!corregir) {
        changes.push({ kind: target.kind, action: "skip-pagada" });
      }
      continue;
    }

    // AGENT: basta con que la orden tenga agente. Una comision en $0.00 es "por capturar", no
    // "no se debe" — Antonio la quiere VER en el panel de vincular para ponerle su comision ahi
    // (pedido del 29-ago-2026: 376 ordenes con agente estaban invisibles por esta condicion).
    // TECH y DISTRIBUTOR conservan la regla: sin monto no hay deuda.
    const debe = target.kind === "AGENT" ? !!target.party : target.amount > 0 && !!target.party;

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

  // Cualquier guardado de la orden refresca la cabecera de los lotes de técnico/agente que la
  // contienen — no solo un cambio de monto: corregir el MÉTODO de pago del cliente también mueve
  // el efectivo derivado del lote, y ese cambio no pasa por ninguna obligación.
  if (!dryRun) {
    const lotes = [...new Set(
      filas.filter((r) => (r.kind === "TECH" || r.kind === "AGENT") && r.payout_id != null).map((r) => r.payout_id)
    )];
    for (const pid of lotes) await seguirBaseDelLote(client, pid);
  }

  // Obligaciones nuestras que ya no le corresponden a nadie: quedan cuando se quita un técnico
  // adicional de la orden. El bucle de arriba sólo recorre los objetivos actuales, así que una
  // obligación cuyo técnico ya no está no la visita nadie y se quedaría cobrándose sola.
  //
  // Sólo las pendientes y sin lote: si ya se pagó, es dinero que salió y es historia, igual que en
  // el resto de este archivo.
  for (const [kind, mios] of propiosPorTipo) {
    const sobrantes = {
      rows: filas.filter(
        (r) =>
          r.work_order_no === wo &&
          r.kind === kind &&
          String(r.external_id || "").startsWith("auto:") &&
          !mios.includes(r.external_id) &&
          r.status !== "pagado" &&
          r.payout_id == null
      ),
    };
    for (const s of sobrantes.rows) {
      changes.push({ kind, action: "eliminar-sobrante", party: s.party, from: Number(s.amount) });
      if (!dryRun) await client.query(`DELETE FROM payable WHERE id = $1`, [s.id]);
    }
  }

  return { workOrderNo: wo, changes: changes.filter((c) => !["sin-cambio", "skip-otra-fuente", "skip-pagada"].includes(c.action)) };
}

module.exports = { syncObligationsForWorkOrder, resolveAgentCompany, clearAgentCompanyCache };
