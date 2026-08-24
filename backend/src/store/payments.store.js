const workordersStore = require("./workorders.store");
const quotesStore = require("./quotes.store");
const pool = require("../config/db");
const { mapPayment } = require("../lib/sqlMappers");

// Lazy require: agents.store.js requires payments.store.js (for computeStats' commissionsPaid),
// so a top-level require here would create a circular dependency and hand one side a
// partially-loaded module. Requiring inside the functions that need it defers resolution
// until both modules have fully finished loading.
function agentsStore() {
  return require("./agents.store");
}

const PREFIX = { TECHNICIAN: "PT", DISTRIBUTOR: "PD", AGENT: "PA" };
const TYPES = ["TECHNICIAN", "DISTRIBUTOR", "AGENT"];
const STATUSES = ["Pending", "Ready For Payment", "Approved", "Paid", "Cancelled"];

function pad(n) {
  return String(n).padStart(4, "0");
}

function normalizeType(type) {
  return TYPES.includes(type) ? type : "TECHNICIAN";
}

function pushAudit(payment, user, action, oldValue, newValue) {
  payment.auditLog.push({
    user: user || "System",
    timestamp: new Date().toISOString(),
    action,
    oldValue: oldValue ?? null,
    newValue: newValue ?? null,
  });
}

// La UNICA formula del monto de un lote. Vivia copiada en create(), update() y
// applyAdjustmentTotals(), y cada copia habia perdido terminos distintos: update() y
// applyAdjustmentTotals() descartaban los tres terminos de efectivo/partes del tecnico —
// los mismos que fb6c84e arreglo en create() y en el INSERT, pero solo ahi — y el
// bonus/descuento del distribuidor y del agente. Medido contra produccion, editar los lotes
// importados los inflaba $185,984.55 en tecnico (148 lotes) y los bajaba $16,927.56 en
// distribuidor (123 lotes), sin que nadie tocara un importe.
//
// OJO al importar las notas de credito de AppSheet: en los 64 lotes de distribuidor con
// descuento, `deductions` YA contiene la suma de sus notas de credito ($11,076.07, verificado
// con diferencia $0.00). Cargar esas notas en creditNotesTotal sin poner `deductions` en cero
// en esos mismos lotes descuenta el mismo dinero dos veces.
function recomputeAmount(payment) {
  const n = (v) => Number(v || 0);
  const notas = n(payment.debitNotesTotal) - n(payment.creditNotesTotal);
  if (payment.type === "TECHNICIAN") {
    payment.netAmount = n(payment.baseAmount) + n(payment.bonus) - n(payment.deductions) -
      n(payment.cashAdvance) - n(payment.partsDeduction) + n(payment.partsReturn) + notas;
  } else if (payment.type === "DISTRIBUTOR") {
    payment.totalAmount = n(payment.subtotal) + n(payment.bonus) - n(payment.deductions) + n(payment.taxAmount) + notas;
  } else if (payment.type === "AGENT") {
    payment.commissionAmount = n(payment.grossAmount) + n(payment.bonus) - n(payment.deductions) + notas;
  }
  return payment;
}

function withComputed(payment) {
  if (!payment) return payment;
  const amount =
    payment.type === "TECHNICIAN"
      ? payment.netAmount
      : payment.type === "DISTRIBUTOR"
      ? payment.totalAmount
      : payment.commissionAmount;
  return { ...payment, amount };
}

// The per-Work-Order amount owed to a given entity, before batch-level adjustments
// (bonus/deductions for Technician, tax for Distributor). Agent uses the agent's own
// catalog commission type/rate rather than re-entering it per batch.
function amountOwedForWorkOrder(type, workOrder, agent) {
  if (type === "TECHNICIAN") return Number(workOrder.laborCost || 0);
  if (type === "DISTRIBUTOR") return Number(workOrder.glassCost || 0);
  if (type === "AGENT") {
    const gross = Number(workOrder.totalSale || 0);
    return agent?.commissionType === "Fixed" ? Number(agent.commissionRate || 0) : (gross * Number(agent?.commissionRate || 0)) / 100;
  }
  return 0;
}

// payable.payout_id es la UNICA fuente de "esto ya se pago". payouts.work_order_ids no sirve para
// decidirlo: es un campo derivado, y ademas razona por orden cuando la deuda es por orden Y por
// parte — 490 work orders tienen mas de una obligacion de distribuidor y 44 tienen dos
// distribuidores distintos, asi que "la orden ya esta en un lote" no responde la pregunta.
// Las notas que el lote va a netear, validadas antes de crear nada. Una nota ya neteada en otro
// lote no puede volver a usarse, y una de otro tipo de parte tampoco: ese fue exactamente el
// error de CN-0001, un abono de distribuidor colgado de un pago de tecnico.
// El tecnico y el distribuidor toman notas por caminos distintos, y no es un detalle. Contra el
// distribuidor se netea lo que el facturo, y el vinculo es payout_id. Al tecnico se le cobra el
// vidrio que rompio — lo facturo el distribuidor, pero lo carga el — y el vinculo es
// charge_payout_id. Meter las dos cosas en la misma columna fue lo que obligo a filtrar por
// entity_type en recalculatePayment para no contar el mismo dinero dos veces.
async function notasParaLote(noteIds, tipoLote) {
  if (!noteIds.length) return [];
  const r = await pool.query(
    `SELECT n.id, n.kind, n.note_number, n.amount, n.entity_type, n.entity_name, n.status,
            n.payout_id, n.charge_payout_id, n.charged_to_type, n.resolution, n.technician,
            o.payment_number, oc.payment_number AS charge_payment_number
       FROM credit_debit_note n
       LEFT JOIN payouts o  ON o.id  = n.payout_id
       LEFT JOIN payouts oc ON oc.id = n.charge_payout_id
      WHERE n.id = ANY($1::bigint[]) AND n.active`,
    [noteIds]
  );
  if (r.rows.length !== noteIds.length) throw new Error("One or more notes not found");

  const muertas = r.rows.filter((x) => x.status === "Void" || x.status === "Cancelled");
  if (muertas.length) throw new Error("Void or cancelled notes cannot be applied: " +
    muertas.map((x) => x.note_number || x.id).join("; "));

  if (tipoLote === "TECHNICIAN") {
    const noCargables = r.rows.filter((x) => x.kind !== "DEBIT" || x.charged_to_type !== "TECHNICIAN" || x.resolution !== "TECH");
    if (noCargables.length) {
      throw new Error("These parts are not charged to a technician: " +
        noCargables.map((x) => x.note_number || x.id).join("; "));
    }
    const yaCobradas = r.rows.filter((x) => x.charge_payout_id != null);
    if (yaCobradas.length) {
      throw new Error("These parts were already charged in a payment: " +
        yaCobradas.map((x) => `${x.note_number || x.id} -> ${x.charge_payment_number || "lote " + x.charge_payout_id}`).join("; "));
    }
    return r.rows;
  }

  const yaNeteadas = r.rows.filter((x) => x.payout_id != null);
  if (yaNeteadas.length) {
    throw new Error("These notes are already netted into a payment: " +
      yaNeteadas.map((x) => `${x.note_number || x.id} -> ${x.payment_number || "lote " + x.payout_id}`).join("; "));
  }
  const otroTipo = r.rows.filter((x) => x.entity_type !== tipoLote);
  if (otroTipo.length) throw new Error(`Notes do not match the payment type ${tipoLote}`);
  return r.rows;
}

async function claimedPayables(payableIds) {
  const r = await pool.query(
    `SELECT p.id, p.work_order_no, p.kind, p.party, p.amount, p.payout_id, o.payment_number
       FROM payable p LEFT JOIN payouts o ON o.id = p.payout_id
      WHERE p.id = ANY($1::bigint[])`,
    [payableIds]
  );
  return r.rows;
}

async function listEligibleWorkOrders(type, entityId) {
  const normalizedType = normalizeType(type);
  // Technician ids are SQL UUID strings (technicians.store.js has been SQL-primary since
  // Fase 4 step 1, and workorders.store.js now writes technician_id in lockstep) — must NOT
  // go through Number(). Agent/distributor stay legacy integers (no SQL table for either).
  const claimed = await claimedWorkOrderIds();
  let workOrders = await workordersStore.list();

  if (normalizedType === "TECHNICIAN") {
    workOrders = workOrders.filter((w) => w.technicianId === entityId);
  } else if (normalizedType === "DISTRIBUTOR") {
    const id = Number(entityId);
    workOrders = workOrders.filter((w) => w.distributorId === id);
  } else {
    const id = Number(entityId);
    const quoteAgentMap = {};
    (await quotesStore.list()).forEach((q) => {
      quoteAgentMap[q.id] = q.agentId;
    });
    workOrders = workOrders.filter((w) => quoteAgentMap[w.quoteId] === id);
  }

  const agent = normalizedType === "AGENT" ? await agentsStore().get(Number(entityId)) : null;

  return workOrders
    .filter((w) => !claimed.has(w.id))
    .map((w) => ({
      id: w.id,
      workOrderNo: w.workOrderNo,
      customerName: w.customerName,
      vehicle: [w.vehicle?.year, w.vehicle?.make, w.vehicle?.model].filter(Boolean).join(" "),
      appointmentDate: w.appointmentDate,
      partNumber: w.partNumber,
      amountOwed: amountOwedForWorkOrder(normalizedType, w, agent),
    }));
}

function applyFilters(result, filters) {
  if (filters.type) result = result.filter((p) => p.type === filters.type);
  if (filters.status) result = result.filter((p) => p.status === filters.status);
  if (filters.dateFrom) result = result.filter((p) => (p.paymentDate || p.createdAt) >= filters.dateFrom);
  if (filters.dateTo) result = result.filter((p) => (p.paymentDate || p.createdAt) <= filters.dateTo);
  if (filters.search) {
    const q = String(filters.search).toLowerCase();
    result = result.filter((p) =>
      [p.paymentNumber, p.notes, p.invoiceNumber, p.poNumber]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q))
    );
  }
  return result.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

async function list(filters = {}) {
  const r = await pool.query("SELECT * FROM payouts WHERE active <> false");
  return applyFilters(r.rows.map(mapPayment).map(withComputed), filters);
}

async function get(id) {
  const r = await pool.query("SELECT * FROM payouts WHERE id = $1 AND active <> false", [Number(id)]);
  if (!r.rows[0]) return null;
  return withComputed(mapPayment(r.rows[0]));
}

// work_order_ids es un campo DERIVADO: se escribe desde las obligaciones del lote y esta solo
// para mostrar. Nunca debe leerse para decidir si algo ya se pago — esa pregunta la responde
// payable.payout_id, que es por obligacion y no por orden.
function writePayoutToSql(payment) {
  return pool.query(
    `INSERT INTO payouts (id, payment_number, type, status, payment_method, payment_date, notes, work_order_ids,
       is_adhoc, technician_id, agent_id, distributor_id, base_amount, bonus, deductions, net_amount,
       invoice_number, po_number, part_number, invoice_date, due_date, tax_amount, subtotal, total_amount,
       attachment, commission_type, commission_rate, gross_amount, commission_amount, credit_notes_total,
       debit_notes_total, transactions, audit_log, active, deleted_at, created_by, updated_by, created_at, updated_at,
       cash_advance, parts_deduction, parts_return)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,
       $28,$29,$30,$31,$32,$33,$34,$35,$36,$37,$38,$39,$40,$41,$42)
     ON CONFLICT (id) DO UPDATE SET payment_number = EXCLUDED.payment_number, type = EXCLUDED.type,
       status = EXCLUDED.status, payment_method = EXCLUDED.payment_method, payment_date = EXCLUDED.payment_date,
       notes = EXCLUDED.notes, work_order_ids = EXCLUDED.work_order_ids, is_adhoc = EXCLUDED.is_adhoc,
       cash_advance = EXCLUDED.cash_advance, parts_deduction = EXCLUDED.parts_deduction,
       parts_return = EXCLUDED.parts_return,
       technician_id = EXCLUDED.technician_id, agent_id = EXCLUDED.agent_id, distributor_id = EXCLUDED.distributor_id,
       base_amount = EXCLUDED.base_amount, bonus = EXCLUDED.bonus, deductions = EXCLUDED.deductions,
       net_amount = EXCLUDED.net_amount, invoice_number = EXCLUDED.invoice_number, po_number = EXCLUDED.po_number,
       part_number = EXCLUDED.part_number, invoice_date = EXCLUDED.invoice_date, due_date = EXCLUDED.due_date,
       tax_amount = EXCLUDED.tax_amount, subtotal = EXCLUDED.subtotal, total_amount = EXCLUDED.total_amount,
       attachment = EXCLUDED.attachment, commission_type = EXCLUDED.commission_type,
       commission_rate = EXCLUDED.commission_rate, gross_amount = EXCLUDED.gross_amount,
       commission_amount = EXCLUDED.commission_amount, credit_notes_total = EXCLUDED.credit_notes_total,
       debit_notes_total = EXCLUDED.debit_notes_total, transactions = EXCLUDED.transactions,
       audit_log = EXCLUDED.audit_log, active = EXCLUDED.active, deleted_at = EXCLUDED.deleted_at,
       created_by = EXCLUDED.created_by, updated_by = EXCLUDED.updated_by, updated_at = EXCLUDED.updated_at`,
    [
      payment.id, payment.paymentNumber, payment.type, payment.status, payment.paymentMethod, payment.paymentDate,
      payment.notes, JSON.stringify(payment.workOrderIds || []), payment.isAdhoc, payment.technicianId,
      payment.agentId, payment.distributorId, payment.baseAmount, payment.bonus, payment.deductions,
      payment.netAmount, payment.invoiceNumber, payment.poNumber, payment.partNumber, payment.invoiceDate,
      payment.dueDate, payment.taxAmount, payment.subtotal, payment.totalAmount,
      payment.attachment ? JSON.stringify(payment.attachment) : null, payment.commissionType,
      payment.commissionRate, payment.grossAmount, payment.commissionAmount, payment.creditNotesTotal,
      payment.debitNotesTotal, JSON.stringify(payment.transactions || []), JSON.stringify(payment.auditLog || []),
      payment.active !== false, payment.deletedAt, payment.createdBy, payment.updatedBy, payment.createdAt,
      payment.updatedAt,
      // Los tres terminos de la formula del lote de tecnico. Sin estas tres lineas se guardaban
      // en el objeto y se descartaban al escribir — mismo patron que ya paso con notes en part
      // numbers, publicAccessLog en work orders y los campos del import de AppSheet.
      payment.cashAdvance || 0, payment.partsDeduction || 0, payment.partsReturn || 0,
    ]
  );
}

async function nextPayoutId() {
  const r = await pool.query("SELECT COALESCE(MAX(id), 0) AS max_id FROM payouts");
  return (Number(r.rows[0] && r.rows[0].max_id) || 0) + 1;
}

// Un lote se arma con obligaciones (payable), no con work orders. Ese es el cambio de fondo: la
// deuda existe por orden Y por parte, y una misma orden puede deberle a dos distribuidores.
async function create(data, user) {
  const type = normalizeType(data.type);
  const payableIds = Array.isArray(data.payableIds) ? data.payableIds.map((id) => Number(id)) : [];
  const noteIds = Array.isArray(data.noteIds) ? data.noteIds.map((id) => Number(id)) : [];
  const notas = await notasParaLote(noteIds, type);
  const isAdhoc = payableIds.length === 0 && data.manualAmount != null;

  if (payableIds.length === 0 && !isAdhoc) throw new Error("At least one obligation must be selected");
  if (isAdhoc && type === "TECHNICIAN") throw new Error("Technician payments must be linked to obligations");
  if (isAdhoc && !(Number(data.manualAmount) > 0)) throw new Error("A manual amount greater than zero is required for an adhoc payment");

  // Sigue haciendo falta para commissionType/commissionRate del lote de agente.
  const agent = type === "AGENT" ? await agentsStore().get(data.agentId) : null;
  let payables = [];
  let workOrderIds = [];
  let baseTotal;

  if (isAdhoc) {
    baseTotal = Number(data.manualAmount);
  } else {
    payables = await claimedPayables(payableIds);
    if (payables.length !== payableIds.length) throw new Error("One or more obligations not found");

    // Nombrar cual y en que lote: "ya esta pagado" sin decir donde obliga a buscarlo a mano.
    const yaEnLote = payables.filter((x) => x.payout_id != null);
    if (yaEnLote.length) {
      throw new Error(
        "These obligations are already in a payment: " +
          yaEnLote.map((x) => `${x.work_order_no || "(sin WO)"} ${x.party || ""} -> ${x.payment_number || "lote " + x.payout_id}`).join("; ")
      );
    }
    const esperado = type === "TECHNICIAN" ? "TECH" : type;
    const otroTipo = payables.filter((x) => x.kind !== esperado);
    if (otroTipo.length) throw new Error(`Obligations do not match the payment type ${type}`);

    baseTotal = payables.reduce((sum, x) => sum + Number(x.amount || 0), 0);
    // Derivado de las obligaciones, nunca recibido del cliente.
    workOrderIds = [...new Set(payables.map((x) => x.work_order_no).filter(Boolean))];
  }

  const bonus = type === "TECHNICIAN" ? Number(data.bonus || 0) : 0;
  const deductions = type === "TECHNICIAN" ? Number(data.deductions || 0) : 0;
  const taxAmount = type === "DISTRIBUTOR" ? Number(data.taxAmount || 0) : 0;
  // Los tres terminos que faltaban: adelantos en efectivo ya entregados, vidrio roto que se le
  // descuenta, y lo que se le devuelve.
  const cashAdvance = type === "TECHNICIAN" ? Number(data.cashAdvance || 0) : 0;
  // El vidrio que se le cobra al tecnico entra por partsDeduction, no por debitNotesTotal. Es el
  // termino que ya existe y ya significa esto — los $11,198.61 historicos estan ahi — y ademas
  // tiene el signo correcto: un debito del distribuidor sube lo que se paga, y el cargo al tecnico
  // lo baja. Sumarlo del otro lado invertiria el sentido.
  const cargoNotas = type === "TECHNICIAN" ? notas.reduce((s, x) => s + Number(x.amount || 0), 0) : 0;
  const partsDeduction = type === "TECHNICIAN" ? Number(data.partsDeduction || 0) + cargoNotas : 0;
  const partsReturn = type === "TECHNICIAN" ? Number(data.partsReturn || 0) : 0;

  const netAmount = type === "TECHNICIAN"
    ? baseTotal + bonus - deductions - cashAdvance - partsDeduction + partsReturn
    : 0;
  const totalAmount = type === "DISTRIBUTOR" ? baseTotal + taxAmount : 0;
  const commissionAmount = type === "AGENT" ? baseTotal : 0;

  const payment = {
    id: await nextPayoutId(),
    paymentNumber: null,
    type,
    status: "Pending",
    paymentMethod: data.paymentMethod || "",
    paymentDate: data.paymentDate || "",
    notes: data.notes || "",

    workOrderIds,
    isAdhoc,

    // technicianId is a SQL UUID string (technicians.store.js UUID ids, Fase 4 step 1+3) —
    // agentId/distributorId stay Number()-coerced legacy integers (no SQL table for either).
    technicianId: type === "TECHNICIAN" ? data.technicianId || null : null,
    agentId: type === "AGENT" ? Number(data.agentId) || null : null,
    distributorId: type === "DISTRIBUTOR" ? Number(data.distributorId) || null : null,

    baseAmount: type === "TECHNICIAN" ? baseTotal : 0,
    bonus,
    deductions,
    cashAdvance,
    partsDeduction,
    partsReturn,
    netAmount,

    invoiceNumber: data.invoiceNumber || "",
    poNumber: data.poNumber || "",
    partNumber: data.partNumber || "",
    invoiceDate: data.invoiceDate || "",
    dueDate: data.dueDate || "",
    taxAmount,
    subtotal: type === "DISTRIBUTOR" ? baseTotal : 0,
    totalAmount,
    attachment: data.attachment || null,

    commissionType: agent?.commissionType || "Percentage",
    commissionRate: agent?.commissionRate ?? 0,
    grossAmount: type === "AGENT" ? baseTotal : 0,
    commissionAmount,

    // Las notas elegidas entran en el monto desde el arranque. Antes solo podian aplicarse
    // creando la nota con el lote ya cargado, que es al reves de como ocurre: primero se rompe
    // el vidrio y despues se paga.
    creditNotesTotal: type === "TECHNICIAN" ? 0 : notas.filter((x) => x.kind === "CREDIT").reduce((s, x) => s + Number(x.amount || 0), 0),
    debitNotesTotal: type === "TECHNICIAN" ? 0 : notas.filter((x) => x.kind === "DEBIT").reduce((s, x) => s + Number(x.amount || 0), 0),

    transactions: [],
    auditLog: [],
    active: true,
    deletedAt: null,
    createdBy: user || "System",
    updatedBy: user || "System",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  // Un lote nuevo todavia no tiene notas, pero pasa por la misma formula que todos los demas:
  // es la unica manera de que create() y update() no vuelvan a divergir.
  recomputeAmount(payment);

  pushAudit(payment, user, "Created", null, { status: payment.status, workOrderCount: workOrderIds.length });
  await writePayoutToSql(payment);

  // El lote toma posesion de sus obligaciones. Va despues del write para que un lote a medio
  // escribir no deje obligaciones apuntando a algo que no existe.
  if (payables.length) {
    await pool.query(
      "UPDATE payable SET status = 'pagado', payout_id = $2, updated_at = now() WHERE id = ANY($1::bigint[])",
      [payables.map((x) => x.id), payment.id]
    );
  }
  // Las notas tambien quedan tomadas por el lote, por la misma razon y en el mismo momento. En el
  // lote de tecnico se estampa charge_payout_id, que es lo que finalmente CIERRA la parte en la
  // bandeja: hasta aca estaba clasificada como "se le cobra al tecnico" pero seguia abierta,
  // porque asignar sin cobrar es como se acumularon las 39 que nadie pago.
  if (notas.length) {
    const col = type === "TECHNICIAN" ? "charge_payout_id" : "payout_id";
    await pool.query(
      `UPDATE credit_debit_note SET ${col} = $2, status = 'Applied', updated_at = now() WHERE id = ANY($1::bigint[])`,
      [notas.map((x) => Number(x.id)), payment.id]
    );
  }
  return withComputed(payment);
}

async function update(id, data, user) {
  const payment = await get(id);
  if (!payment) return null;

  const before = { ...payment };

  Object.assign(payment, {
    paymentMethod: data.paymentMethod ?? payment.paymentMethod,
    paymentDate: data.paymentDate ?? payment.paymentDate,
    notes: data.notes ?? payment.notes,
    bonus: data.bonus ?? payment.bonus,
    deductions: data.deductions ?? payment.deductions,
    invoiceNumber: data.invoiceNumber ?? payment.invoiceNumber,
    poNumber: data.poNumber ?? payment.poNumber,
    partNumber: data.partNumber ?? payment.partNumber,
    invoiceDate: data.invoiceDate ?? payment.invoiceDate,
    dueDate: data.dueDate ?? payment.dueDate,
    taxAmount: data.taxAmount ?? payment.taxAmount,
    attachment: data.attachment ?? payment.attachment,
    updatedBy: user || payment.updatedBy,
    updatedAt: new Date().toISOString(),
  });

  recomputeAmount(payment);

  pushAudit(payment, user, "Updated", { status: before.status }, { status: payment.status });
  await writePayoutToSql(payment);
  return withComputed(payment);
}

async function markReady(id, user) {
  const payment = await get(id);
  if (!payment) return null;
  if (payment.status !== "Pending") throw new Error("Only Pending payments can be marked Ready For Payment");
  payment.status = "Ready For Payment";
  payment.updatedBy = user || payment.updatedBy;
  payment.updatedAt = new Date().toISOString();
  pushAudit(payment, user, "Marked Ready For Payment", { status: "Pending" }, { status: "Ready For Payment" });
  await writePayoutToSql(payment);
  return withComputed(payment);
}

async function approve(id, user) {
  const payment = await get(id);
  if (!payment) return null;
  if (payment.status !== "Ready For Payment") throw new Error("Only Ready For Payment payments can be approved");
  const oldStatus = payment.status;
  payment.status = "Approved";
  if (!payment.paymentNumber) {
    const r = await pool.query("SELECT COUNT(*) AS count FROM payouts WHERE type = $1 AND payment_number IS NOT NULL", [payment.type]);
    const typeCount = Number(r.rows[0].count) + 1;
    payment.paymentNumber = `${PREFIX[payment.type]}-${pad(typeCount)}`;
  }
  payment.updatedBy = user || payment.updatedBy;
  payment.updatedAt = new Date().toISOString();
  pushAudit(payment, user, "Approved", { status: oldStatus }, { status: "Approved", paymentNumber: payment.paymentNumber });
  await writePayoutToSql(payment);
  return withComputed(payment);
}

async function markPaid(id, user, data = {}) {
  const payment = await get(id);
  if (!payment) return null;
  if (payment.status !== "Approved") throw new Error("Only Approved payments can be marked Paid");
  payment.paymentDate = data.paymentDate || payment.paymentDate || new Date().toISOString().slice(0, 10);
  if (data.paymentMethod) payment.paymentMethod = data.paymentMethod;
  payment.transactions.push({
    id: payment.transactions.length + 1,
    transactionReference: data.transactionReference || "",
    paymentGateway: data.paymentGateway || "Manual",
    paymentMethod: data.paymentMethod || payment.paymentMethod,
    amount: withComputed(payment).amount,
    date: payment.paymentDate,
  });
  const oldStatus = payment.status;
  payment.status = "Paid";
  payment.updatedBy = user || payment.updatedBy;
  payment.updatedAt = new Date().toISOString();
  pushAudit(payment, user, "Marked as Paid", { status: oldStatus }, { status: "Paid" });
  await writePayoutToSql(payment);
  return withComputed(payment);
}

async function cancel(id, user, reason) {
  const payment = await get(id);
  if (!payment) return null;
  if (payment.status === "Paid" || payment.status === "Cancelled") throw new Error("Cannot cancel a Paid or already-Cancelled payment");
  if (reason) payment.notes = `${payment.notes ? payment.notes + " | " : ""}Cancelled: ${reason}`;
  const oldStatus = payment.status;
  payment.status = "Cancelled";
  payment.updatedBy = user || payment.updatedBy;
  payment.updatedAt = new Date().toISOString();
  pushAudit(payment, user, "Cancelled", { status: oldStatus }, { status: "Cancelled" });
  await writePayoutToSql(payment);

  // Anular no es borrar: el lote queda como hecho historico en Cancelled y sus obligaciones
  // vuelven a pendiente, disponibles para un lote nuevo. El ON DELETE SET NULL de la FK solo
  // cubre el borrado fisico, que no es este caso.
  const revertidas = await pool.query(
    "UPDATE payable SET status = 'pendiente', payout_id = NULL, updated_at = now() WHERE payout_id = $1 RETURNING 1",
    [payment.id]
  );
  pushAudit(payment, user, "Obligations reverted to pending", null, { count: revertidas.rowCount });

  // Las notas vuelven a quedar disponibles por lo mismo: el abono del distribuidor sigue existiendo
  // aunque el lote se anule, y tiene que poder netearse contra el que lo reemplace. Como el lote
  // anulado ya no las cuenta, sus totales de nota vuelven a cero.
  const notas = await pool.query(
    "UPDATE credit_debit_note SET payout_id = NULL, status = 'Active', updated_at = now() WHERE payout_id = $1 RETURNING amount",
    [payment.id]
  );
  if (notas.rowCount) {
    payment.creditNotesTotal = 0;
    payment.debitNotesTotal = 0;
    recomputeAmount(payment);
    pushAudit(payment, user, "Notes released", null, { count: notas.rowCount });
  }
  // Y las partes que este lote le cobraba a un tecnico vuelven a la bandeja: siguen clasificadas
  // como suyas, pero sin cobrar. El descuento que aportaban sale de partsDeduction, o el lote
  // anulado quedaria descontando un vidrio que ya no esta cobrando.
  const cargos = await pool.query(
    "UPDATE credit_debit_note SET charge_payout_id = NULL, status = 'Active', updated_at = now() WHERE charge_payout_id = $1 RETURNING amount",
    [payment.id]
  );
  if (cargos.rowCount) {
    const monto = cargos.rows.reduce((s, x) => s + Number(x.amount || 0), 0);
    payment.partsDeduction = Math.max(0, Number(payment.partsDeduction || 0) - monto);
    recomputeAmount(payment);
    pushAudit(payment, user, "Charged parts returned to the reconciliation tray", null, { count: cargos.rowCount, amount: monto });
  }
  await writePayoutToSql(payment);
  return withComputed(payment);
}

async function remove(id) {
  const payment = await get(id);
  if (!payment) return false;
  payment.active = false;
  payment.deletedAt = new Date().toISOString();
  await writePayoutToSql(payment);
  return true;
}

async function applyAdjustmentTotals(paymentId, creditTotal, debitTotal) {
  const payment = await get(paymentId);
  if (!payment) return null;
  const before = payment.amount;

  payment.creditNotesTotal = Number(creditTotal || 0);
  payment.debitNotesTotal = Number(debitTotal || 0);
  recomputeAmount(payment);
  payment.updatedAt = new Date().toISOString();

  const after = withComputed(payment).amount;
  if (before !== after) {
    pushAudit(payment, "System", "Recalculated from Credit/Debit Notes", { amount: before }, { amount: after });
  }
  await writePayoutToSql(payment);
  return withComputed(payment);
}

async function dashboard() {
  const all = await list();
  const now = new Date();
  const monthKey = (d) => (d ? String(d).slice(0, 7) : "");
  const thisMonth = monthKey(now.toISOString());

  const pendingTechnician = all.filter((p) => p.type === "TECHNICIAN" && p.status === "Pending").length;
  const pendingDistributor = all.filter((p) => p.type === "DISTRIBUTOR" && p.status === "Pending").length;
  const pendingAgent = all.filter((p) => p.type === "AGENT" && p.status === "Pending").length;

  const totalThisMonth = all
    .filter((p) => monthKey(p.createdAt) === thisMonth)
    .reduce((sum, p) => sum + Number(p.amount || 0), 0);

  const paid = all.filter((p) => p.status === "Paid");
  const totalPaidThisMonth = paid
    .filter((p) => monthKey(p.paymentDate || p.updatedAt) === thisMonth)
    .reduce((sum, p) => sum + Number(p.amount || 0), 0);

  const outstandingAmount = all
    .filter((p) => p.status !== "Paid" && p.status !== "Cancelled")
    .reduce((sum, p) => sum + Number(p.amount || 0), 0);

  const paidByMonth = {};
  paid.forEach((p) => {
    const key = monthKey(p.paymentDate || p.updatedAt);
    paidByMonth[key] = (paidByMonth[key] || 0) + Number(p.amount || 0);
  });
  const months = Object.keys(paidByMonth);
  const averageMonthlyPayments = months.length
    ? months.reduce((sum, m) => sum + paidByMonth[m], 0) / months.length
    : 0;

  return {
    pendingTechnician,
    pendingDistributor,
    pendingAgent,
    totalThisMonth,
    totalPaidThisMonth,
    outstandingAmount,
    averageMonthlyPayments,
  };
}

module.exports = {
  TYPES,
  STATUSES,
  list,
  get,
  create,
  update,
  markReady,
  approve,
  markPaid,
  cancel,
  remove,
  listEligibleWorkOrders,
  applyAdjustmentTotals,
  dashboard,
};
