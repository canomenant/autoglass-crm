const crypto = require("crypto");
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
  // Las columnas de dinero son numeric SIN escala, asi que Postgres guarda tal cual lo que se le
  // mande: 161 + 26.46 en JS da 187.46000000000004 y eso quedaba escrito y luego mostrado. Se
  // redondea aqui, que es el unico lugar por donde pasan todos los montos calculados.
  const c = (v) => Math.round(v * 100) / 100;
  const notas = n(payment.debitNotesTotal) - n(payment.creditNotesTotal);
  if (payment.type === "TECHNICIAN") {
    payment.netAmount = c(n(payment.baseAmount) + n(payment.bonus) - n(payment.deductions) -
      n(payment.cashAdvance) - n(payment.partsDeduction) + n(payment.partsReturn) + notas);
  } else if (payment.type === "DISTRIBUTOR") {
    payment.totalAmount = c(n(payment.subtotal) + n(payment.bonus) - n(payment.deductions) + n(payment.taxAmount) + notas);
  } else if (payment.type === "AGENT") {
    payment.commissionAmount = c(n(payment.grossAmount) + n(payment.bonus) - n(payment.deductions) + notas);
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

function applyFilters(result, filters) {
  if (filters.type) result = result.filter((p) => p.type === filters.type);
  if (filters.status) result = result.filter((p) => p.status === filters.status);
  // "Le pagué algo a X", no "el lote es de X": un lote de distribuidor puede cubrir varias
  // sucursales y uno de agente varios agentes.
  // Para poder recorrer los 226 que faltan por clasificar sin buscarlos entre los 791.
  if (filters.bonusUnclassified === "true" || filters.bonusUnclassified === true) {
    result = result.filter((p) => Number(p.bonus || 0) !== 0 && !p.bonusType);
  }
  if (filters.party) {
    const q = String(filters.party).toLowerCase();
    result = result.filter((p) => (p.parties || []).some((x) => String(x).toLowerCase() === q));
  }
  // Se compara solo la FECHA (10 caracteres): createdAt es timestamp completo, y contra un
  // dateTo de puro día ("2026-08-28") cualquier hora de ese día quedaba fuera del rango — el
  // filtro "hasta" excluía el propio día que el usuario pedía.
  const dia = (p) => String(p.paymentDate || p.createdAt || "").slice(0, 10);
  if (filters.dateFrom) result = result.filter((p) => dia(p) >= String(filters.dateFrom).slice(0, 10));
  if (filters.dateTo) result = result.filter((p) => dia(p) <= String(filters.dateTo).slice(0, 10));
  if (filters.search) {
    const q = String(filters.search).toLowerCase();
    result = result.filter((p) =>
      // El nombre de la parte entra en la busqueda libre: escribir "Joel" es mas rapido que abrir
      // el desplegable, y hasta ahora no encontraba nada porque el lote no sabia de quien era.
      [p.paymentNumber, p.notes, p.invoiceNumber, p.poNumber, p.company, p.primaryAgent, ...(p.parties || [])]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q))
    );
  }
  return result.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

// A quien se le pago sale de las obligaciones, no de payouts. Los tres campos de id
// (technician_id, agent_id, distributor_id) estan nulos en los 791 lotes importados porque el
// import nunca los escribio, y ademas no alcanzarian: un lote no siempre es de una sola parte.
// 135 de 246 lotes de distribuidor le pagan a mas de uno — Dist-0244 cubre Mygrant Austin,
// Carrolton e Irving en la misma factura — y 63 de 250 de agente llevan hasta cuatro. Los de
// tecnico si son de uno solo, los 286.
//
// Por eso filtrar por parte significa "lotes donde a X se le pago algo", que es la pregunta que
// se quiere hacer, y no "el lote pertenece a X", que para la mitad de los lotes no tiene respuesta.
async function list(filters = {}) {
  const r = await pool.query(
    `SELECT o.*, pp.parties, COALESCE(nn.note_debit, 0) AS note_debit, COALESCE(nn.note_credit, 0) AS note_credit,
            -- Los PDFs por factura NO viajan en la lista (mismo problema que los adjuntos de
            -- seguros en quotes: blobs base64 cabalgando en cada carga). Queda la señal
            -- hasAttachment; el detalle (get, SELECT *) si trae los archivos.
            (SELECT COALESCE(jsonb_agg((inv.elem - 'attachment')
                    || jsonb_build_object('hasAttachment', (inv.elem ? 'attachment') AND inv.elem->>'attachment' IS NOT NULL)
                    ORDER BY inv.ord), '[]'::jsonb)
               FROM jsonb_array_elements(o.invoices) WITH ORDINALITY AS inv(elem, ord)) AS invoices_slim
       FROM payouts o
       LEFT JOIN (
         SELECT payout_id, array_agg(DISTINCT btrim(party)) FILTER (WHERE btrim(COALESCE(party,'')) <> '') AS parties
           FROM payable WHERE payout_id IS NOT NULL GROUP BY payout_id
       ) pp ON pp.payout_id = o.id
       LEFT JOIN (
         -- Las notas REALES del lote, con el mismo filtro que recalculatePayment (notes.store):
         -- vivas y de la misma entidad que el tipo del lote. Es lo que el Distributor Report pinta
         -- en Debito/Credito: el avance de la recaptura manual, no la composicion del import.
         SELECT n.payout_id,
                COALESCE(SUM(n.amount) FILTER (WHERE n.kind = 'DEBIT'), 0) AS note_debit,
                COALESCE(SUM(n.amount) FILTER (WHERE n.kind = 'CREDIT'), 0) AS note_credit
           FROM credit_debit_note n JOIN payouts p2 ON p2.id = n.payout_id
          WHERE n.status NOT IN ('Void', 'Cancelled') AND n.active AND n.entity_type = p2.type
          GROUP BY n.payout_id
       ) nn ON nn.payout_id = o.id
      WHERE o.active <> false`
  );
  // En un pago de agente quien cobra es la COMPANIA, no el agente: la comision se le paga a
  // Digiclique aunque adentro vayan trabajos de David Cruz, Ashley Diaz y Kayla Lopez. Las partes
  // de las obligaciones siguen sirviendo para filtrar por agente, pero no son quien recibio el
  // dinero, y ponerlas en "Pagado a" nombraba a cuatro personas que no cobraron nada.
  const filas = r.rows.map((row) => {
    const p = {
      ...withComputed(mapPayment(row)),
      parties: row.parties || [],
      noteDebitTotal: Number(row.note_debit || 0),
      noteCreditTotal: Number(row.note_credit || 0),
    };
    if (row.invoices_slim) p.invoices = row.invoices_slim;
    p.paidTo = p.type === "AGENT" && p.company ? [p.company] : p.parties;
    return p;
  });
  return applyFilters(filas, filters);
}

// Las partes que alguna vez aparecieron en un lote de ese tipo, para poblar el filtro. Sale de
// payable y no de los catalogos porque es la unica lista que garantiza que el filtro devuelva algo.
async function partiesForType(type) {
  const kind = { TECHNICIAN: "TECH", AGENT: "AGENT", DISTRIBUTOR: "DISTRIBUTOR" }[normalizeType(type)];
  const r = await pool.query(
    `SELECT DISTINCT btrim(party) AS party FROM payable
      WHERE kind = $1 AND payout_id IS NOT NULL AND btrim(COALESCE(party,'')) <> ''
      ORDER BY 1`, [kind]);
  return r.rows.map((x) => x.party);
}

async function get(id) {
  const r = await pool.query("SELECT * FROM payouts WHERE id = $1 AND active <> false", [Number(id)]);
  if (!r.rows[0]) return null;
  // La suma de las notas de verdad (mismo filtro que recalculatePayment). El detalle enseña estas,
  // y lo que traen las columnas del import por encima de esto se muestra como UNA linea de
  // "ajustes heredados" — que se encoge a cero conforme Antonio recaptura las notas del lote.
  const n = await pool.query(
    `SELECT n.kind, COALESCE(SUM(n.amount), 0)::numeric AS total
       FROM credit_debit_note n JOIN payouts p ON p.id = n.payout_id
      WHERE n.payout_id = $1 AND n.status NOT IN ('Void', 'Cancelled') AND n.active AND n.entity_type = p.type
      GROUP BY n.kind`,
    [Number(id)]
  );
  const por = Object.fromEntries(n.rows.map((x) => [x.kind, Number(x.total)]));
  return {
    ...withComputed(mapPayment(r.rows[0])),
    noteDebitTotal: por.DEBIT || 0,
    noteCreditTotal: por.CREDIT || 0,
  };
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
       cash_advance, parts_deduction, parts_return, bonus_reason, public_token, public_access_log,
       company, primary_agent, bonus_type, invoice_total, invoices)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,
       $28,$29,$30,$31,$32,$33,$34,$35,$36,$37,$38,$39,$40,$41,$42,$43,$44,$45,$46,$47,$48,$49,$50)
     ON CONFLICT (id) DO UPDATE SET payment_number = EXCLUDED.payment_number, type = EXCLUDED.type,
       status = EXCLUDED.status, payment_method = EXCLUDED.payment_method, payment_date = EXCLUDED.payment_date,
       notes = EXCLUDED.notes, work_order_ids = EXCLUDED.work_order_ids, is_adhoc = EXCLUDED.is_adhoc,
       cash_advance = EXCLUDED.cash_advance, parts_deduction = EXCLUDED.parts_deduction,
       parts_return = EXCLUDED.parts_return, bonus_reason = EXCLUDED.bonus_reason,
       public_token = EXCLUDED.public_token, public_access_log = EXCLUDED.public_access_log,
       company = EXCLUDED.company, primary_agent = EXCLUDED.primary_agent,
       bonus_type = EXCLUDED.bonus_type,
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
       created_by = EXCLUDED.created_by, updated_by = EXCLUDED.updated_by, updated_at = EXCLUDED.updated_at,
       invoice_total = EXCLUDED.invoice_total, invoices = EXCLUDED.invoices`,
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
      // Por que se dio el bono. AppSheet lo itemiza en una tabla hija que no vino en el export,
      // asi que de los 229 lotes con bono ninguno trae explicacion y no hay de donde sacarla.
      payment.bonusReason || null, payment.publicToken || null,
      JSON.stringify(payment.publicAccessLog || []),
      // A quien se le paga la comision: a la compania, no al agente. Digiclique tiene tres.
      payment.company || null, payment.primaryAgent || null, payment.bonusType || null,
      payment.invoiceTotal ?? null,
      JSON.stringify(payment.invoices || []),
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

  // El bono se puede dar desglosado por tipo desde el arranque: su suma ES el bono del lote, igual
  // que despues. Si no vienen renglones se acepta el numero suelto.
  const renglonesBono = Array.isArray(data.bonusItems)
    ? data.bonusItems.filter((x) => Number(x.amount) !== 0)
    : [];
  // Bono y descuentos existen para los tres tipos, no solo para el tecnico. Forzarlos a cero en
  // agente contradecia el histórico — los agentes acumulan $11,462.99 en bonos y $192.00 en
  // descuentos — y hacia imposible registrar uno al crear el lote.
  const bonus = renglonesBono.length
    ? Math.round(renglonesBono.reduce((s, x) => s + Number(x.amount), 0) * 100) / 100
    : Number(data.bonus || 0);
  const deductions = Number(data.deductions || 0);
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
    // Por que se dio el bono. AppSheet lo itemiza en una tabla hija que no vino en el export, asi
    // que los 229 lotes historicos con bono no traen explicacion y no hay de donde sacarla — el de
    // Tech-0011 es por una garantia de 2024, y la base arranca en 2025. Texto libre a proposito:
    // lo que justifica un bono puede vivir enteramente fuera del sistema.
    bonusReason: data.bonusReason || "",
    bonusType: data.bonusType || "",
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
  // Los renglones del bono van despues del write, por lo mismo que las obligaciones: un lote a
  // medio escribir no debe dejar renglones colgando de algo que no existe.
  for (const r of renglonesBono) {
    await pool.query(
      `INSERT INTO payout_bonus_item (payout_id, bonus_type, amount, note, item_date, source)
       VALUES ($1,$2,$3,$4,$5::date,'app')`,
      [payment.id, r.bonusType || null, Number(r.amount), r.note || null, payment.paymentDate || null]);
  }
  return withComputed(payment);
}

// Cada fila: fecha, numero y monto (negativo = credito del distribuidor). Filas sin numero y sin
// monto se descartan — son renglones vacios del editor, no facturas.
function sanitizeInvoices(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((f) => ({
      date: String(f?.date || "").slice(0, 10),
      number: String(f?.number || "").trim(),
      amount: Number(f?.amount || 0),
      attachment: f?.attachment && f.attachment.url ? { name: String(f.attachment.name || "invoice"), url: String(f.attachment.url) } : null,
    }))
    .filter((f) => f.number || f.amount !== 0 || f.attachment);
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
    bonusReason: data.bonusReason ?? payment.bonusReason,
    bonusType: data.bonusType ?? payment.bonusType,
    deductions: data.deductions ?? payment.deductions,
    // Los tres terminos del lote de tecnico. Existian en create() y en el INSERT desde fb6c84e
    // pero nunca aqui, asi que el efectivo que el tecnico cobro de sus trabajos y las partes que
    // se le descuentan entraban en el total y despues no habia forma de corregirlos.
    cashAdvance: data.cashAdvance ?? payment.cashAdvance,
    partsDeduction: data.partsDeduction ?? payment.partsDeduction,
    partsReturn: data.partsReturn ?? payment.partsReturn,
    invoiceNumber: data.invoiceNumber ?? payment.invoiceNumber,
    invoiceTotal: data.invoiceTotal !== undefined
      ? (data.invoiceTotal === "" || data.invoiceTotal === null ? null : Number(data.invoiceTotal))
      : payment.invoiceTotal,
    invoices: data.invoices !== undefined ? sanitizeInvoices(data.invoices) : payment.invoices,
    poNumber: data.poNumber ?? payment.poNumber,
    partNumber: data.partNumber ?? payment.partNumber,
    invoiceDate: data.invoiceDate ?? payment.invoiceDate,
    dueDate: data.dueDate ?? payment.dueDate,
    taxAmount: data.taxAmount ?? payment.taxAmount,
    attachment: data.attachment ?? payment.attachment,
    updatedBy: user || payment.updatedBy,
    updatedAt: new Date().toISOString(),
  });

  // Con lista de facturas, el total facturado ES su suma — es el numero contra el que cuadra el
  // lote, y tenerlo tecleado aparte solo invitaria a que discreparan. Lista vacia = sin capturar.
  if (data.invoices !== undefined) {
    payment.invoiceTotal = payment.invoices.length
      ? Math.round(payment.invoices.reduce((a, f) => a + Number(f.amount || 0), 0) * 100) / 100
      : null;
  }

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

// work_order_ids es derivado (ver writePayoutToSql); despues de mover obligaciones se reescribe
// desde payable, que es quien manda.
async function derivedWorkOrderIds(payoutId) {
  const r = await pool.query(
    "SELECT DISTINCT work_order_no FROM payable WHERE payout_id = $1 AND work_order_no IS NOT NULL ORDER BY work_order_no",
    [Number(payoutId)]
  );
  return r.rows.map((x) => x.work_order_no);
}

// Vincular obligaciones a un lote YA creado. Existe por los lotes adhoc del import PayPal
// (Agent-0252..0324): el dinero ya salio y el lote ya existe, pero sus work orders se capturan
// despues. Mismas reglas que create() — sin reclamar lo de otro lote, sin mezclar tipos — con una
// diferencia deliberada: NO recalcula el monto. Lo pagado es lo pagado; la pantalla ya muestra el
// descuadre contra las obligaciones listadas y se encoge conforme se vinculan.
async function linkObligations(id, payableIds, user) {
  const payment = await get(id);
  if (!payment) return null;
  if (payment.status === "Cancelled") throw new Error("Cannot link obligations to a Cancelled payment");

  const ids = (Array.isArray(payableIds) ? payableIds : []).map((x) => Number(x)).filter(Boolean);
  if (!ids.length) throw new Error("At least one obligation must be selected");

  const payables = await claimedPayables(ids);
  if (payables.length !== ids.length) throw new Error("One or more obligations not found");
  const yaEnLote = payables.filter((x) => x.payout_id != null);
  if (yaEnLote.length) {
    throw new Error(
      "These obligations are already in a payment: " +
        yaEnLote.map((x) => `${x.work_order_no || "(sin WO)"} ${x.party || ""} -> ${x.payment_number || "lote " + x.payout_id}`).join("; ")
    );
  }
  const esperado = payment.type === "TECHNICIAN" ? "TECH" : payment.type;
  const otroTipo = payables.filter((x) => x.kind !== esperado);
  if (otroTipo.length) throw new Error(`Obligations do not match the payment type ${payment.type}`);

  await pool.query(
    "UPDATE payable SET status = 'pagado', payout_id = $2, updated_at = now() WHERE id = ANY($1::bigint[])",
    [ids, payment.id]
  );
  payment.workOrderIds = await derivedWorkOrderIds(payment.id);

  // En los lotes de Digiclique del import primary_agent quedo NULL a proposito: de quien era el
  // trabajo se sabe hasta aqui, cuando las obligaciones llegan. Solo si todas son de la misma
  // persona — si hay varias, el campo se queda vacio y la respuesta la dan las obligaciones.
  if (payment.type === "AGENT" && !payment.primaryAgent) {
    const parties = [...new Set(payables.map((x) => (x.party || "").trim()).filter(Boolean))];
    if (parties.length === 1) payment.primaryAgent = parties[0];
  }

  const monto = payables.reduce((s, x) => s + Number(x.amount || 0), 0);
  payment.updatedBy = user || payment.updatedBy;
  payment.updatedAt = new Date().toISOString();
  pushAudit(payment, user, "Obligations linked", null, {
    count: ids.length,
    amount: Math.round(monto * 100) / 100,
    workOrders: payables.map((x) => x.work_order_no).filter(Boolean),
  });
  await writePayoutToSql(payment);
  return withComputed(payment);
}

// El deshacer de linkObligations, de a una: la obligacion vuelve a pendiente y queda disponible
// para el lote correcto. Solo suelta obligaciones que esten EN este lote — el guard del WHERE es
// la validacion.
async function unlinkObligation(id, payableId, user) {
  const payment = await get(id);
  if (!payment) return null;
  const r = await pool.query(
    "UPDATE payable SET status = 'pendiente', payout_id = NULL, updated_at = now() WHERE id = $1 AND payout_id = $2 RETURNING work_order_no, party, amount",
    [Number(payableId), payment.id]
  );
  if (!r.rowCount) return null;
  payment.workOrderIds = await derivedWorkOrderIds(payment.id);
  payment.updatedBy = user || payment.updatedBy;
  payment.updatedAt = new Date().toISOString();
  const x = r.rows[0];
  pushAudit(payment, user, "Obligation unlinked", { workOrder: x.work_order_no, party: x.party, amount: Number(x.amount) }, null);
  await writePayoutToSql(payment);
  return withComputed(payment);
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

// --- comprobante compartible ---
//
// Mismo criterio que el link movil del tecnico: esto expone cuanto gana una persona, asi que el
// token es una credencial. Se emite a pedido, se registra cada apertura, y se revoca emitiendo
// uno nuevo — no expira, porque alguien puede necesitarlo dias despues, pero uno filtrado tiene
// que poder matarse en un click.
function genToken() {
  return crypto.randomBytes(10).toString("hex");
}

async function ensureStatementToken(id, actor) {
  const payment = await get(id);
  if (!payment) return null;
  if (payment.publicToken) return payment;
  payment.publicToken = genToken();
  payment.publicAccessLog = [...(payment.publicAccessLog || []),
    { timestamp: new Date().toISOString(), via: "token-issued", actor: actor || "System" }];
  await writePayoutToSql(payment);
  return withComputed(payment);
}

async function regenerateStatementToken(id, actor) {
  const payment = await get(id);
  if (!payment) return null;
  const tenia = !!payment.publicToken;
  payment.publicToken = genToken();
  payment.publicAccessLog = [...(payment.publicAccessLog || []), {
    timestamp: new Date().toISOString(),
    via: "token-regenerated",
    actor: actor || "System",
    // El token viejo no se guarda: lo que hace falta saber despues es que existio y dejo de servir.
    hadPreviousToken: tenia,
  }];
  await writePayoutToSql(payment);
  return withComputed(payment);
}

// Lo que ve quien abre el link. Devuelve solo lo del comprobante — nunca la fila entera, que
// arrastra la bitacora de accesos, el token y el log de auditoria interno.
async function statementByToken(token, meta = {}) {
  if (!token) return null;
  const r = await pool.query("SELECT * FROM payouts WHERE public_token = $1 AND active <> false", [String(token)]);
  if (!r.rows[0]) return null;
  const payment = withComputed(mapPayment(r.rows[0]));

  const payableStore = require("./payable.store");
  const notesStore = require("./notes.store");
  const [obligaciones, notas] = await Promise.all([
    payableStore.forPayout(payment.id),
    notesStore.listByPayment(payment.id),
  ]);

  // Se registra la apertura antes de responder: un link filtrado se detecta por aperturas que
  // nadie esperaba, y eso solo sirve si queda escrito.
  // Recortado a las últimas 200: la ruta no tiene sesión, así que quien tenga el token puede
  // provocar tantas aperturas como quiera, y sin tope esta columna JSONB crece sin límite.
  // 200 aperturas es mucho más de lo que un comprobante legítimo ve, y conserva lo que importa
  // (las más recientes) si alguien intenta desbordar el registro para tapar su propia entrada.
  payment.publicAccessLog = [...(payment.publicAccessLog || []),
    { timestamp: new Date().toISOString(), via: "statement-viewed", ip: meta.ip || null }].slice(-200);
  await writePayoutToSql(payment);

  return {
    paymentNumber: payment.paymentNumber,
    type: payment.type,
    status: payment.status,
    paymentDate: payment.paymentDate,
    paymentMethod: payment.paymentMethod,
    amount: payment.amount,
    baseAmount: payment.baseAmount,
    subtotal: payment.subtotal,
    grossAmount: payment.grossAmount,
    bonus: payment.bonus,
    bonusReason: payment.bonusReason,
    deductions: payment.deductions,
    cashAdvance: payment.cashAdvance,
    partsDeduction: payment.partsDeduction,
    partsReturn: payment.partsReturn,
    taxAmount: payment.taxAmount,
    creditNotesTotal: payment.creditNotesTotal,
    debitNotesTotal: payment.debitNotesTotal,
    parties: [...new Set(obligaciones.map((o) => o.party).filter(Boolean))],
    obligations: obligaciones.map((o) => ({
      workOrderNo: o.work_order_no, party: o.party, workDate: o.work_date,
      customerName: o.customer_name, vehicle: o.vehicle,
      partNumber: o.part_number, partDescription: o.part_description, amount: o.amount,
    })),
    invoiceTotal: payment.invoiceTotal,
    invoices: (payment.invoices || []).map((f) => ({
      date: f.date || "", number: f.number || "", amount: Number(f.amount || 0),
    })),
    notes: notas.map((n) => ({
      noteNumber: n.noteNumber, noteType: n.noteType, partNumber: n.partNumber,
      amount: n.amount, chargedHere: n.chargedHere,
      invoiceNumber: n.invoiceNumber || "", reason: n.reason || "", issueDate: n.issueDate || "",
    })),
  };
}

// Las categorias que ya usaba AppSheet en su tabla de bonos, mas WARRANTY (el caso de Tech-0011)
// y OTHER. ADJUSTMENT no se ofrece para elegir: lo pone el script que cuadro los 5 lotes, y marca
// un ajuste contable, no un bono que se le haya dado a nadie.
const BONUS_TYPES = ["CC_HANDLING", "SPIFF", "REVIEWS", "ITEMIZED_INVOICE", "ADMIN_FEE", "CALLING_SERVICE", "INSURANCE_PROCESSED", "TRIP_CANCELLED", "PRIOR_BALANCE", "SALARY", "WARRANTY", "OTHER"];

// --- renglones del bono ---
//
// Un bono puede ser varios: los $161.00 de Agent-0234 son cinco de tipos distintos. Cuando un lote
// tiene renglones, payouts.bonus ES su suma y no se edita aparte — si los dos numeros pudieran
// discrepar, el total del pago dejaria de cuadrar con lo que lo compone.
async function bonusItems(payoutId) {
  const r = await pool.query(
    "SELECT * FROM payout_bonus_item WHERE payout_id = $1 ORDER BY item_date NULLS LAST, id", [Number(payoutId)]);
  return r.rows.map((x) => ({
    id: Number(x.id), bonusType: x.bonus_type || "", amount: Number(x.amount),
    note: x.note || "", itemDate: x.item_date ? String(x.item_date).slice(0, 10) : "", source: x.source || "",
  }));
}

// Recalcula el bono del lote desde sus renglones y arrastra el total. Todo cambio de renglon pasa
// por aqui: es lo unico que garantiza que las dos cifras no se separen.
async function syncBonusFromItems(payoutId, user) {
  const payment = await get(payoutId);
  if (!payment) return null;
  const r = await pool.query(
    "SELECT COALESCE(SUM(amount),0)::numeric s, count(*)::int n FROM payout_bonus_item WHERE payout_id = $1", [Number(payoutId)]);
  if (!r.rows[0].n) return withComputed(payment);   // sin renglones el bono queda como estaba

  const antes = payment.bonus;
  payment.bonus = Number(r.rows[0].s);
  // Con varios tipos, el tipo del lote deja de tener un valor unico: lo dice cada renglon.
  const tipos = (await pool.query(
    "SELECT DISTINCT bonus_type FROM payout_bonus_item WHERE payout_id = $1 AND bonus_type IS NOT NULL", [Number(payoutId)])).rows;
  payment.bonusType = tipos.length === 1 ? tipos[0].bonus_type : tipos.length > 1 ? "MIXED" : payment.bonusType;
  recomputeAmount(payment);
  payment.updatedBy = user || payment.updatedBy;
  payment.updatedAt = new Date().toISOString();
  if (antes !== payment.bonus) {
    pushAudit(payment, user, "Bonus recomputed from its items", { bonus: antes }, { bonus: payment.bonus, items: r.rows[0].n });
  }
  await writePayoutToSql(payment);
  return withComputed(payment);
}

async function addBonusItem(payoutId, data, user) {
  const payment = await get(payoutId);
  if (!payment) return null;
  if (!(Number(data.amount) !== 0)) throw new Error("A bonus item needs an amount");
  await pool.query(
    `INSERT INTO payout_bonus_item (payout_id, bonus_type, amount, note, item_date, source)
     VALUES ($1,$2,$3,$4,$5::date,'app')`,
    [Number(payoutId), data.bonusType || null, Number(data.amount), data.note || null,
     data.itemDate || payment.paymentDate || null]);
  return syncBonusFromItems(payoutId, user);
}

async function removeBonusItem(payoutId, itemId, user) {
  const r = await pool.query("DELETE FROM payout_bonus_item WHERE id = $1 AND payout_id = $2 RETURNING 1",
    [Number(itemId), Number(payoutId)]);
  if (!r.rowCount) return null;
  // Si se quito el ultimo, el bono queda en el valor que tenia: syncBonusFromItems no toca un lote
  // sin renglones, asi que se pone en cero explicitamente.
  const quedan = (await pool.query("SELECT count(*)::int n FROM payout_bonus_item WHERE payout_id = $1", [Number(payoutId)])).rows[0].n;
  if (!quedan) {
    const payment = await get(payoutId);
    payment.bonus = 0;
    recomputeAmount(payment);
    pushAudit(payment, user, "Last bonus item removed", null, { bonus: 0 });
    await writePayoutToSql(payment);
    return withComputed(payment);
  }
  return syncBonusFromItems(payoutId, user);
}

// Que clase de bonos se estan dando. Agrupa por tipo, que es para lo que existe el tipo: el motivo
// en texto libre explica un caso pero no suma con ningun otro.
async function bonusSummary(filters = {}) {
  const cond = ["active <> false", "bonus <> 0"];
  const args = [];
  if (filters.dateFrom) { args.push(filters.dateFrom); cond.push(`payment_date >= $${args.length}`); }
  if (filters.dateTo) { args.push(filters.dateTo); cond.push(`payment_date <= $${args.length}`); }
  if (filters.type) { args.push(filters.type); cond.push(`type = $${args.length}`); }

  // Se agrupa por el tipo del RENGLON donde los hay, y por el del lote donde no. Agrupar por el
  // del lote nada mas contaria los $161.00 de Agent-0234 bajo un solo tipo, cuando son cinco.
  const r = await pool.query(
    `WITH lote AS (SELECT * FROM payouts WHERE ${cond.join(" AND ")})
     SELECT tipo, count(*)::int n, round(SUM(monto), 2) monto FROM (
       SELECT COALESCE(i.bonus_type, 'UNCLASSIFIED') AS tipo, i.amount AS monto
         FROM payout_bonus_item i JOIN lote o ON o.id = i.payout_id
       UNION ALL
       SELECT COALESCE(o.bonus_type, 'UNCLASSIFIED'), o.bonus
         FROM lote o WHERE NOT EXISTS (SELECT 1 FROM payout_bonus_item i WHERE i.payout_id = o.id)
     ) x GROUP BY 1 ORDER BY 3 DESC`, args);

  const porQuien = await pool.query(
    `SELECT COALESCE(NULLIF(btrim(company), ''), type) AS quien, count(*)::int n, round(SUM(bonus), 2) monto
       FROM payouts WHERE ${cond.join(" AND ")} GROUP BY 1 ORDER BY 3 DESC`, args);

  const total = r.rows.reduce((s, x) => s + Number(x.monto), 0);
  return {
    total: Math.round(total * 100) / 100,
    count: r.rows.reduce((s, x) => s + x.n, 0),
    byType: r.rows.map((x) => ({ type: x.tipo, count: x.n, amount: Number(x.monto) })),
    byParty: porQuien.rows.map((x) => ({ party: x.quien, count: x.n, amount: Number(x.monto) })),
  };
}

async function dashboard() {
  const all = await list();
  const now = new Date();
  const monthKey = (d) => (d ? String(d).slice(0, 7) : "");
  const thisMonth = monthKey(now.toISOString());

  // "Pendiente" son las OBLIGACIONES por pagar (work orders con labor/comisión/vidrio sin lote),
  // no lotes en borrador. Contar borradores dejaba las tres tarjetas en 0 permanente — todos los
  // lotes importados están Paid y la oficina no crea borradores — mientras había $230k de órdenes
  // sin pagar que la pantalla no decía en ningún lado (reportado por Antonio, 28-ago-2026).
  const porPagar = await require("./payable.store").summary();
  const pendingTechnician = porPagar.TECH.pendingCount;
  const pendingTechnicianAmount = porPagar.TECH.pendingAmount;
  const pendingDistributor = porPagar.DISTRIBUTOR.pendingCount;
  const pendingDistributorAmount = porPagar.DISTRIBUTOR.pendingAmount;
  const pendingAgent = porPagar.AGENT.pendingCount;
  const pendingAgentAmount = porPagar.AGENT.pendingAmount;

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
    pendingTechnicianAmount,
    pendingDistributor,
    pendingDistributorAmount,
    pendingAgent,
    pendingAgentAmount,
    totalThisMonth,
    totalPaidThisMonth,
    outstandingAmount,
    averageMonthlyPayments,
  };
}

// Marcar o desmarcar un lote como conciliado contra el extracto. Idempotente; devuelve el lote
// completo releído para que la pantalla adopte el resultado sin adivinar.
async function setReconciled(id, reconciled, actor) {
  const r = await pool.query(
    `UPDATE payouts SET reconciled_at = ${reconciled ? "now()" : "NULL"}, reconciled_by = $2, updated_at = now()
      WHERE id = $1 AND active <> false RETURNING id`,
    [id, reconciled ? actor || "" : ""]
  );
  if (!r.rows[0]) return null;
  return get(id);
}

module.exports = {
  setReconciled,
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
  linkObligations,
  unlinkObligation,
  partiesForType,
  BONUS_TYPES,
  bonusSummary,
  bonusItems,
  addBonusItem,
  removeBonusItem,
  ensureStatementToken,
  regenerateStatementToken,
  statementByToken,
  applyAdjustmentTotals,
  dashboard,
};
