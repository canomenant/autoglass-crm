const paymentsStore = require("./payments.store");
const { loadOrSeed, save, nextIdFrom } = require("../lib/persistence");

const FILE = "notes.json";
let notes = loadOrSeed(FILE, () => []);
let nextId = nextIdFrom(notes);

function persist() {
  save(FILE, notes);
}

const PREFIX = { CREDIT: "CN", DEBIT: "DN" };
const ENTITY_TYPES = ["DISTRIBUTOR", "TECHNICIAN", "AGENT"];
const STATUSES = ["Active", "Applied", "Void", "Cancelled"];

function pad(n) {
  return String(n).padStart(4, "0");
}

function normalizeEntityType(entityType) {
  return ENTITY_TYPES.includes(entityType) ? entityType : "DISTRIBUTOR";
}

function pushAudit(note, user, action, oldValue, newValue) {
  note.auditLog.push({
    user: user || "System",
    timestamp: new Date().toISOString(),
    action,
    oldValue: oldValue ?? null,
    newValue: newValue ?? null,
  });
}

// applyAdjustmentTotals() escribe en Postgres y es async desde que payments.store paso a SQL.
// Llamarla sin await dejaba la escritura flotando: la nota se guardaba y se devolvia al cliente
// mientras el recalculo del lote iba por su cuenta, y si fallaba el error se perdia en una
// promesa sin dueno. Por eso esta funcion y las cinco que la llaman son async.
async function recalculatePayment(paymentId) {
  if (!paymentId) return;
  const related = notes.filter((n) => n.relatedPaymentId === Number(paymentId) && n.status !== "Void" && n.status !== "Cancelled");
  const creditTotal = related.filter((n) => n.noteType === "CREDIT").reduce((sum, n) => sum + Number(n.amount || 0), 0);
  const debitTotal = related.filter((n) => n.noteType === "DEBIT").reduce((sum, n) => sum + Number(n.amount || 0), 0);
  await paymentsStore.applyAdjustmentTotals(paymentId, creditTotal, debitTotal);
}

function list(noteType, filters = {}) {
  let result = notes.filter((n) => n.noteType === noteType);
  if (filters.entityType) result = result.filter((n) => n.entityType === filters.entityType);
  if (filters.status) result = result.filter((n) => n.status === filters.status);
  if (filters.dateFrom) result = result.filter((n) => n.issueDate >= filters.dateFrom);
  if (filters.dateTo) result = result.filter((n) => n.issueDate <= filters.dateTo);
  if (filters.search) {
    const q = String(filters.search).toLowerCase();
    result = result.filter((n) =>
      [n.noteNumber, n.reason, n.description, n.entityName].filter(Boolean).some((v) => String(v).toLowerCase().includes(q))
    );
  }
  return result.slice().sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

function get(id) {
  return notes.find((n) => n.id === Number(id));
}

async function create(noteType, data, user) {
  const entityType = normalizeEntityType(data.entityType);
  const typeCount = notes.filter((n) => n.noteType === noteType).length + 1;

  const note = {
    id: nextId,
    noteNumber: `${PREFIX[noteType]}-${pad(typeCount)}`,
    noteType,
    entityType,
    entityId: data.entityId ?? null,
    entityName: data.entityName || "",
    relatedPaymentId: data.relatedPaymentId ?? null,
    amount: Number(data.amount || 0),
    reason: data.reason || "",
    description: data.description || "",
    issueDate: data.issueDate || new Date().toISOString().slice(0, 10),
    attachment: data.attachment || null,
    status: "Active",
    createdBy: user || "System",
    auditLog: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  pushAudit(note, user, "Created", null, { status: note.status, amount: note.amount });
  notes.push(note);
  nextId += 1;
  await recalculatePayment(note.relatedPaymentId);
  persist();
  return get(note.id);
}

async function update(id, data, user) {
  const note = notes.find((n) => n.id === Number(id));
  if (!note) return null;
  const before = { amount: note.amount, relatedPaymentId: note.relatedPaymentId };

  Object.assign(note, {
    entityType: data.entityType ? normalizeEntityType(data.entityType) : note.entityType,
    entityId: data.entityId ?? note.entityId,
    entityName: data.entityName ?? note.entityName,
    relatedPaymentId: data.relatedPaymentId !== undefined ? data.relatedPaymentId : note.relatedPaymentId,
    amount: data.amount !== undefined ? Number(data.amount) : note.amount,
    reason: data.reason ?? note.reason,
    description: data.description ?? note.description,
    issueDate: data.issueDate ?? note.issueDate,
    attachment: data.attachment !== undefined ? data.attachment : note.attachment,
    updatedAt: new Date().toISOString(),
  });

  pushAudit(note, user, "Updated", { amount: before.amount }, { amount: note.amount });

  if (before.relatedPaymentId && before.relatedPaymentId !== note.relatedPaymentId) await recalculatePayment(before.relatedPaymentId);
  await recalculatePayment(note.relatedPaymentId);
  persist();
  return get(note.id);
}

async function apply(id, user) {
  const note = notes.find((n) => n.id === Number(id));
  if (!note) return null;
  const oldStatus = note.status;
  note.status = "Applied";
  note.updatedAt = new Date().toISOString();
  pushAudit(note, user, "Applied", { status: oldStatus }, { status: "Applied" });
  await recalculatePayment(note.relatedPaymentId);
  persist();
  return get(note.id);
}

async function voidNote(id, user, reason) {
  const note = notes.find((n) => n.id === Number(id));
  if (!note) return null;
  const oldStatus = note.status;
  note.status = "Void";
  if (reason) note.description = `${note.description ? note.description + " | " : ""}Void: ${reason}`;
  note.updatedAt = new Date().toISOString();
  pushAudit(note, user, "Voided", { status: oldStatus }, { status: "Void" });
  await recalculatePayment(note.relatedPaymentId);
  persist();
  return get(note.id);
}

async function remove(id) {
  const note = notes.find((n) => n.id === Number(id));
  if (!note) return false;
  notes = notes.filter((n) => n.id !== Number(id));
  await recalculatePayment(note.relatedPaymentId);
  persist();
  return true;
}

function dashboard(noteType) {
  const all = notes.filter((n) => n.noteType === noteType);
  const now = new Date();
  const monthKey = (d) => (d ? String(d).slice(0, 7) : "");
  const thisMonth = monthKey(now.toISOString());

  const active = all.filter((n) => n.status === "Active");
  const applied = all.filter((n) => n.status === "Applied");

  return {
    active: active.length,
    appliedThisMonth: applied
      .filter((n) => monthKey(n.updatedAt) === thisMonth)
      .reduce((sum, n) => sum + Number(n.amount || 0), 0),
    outstanding: active.reduce((sum, n) => sum + Number(n.amount || 0), 0),
  };
}

function netFinancialAdjustments() {
  const nonVoid = notes.filter((n) => n.status !== "Void" && n.status !== "Cancelled");
  const totalDebits = nonVoid.filter((n) => n.noteType === "DEBIT").reduce((sum, n) => sum + Number(n.amount || 0), 0);
  const totalCredits = nonVoid.filter((n) => n.noteType === "CREDIT").reduce((sum, n) => sum + Number(n.amount || 0), 0);
  return totalDebits - totalCredits;
}

function listByPayment(paymentId) {
  return notes.filter((n) => n.relatedPaymentId === Number(paymentId) && n.status !== "Cancelled");
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
};
