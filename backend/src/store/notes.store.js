const pool = require("../config/db");

// Notas de credito y debito. Una sola tabla parametrizada por kind, igual que payable: es la misma
// deuda vista desde los dos lados.
//
// Vivia en notes.json mientras los pagos ya estaban en Postgres, asi que la app no veia las 416
// notas importadas de AppSheet y las 3 del JSON no participaban de nada. Ahora las dos poblaciones
// son la misma tabla; las importadas se distinguen por source = 'appsheet'.
//
// Lazy require: payments.store.js no requiere a este, pero este si a aquel, y aquel arrastra
// agents.store.js que a su vez lo requiere de vuelta. Resolver adentro de la funcion evita quedarse
// con un modulo a medio cargar.
function paymentsStore() {
  return require("./payments.store");
}

const PREFIX = { CREDIT: "CN", DEBIT: "DN" };
const ENTITY_TYPES = ["DISTRIBUTOR", "TECHNICIAN", "AGENT"];
const STATUSES = ["Active", "Applied", "Void", "Cancelled"];
// payouts.type usa otra palabra para lo mismo.
const ENTITY_TO_PAYOUT_TYPE = { DISTRIBUTOR: "DISTRIBUTOR", TECHNICIAN: "TECHNICIAN", AGENT: "AGENT" };
// Una nota anulada o cancelada no ajusta nada: deja de sumar pero la fila se conserva. Toma el
// alias porque payouts tambien tiene `active` y sin prefijo la referencia queda ambigua en el join.
const viva = (a = "") => `${a}status NOT IN ('Void', 'Cancelled') AND ${a}active`;

function pad(n) {
  return String(n).padStart(4, "0");
}

function normalizeEntityType(entityType) {
  return ENTITY_TYPES.includes(entityType) ? entityType : "DISTRIBUTOR";
}

// pg entrega DATE como objeto Date, y String(date).slice(0, 10) da "Mon Oct 13", no "2025-10-13":
// se veia asi en pantalla y volvia a entrar en el UPDATE, que lo rechazaba. Se arma a mano en vez
// de con toISOString() porque el Date viene a medianoche LOCAL y toISOString lo corre un dia
// entero segun el huso.
function fechaISO(v) {
  if (!v) return "";
  if (v instanceof Date) {
    return `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, "0")}-${String(v.getDate()).padStart(2, "0")}`;
  }
  return String(v).slice(0, 10);
}

function mapNote(r) {
  if (!r) return null;
  return {
    id: Number(r.id),
    noteNumber: r.note_number,
    noteType: r.kind,
    entityType: r.entity_type,
    entityId: r.entity_ext_id,
    entityName: r.entity_name || "",
    relatedPaymentId: r.payout_id != null ? Number(r.payout_id) : null,
    amount: Number(r.amount || 0),
    reason: r.reason || "",
    description: r.note || "",
    issueDate: fechaISO(r.issue_date),
    attachment: r.attachment || null,
    status: r.status,
    createdBy: r.created_by || "System",
    updatedBy: r.updated_by || null,
    auditLog: r.audit_log || [],
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    // Solo las importadas de AppSheet los traen: de que vidrio se trata y quien comio el costo.
    appliedTo: r.applied_to || null,
    technician: r.technician || null,
    partNumber: r.part_number || null,
    partDescription: r.part_description || "",
    // La factura (o credito) del distribuidor de donde salio el ajuste. Junto con la parte es lo
    // que hace legible una nota: que vidrio es y de donde viene.
    invoiceNumber: r.invoice_number || "",
    payableId: r.payable_id != null ? Number(r.payable_id) : null,
    // Ciclo de vida de la conciliacion. resolution nulo = la parte sigue sin destino.
    resolution: r.resolution || null,
    resolvedAt: r.resolved_at || null,
    resolvedBy: r.resolved_by || null,
    resolutionWorkOrderNo: r.resolution_work_order_no || null,
    chargedToType: r.charged_to_type || null,
    chargePayoutId: r.charge_payout_id != null ? Number(r.charge_payout_id) : null,
    debitNoteId: r.debit_note_id != null ? Number(r.debit_note_id) : null,
    source: r.source || null,
  };
}

function pushAudit(auditLog, user, action, oldValue, newValue) {
  return [...(auditLog || []), {
    user: user || "System",
    timestamp: new Date().toISOString(),
    action,
    oldValue: oldValue ?? null,
    newValue: newValue ?? null,
  }];
}

// El lote se entera de sus notas por aca. Es async y hay que esperarla: escribe en Postgres, y
// dejarla flotando devolvia la nota al cliente mientras el recalculo iba por su cuenta.
//
// Solo ajustan el monto las notas emitidas contra la MISMA parte que cobra el lote. La condicion
// parece redundante — notasParaLote() ya la exige al armar un lote — pero las 116 notas de debito
// que AppSheet colgo de lotes de tecnico son de entity_type DISTRIBUTOR: es vidrio que factura el
// distribuidor y que se le descuenta al tecnico. Siguen ligadas al lote porque ahi esta la traza de
// que vidrio produjo el descuento, pero el descuento en si ya vive en parts_deduction. Sin este
// filtro, editar cualquiera de esas notas volveria a contar $11,265.39 sobre 38 lotes — y sumando,
// porque un debito de distribuidor sube lo que se paga mientras que el cargo al tecnico lo baja.
async function recalculatePayment(paymentId) {
  if (!paymentId) return;
  const r = await pool.query(
    `SELECT n.kind, COALESCE(SUM(n.amount), 0)::numeric AS total
       FROM credit_debit_note n JOIN payouts p ON p.id = n.payout_id
      WHERE n.payout_id = $1 AND ${viva("n.")} AND n.entity_type = p.type
      GROUP BY n.kind`,
    [Number(paymentId)]
  );
  const por = Object.fromEntries(r.rows.map((x) => [x.kind, Number(x.total)]));
  await paymentsStore().applyAdjustmentTotals(paymentId, por.CREDIT || 0, por.DEBIT || 0);
}

// Una nota de distribuidor no puede ajustar un pago de tecnico. Sin esto se colo CN-0001, un abono
// de Mygrant apuntando a un lote de pago de un tecnico: de haberse aplicado le habria bajado el
// pago al tecnico por un credito que dio otro.
async function validarLote(paymentId, entityType) {
  if (!paymentId) return null;
  const r = await pool.query("SELECT id, type FROM payouts WHERE id = $1 AND active <> false", [Number(paymentId)]);
  if (!r.rows[0]) throw new Error(`Payment ${paymentId} does not exist`);
  const esperado = ENTITY_TO_PAYOUT_TYPE[entityType];
  if (r.rows[0].type !== esperado) {
    throw new Error(`A ${entityType} note cannot be applied to a ${r.rows[0].type} payment (${paymentId})`);
  }
  return Number(paymentId);
}

async function list(noteType, filters = {}) {
  const cond = ["kind = $1", "active"];
  const args = [noteType];
  const add = (sql, v) => { args.push(v); cond.push(sql.replace("$$", "$" + args.length)); };
  if (filters.entityType) add("entity_type = $$", filters.entityType);
  if (filters.status) add("status = $$", filters.status);
  if (filters.dateFrom) add("issue_date >= $$::date", filters.dateFrom);
  if (filters.dateTo) add("issue_date <= $$::date", filters.dateTo);
  if (filters.search) {
    add("(COALESCE(note_number,'') || ' ' || COALESCE(reason,'') || ' ' || COALESCE(note,'') || ' ' || COALESCE(entity_name,'') || ' ' || COALESCE(part_number,'')) ILIKE $$",
      "%" + String(filters.search) + "%");
  }
  const r = await pool.query(
    `SELECT * FROM credit_debit_note WHERE ${cond.join(" AND ")} ORDER BY created_at DESC, id DESC`, args);
  return r.rows.map(mapNote);
}

async function get(id) {
  const r = await pool.query("SELECT * FROM credit_debit_note WHERE id = $1 AND active", [Number(id)]);
  return mapNote(r.rows[0]);
}

// Numeracion propia solo para las que nace en la app: las importadas traen ND-0001.. del export y
// las de credito traen la factura de abono del distribuidor, asi que contarlas todas juntas
// generaria numeros repetidos.
async function siguienteNumero(noteType) {
  const p = PREFIX[noteType];
  const r = await pool.query(
    "SELECT COUNT(*)::int AS n FROM credit_debit_note WHERE kind = $1 AND note_number LIKE $2", [noteType, p + "-%"]);
  return `${p}-${pad(r.rows[0].n + 1)}`;
}

async function create(noteType, data, user) {
  const entityType = normalizeEntityType(data.entityType);
  const payoutId = await validarLote(data.relatedPaymentId, entityType);

  const r = await pool.query(
    `INSERT INTO credit_debit_note (kind, note_number, entity_type, entity_name, entity_ext_id, payout_id,
       amount, reason, note, issue_date, attachment, status, created_by, updated_by, audit_log, source,
       part_number, invoice_number, part_description)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::date,$11,'Active',$12,$12,$13,'app',$14,$15,$16) RETURNING *`,
    [noteType, await siguienteNumero(noteType), entityType, data.entityName || "",
     data.entityId != null && data.entityId !== "" ? String(data.entityId) : null, payoutId,
     Number(data.amount || 0), data.reason || "", data.description || "",
     data.issueDate || new Date().toISOString().slice(0, 10),
     data.attachment ? JSON.stringify(data.attachment) : null, user || "System",
     JSON.stringify(pushAudit([], user, "Created", null, { status: "Active", amount: Number(data.amount || 0) })),
     data.partNumber || "", data.invoiceNumber || "", data.partDescription || ""]
  );
  await recalculatePayment(payoutId);
  return get(r.rows[0].id);
}

async function update(id, data, user) {
  const antes = await get(id);
  if (!antes) return null;

  const entityType = data.entityType ? normalizeEntityType(data.entityType) : antes.entityType;
  const payoutId = data.relatedPaymentId !== undefined
    ? await validarLote(data.relatedPaymentId, entityType)
    : antes.relatedPaymentId;
  const amount = data.amount !== undefined ? Number(data.amount) : antes.amount;

  const r = await pool.query(
    `UPDATE credit_debit_note SET entity_type = $2, entity_name = $3, entity_ext_id = $4, payout_id = $5,
       amount = $6, reason = $7, note = $8, issue_date = $9::date, attachment = $10,
       updated_by = $11, audit_log = $12, updated_at = now(),
       part_number = $13, invoice_number = $14, part_description = $15
     WHERE id = $1 AND active RETURNING id`,
    [Number(id), entityType, data.entityName ?? antes.entityName,
     data.entityId !== undefined ? (data.entityId === "" ? null : String(data.entityId)) : antes.entityId,
     payoutId, amount, data.reason ?? antes.reason, data.description ?? antes.description,
     data.issueDate || antes.issueDate || null,
     data.attachment !== undefined ? (data.attachment ? JSON.stringify(data.attachment) : null)
       : (antes.attachment ? JSON.stringify(antes.attachment) : null),
     user || antes.createdBy,
     JSON.stringify(pushAudit(antes.auditLog, user, "Updated", { amount: antes.amount }, { amount })),
     data.partNumber ?? antes.partNumber ?? "", data.invoiceNumber ?? antes.invoiceNumber ?? "",
     data.partDescription ?? antes.partDescription ?? ""]
  );
  if (!r.rows[0]) return null;

  // Si la nota cambio de lote, el lote viejo tambien tiene que recalcularse o se queda con el
  // ajuste de una nota que ya no le pertenece.
  if (antes.relatedPaymentId && antes.relatedPaymentId !== payoutId) await recalculatePayment(antes.relatedPaymentId);
  await recalculatePayment(payoutId);
  return get(id);
}

async function cambiarEstado(id, nuevo, user, accion, extra) {
  const antes = await get(id);
  if (!antes) return null;
  await pool.query(
    `UPDATE credit_debit_note SET status = $2, note = COALESCE($3, note), updated_by = $4,
       audit_log = $5, updated_at = now() WHERE id = $1 AND active`,
    [Number(id), nuevo, extra ?? null, user || antes.createdBy,
     JSON.stringify(pushAudit(antes.auditLog, user, accion, { status: antes.status }, { status: nuevo }))]
  );
  await recalculatePayment(antes.relatedPaymentId);
  return get(id);
}

const apply = async (id, user) => {
  const antes = await get(id);
  if (!antes) return null;
  // "Aplicada" es "ajusta este lote": sin lote, el estado seria mentira — la nota diria Applied y
  // ningun pago la sumaria. Se obliga a enlazarla primero (View / Edit -> Related Payment).
  if (!antes.relatedPaymentId) {
    throw new Error("This note is not linked to any payment. Open View / Edit, pick the Related Payment, save, and then apply it.");
  }
  return cambiarEstado(id, "Applied", user, "Applied", null);
};

function voidNote(id, user, reason) {
  return get(id).then((n) => {
    if (!n) return null;
    const texto = reason ? `${n.description ? n.description + " | " : ""}Void: ${reason}` : null;
    return cambiarEstado(id, "Void", user, "Voided", texto);
  });
}

// Borrar no borra la fila. Una nota de credito es un documento contable: si desaparece, desaparece
// tambien la razon por la que un pago fue menor que la suma de sus obligaciones. Se marca inactiva
// y deja de contar, que es todo lo que el borrado tenia que lograr.
async function remove(id) {
  const antes = await get(id);
  if (!antes) return false;
  await pool.query(
    `UPDATE credit_debit_note SET active = false, status = 'Cancelled', audit_log = $2, updated_at = now()
      WHERE id = $1`,
    [Number(id), JSON.stringify(pushAudit(antes.auditLog, null, "Deleted", { status: antes.status, active: true }, { active: false }))]
  );
  await recalculatePayment(antes.relatedPaymentId);
  return true;
}

async function dashboard(noteType) {
  const mes = new Date().toISOString().slice(0, 7);
  const r = await pool.query(
    `SELECT
       count(*) FILTER (WHERE status = 'Active')::int AS activas,
       COALESCE(SUM(amount) FILTER (WHERE status = 'Active'), 0)::numeric AS pendiente,
       COALESCE(SUM(amount) FILTER (WHERE status = 'Applied' AND to_char(updated_at, 'YYYY-MM') = $2), 0)::numeric AS aplicado
     FROM credit_debit_note WHERE kind = $1 AND active`,
    [noteType, mes]
  );
  const x = r.rows[0];
  return { active: x.activas, appliedThisMonth: Number(x.aplicado), outstanding: Number(x.pendiente) };
}

// Un debito sube lo que se paga y un credito lo baja: el neto es lo que las notas le hacen a la
// caja en conjunto.
async function netFinancialAdjustments() {
  const r = await pool.query(
    `SELECT COALESCE(SUM(amount) FILTER (WHERE kind = 'DEBIT'), 0)::numeric
          - COALESCE(SUM(amount) FILTER (WHERE kind = 'CREDIT'), 0)::numeric AS neto
       FROM credit_debit_note WHERE ${viva()}`);
  return Number(r.rows[0].neto);
}

// Las notas de un pago, por los DOS vinculos. payout_id es lo que se neteo contra la factura del
// distribuidor; charge_payout_id son las partes que ese lote le cobro a un tecnico, y sin ellas la
// pantalla del pago de tecnico decia "No records yet" mientras el total ya descontaba $265.08 —
// el numero estaba, la explicacion no.
//
// Es solo para mostrar. El recalculo sigue mirando unicamente payout_id, porque el descuento al
// tecnico ya vive en parts_deduction y contarlo otra vez aqui lo duplicaria.
async function listByPayment(paymentId) {
  const r = await pool.query(
    `SELECT *, (charge_payout_id = $1) AS es_cargo FROM credit_debit_note
      WHERE (payout_id = $1 OR charge_payout_id = $1) AND active AND status <> 'Cancelled'
      ORDER BY kind, id`,
    [Number(paymentId)]);
  return r.rows.map((x) => ({ ...mapNote(x), chargedHere: x.es_cargo === true }));
}

// Las notas de una parte que todavia no se netearon contra ningun lote: es lo que hay que poder
// elegir al armar un pago. El flujo real empieza aca — la nota nace cuando llega la factura, no
// cuando se paga, y hasta ahora solo se aplicaba si se le cargaba el lote al momento de crearla,
// que es al reves de como pasa.
//
// El tecnico va por otro camino que el distribuidor. Contra el distribuidor se netea lo que el
// facturo (entity_name); al tecnico se le cobra el vidrio que rompio, que lo facturo el
// distribuidor pero lo carga el — por eso se busca por charged_to_type y technician, y el vinculo
// que queda es charge_payout_id, no payout_id.
async function outstandingForEntity(entityType, entityName) {
  const tipo = normalizeEntityType(entityType);
  if (tipo === "TECHNICIAN") {
    const r = await pool.query(
      `SELECT * FROM credit_debit_note
        WHERE kind = 'DEBIT' AND charged_to_type = 'TECHNICIAN' AND resolution = 'TECH'
          AND charge_payout_id IS NULL AND ${viva()}
          AND COALESCE(NULLIF(btrim(technician), ''), '(sin asignar)') = $1
        ORDER BY issue_date NULLS LAST, id`, [entityName]);
    return r.rows.map(mapNote);
  }
  const r = await pool.query(
    `SELECT * FROM credit_debit_note
      WHERE entity_type = $1 AND payout_id IS NULL AND ${viva()}
        AND COALESCE(NULLIF(btrim(entity_name), ''), '(sin asignar)') = $2
      ORDER BY issue_date NULLS LAST, id`,
    [tipo, entityName]
  );
  return r.rows.map(mapNote);
}

// --- la bandeja de conciliacion ---
//
// Una parte esta ABIERTA mientras su costo no haya llegado a ningun lado. Clasificarla no la
// cierra: 'TECH' sin charge_payout_id sigue abierta, porque asignarle el vidrio a un tecnico y no
// descontarselo nunca es exactamente como se acumularon $5,537.77 en 39 partes. Cerrar exige un
// efecto real — una work order que la consumio, un descuento en un pago, una nota de credito del
// distribuidor, o una perdida asumida a proposito.
const ABIERTA = "(resolution IS NULL OR (resolution = 'TECH' AND charge_payout_id IS NULL))";

async function openItems(filters = {}) {
  const cond = ["kind = 'DEBIT'", viva(), ABIERTA];
  const args = [];
  if (filters.distributor) { args.push(filters.distributor); cond.push(`entity_name = $${args.length}`); }
  if (filters.untriaged) cond.push("resolution IS NULL");
  const r = await pool.query(
    `SELECT *, GREATEST(0, (CURRENT_DATE - issue_date))::int AS dias
       FROM credit_debit_note WHERE ${cond.join(" AND ")}
      ORDER BY issue_date NULLS LAST, id`, args);
  return r.rows.map((x) => ({ ...mapNote(x), ageDays: x.dias == null ? null : Number(x.dias) }));
}

// Resumen de la bandeja por antiguedad. Va arriba de la lista porque el numero que hay que mirar
// primero no es cuanto hay abierto sino cuanto lleva abierto.
async function openSummary() {
  const r = await pool.query(
    `SELECT count(*)::int total, COALESCE(SUM(amount),0)::numeric monto,
       count(*) FILTER (WHERE resolution IS NULL)::int sin_clasificar,
       COALESCE(SUM(amount) FILTER (WHERE resolution = 'TECH'),0)::numeric asignado_sin_cobrar,
       count(*) FILTER (WHERE resolution = 'TECH')::int asignado_sin_cobrar_n,
       COALESCE(SUM(amount) FILTER (WHERE issue_date < CURRENT_DATE - 365),0)::numeric mas_de_un_ano,
       count(*) FILTER (WHERE issue_date < CURRENT_DATE - 365)::int mas_de_un_ano_n
     FROM credit_debit_note WHERE kind = 'DEBIT' AND ${viva()} AND ${ABIERTA}`);
  const x = r.rows[0];
  return {
    openCount: x.total,
    openAmount: Number(x.monto),
    untriagedCount: x.sin_clasificar,
    assignedUnchargedCount: x.asignado_sin_cobrar_n,
    assignedUnchargedAmount: Number(x.asignado_sin_cobrar),
    overOneYearCount: x.mas_de_un_ano_n,
    overOneYearAmount: Number(x.mas_de_un_ano),
  };
}

// Las cuatro salidas, y solo cuatro. Cada una tiene que dejar un rastro verificable.
const RESOLUTIONS = ["INSTALLED", "TECH", "RETURNED", "LOSS"];

async function resolveNote(id, resolution, data = {}, user) {
  const nota = await get(id);
  if (!nota) return null;
  if (nota.noteType !== "DEBIT") throw new Error("Only debit notes are reconciled");
  if (!RESOLUTIONS.includes(resolution)) throw new Error(`Unknown resolution: ${resolution}`);

  const campos = { resolution, charged_to_type: null, resolution_work_order_no: null, technician: nota.technician };

  if (resolution === "INSTALLED") {
    // Tiene que existir la orden: cerrar contra una que no existe es volver a poner una etiqueta.
    const wo = String(data.workOrderNo || "").trim();
    if (!wo) throw new Error("A work order is required to close the part as installed");
    const r = await pool.query("SELECT 1 FROM work_orders WHERE work_order_no = $1 AND active <> false", [wo]);
    if (!r.rowCount) throw new Error(`Work order ${wo} does not exist`);
    campos.resolution_work_order_no = wo;
    campos.charged_to_type = "COMPANY";
  } else if (resolution === "TECH") {
    const tech = String(data.technician || nota.technician || "").trim();
    if (!tech) throw new Error("A technician is required to charge the part");
    campos.charged_to_type = "TECHNICIAN";
    campos.technician = tech;
  } else if (resolution === "RETURNED") {
    // No la cierra esta llamada: queda esperando la nota de credito del distribuidor, que es la
    // que prueba que devolvio el dinero.
    campos.charged_to_type = "COMPANY";
  } else {
    campos.charged_to_type = "COMPANY";
  }

  await pool.query(
    `UPDATE credit_debit_note SET resolution = $2, charged_to_type = $3, resolution_work_order_no = $4,
       technician = $5, resolved_at = now(), resolved_by = $6, note = COALESCE($7, note),
       audit_log = $8, updated_at = now() WHERE id = $1 AND active`,
    [Number(id), campos.resolution, campos.charged_to_type, campos.resolution_work_order_no,
     campos.technician, user || "System", data.note ?? null,
     JSON.stringify(pushAudit(nota.auditLog, user, "Resolved",
       { resolution: nota.resolution || null },
       { resolution, workOrder: campos.resolution_work_order_no, technician: campos.technician }))]
  );
  return get(id);
}

// Deshacer una clasificacion la devuelve a la bandeja. Solo si todavia no produjo su efecto: una
// vez que el descuento entro en un pago, lo que hay que anular es el pago, no la nota.
async function reopen(id, user) {
  const nota = await get(id);
  if (!nota) return null;
  if (nota.chargePayoutId) throw new Error("The charge is already in a payment; cancel that payment first");
  await pool.query(
    `UPDATE credit_debit_note SET resolution = NULL, resolution_work_order_no = NULL,
       resolved_at = NULL, resolved_by = NULL, audit_log = $2, updated_at = now() WHERE id = $1 AND active`,
    [Number(id), JSON.stringify(pushAudit(nota.auditLog, user, "Reopened", { resolution: nota.resolution }, null))]
  );
  return get(id);
}

module.exports = {
  ENTITY_TYPES,
  STATUSES,
  list,
  get,
  create,
  update,
  apply,
  void: voidNote,
  remove,
  dashboard,
  netFinancialAdjustments,
  listByPayment,
  outstandingForEntity,
  RESOLUTIONS,
  openItems,
  openSummary,
  resolve: resolveNote,
  reopen,
};
