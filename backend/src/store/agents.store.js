const quotesStore = require("./quotes.store");
const paymentsStore = require("./payments.store");
const { loadOrSeed, save, nextIdFrom } = require("../lib/persistence");
const { hashPassword } = require("../lib/password");
const pool = require("../config/db");

// Los agentes viven en app_data (JSON), pero quotes.agent_id lleva llave foránea a cat_agent en
// SQL. Los tres de Digiclique (David Cruz, Ashley Diaz, Kayla Lopez) se dieron de alta sólo en
// app_data y elegirlos como agente referidor tiraba "Internal server error" al guardar la
// cotización (Antonio, 20-sep-2026: quotes_agent_id_fkey, agent_id=10). Cada alta o cambio de
// nombre se refleja aquí; una baja NO borra la fila, porque las cotizaciones viejas la apuntan.
async function mirrorToSql(item) {
  const { password, tokenVersion, ...extra } = item;
  try {
    await pool.query(
      `INSERT INTO cat_agent (id, name, source_id, extra) VALUES ($1, $2, $3, $4)
       ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, extra = EXCLUDED.extra`,
      [item.id, item.name, String(item.id), JSON.stringify(extra)]
    );
  } catch (err) {
    console.error(`[agents] no se pudo reflejar el agente ${item.id} en cat_agent:`, err.message);
  }
}

const FILE = "agents.json";
let items = loadOrSeed(FILE, () => []);
let nextId = nextIdFrom(items);

function persist() {
  save(FILE, items);
}

const STATUSES = ["Active", "Inactive"];
const COMMISSION_TYPES = ["Fixed", "Percentage"];

// Los datos compartidos se cargan UNA vez y las estadísticas por agente se calculan en memoria.
// Antes cada ficha disparaba su propia consulta de pagos: listar N agentes eran N consultas
// idénticas contra la base remota. Mismo patrón que technicians.store y distributors.store.
async function loadStatsSources() {
  const [quotes, payments] = await Promise.all([quotesStore.list(), paymentsStore.list({ type: "AGENT" })]);
  return { quotes, payments };
}

function statsFrom(id, { quotes, payments }) {
  const own = quotes.filter((q) => q.agentId === id);
  const converted = own.filter((q) => q.status === "Converted");
  const revenueGenerated = converted.reduce((sum, q) => sum + Number(q.totals?.totalAmount || 0), 0);
  const commissionsPaid = payments
    .filter((p) => p.agentId === id && p.status === "Paid")
    .reduce((sum, p) => sum + Number(p.commissionAmount || 0), 0);

  return {
    leadsSent: own.length,
    quotesGenerated: own.length,
    workOrdersSold: converted.length,
    revenueGenerated,
    commissionsPaid,
  };
}

function sanitize(item) {
  if (!item) return item;
  // tokenVersion es estado interno de la sesión, no un campo del recurso: no forma parte de la
  // ficha del agente y no tiene por qué salir por la API.
  const { password, tokenVersion, ...rest } = item;
  return rest;
}

async function withStats(item) {
  if (!item) return item;
  return { ...sanitize(item), stats: statsFrom(item.id, await loadStatsSources()) };
}

async function list() {
  const activos = items.filter((i) => i.active !== false);
  const sources = await loadStatsSources();
  return activos.map((i) => ({ ...sanitize(i), stats: statsFrom(i.id, sources) }));
}

// Para los desplegables (formularios de notas, filtros): la ficha sin estadísticas. Calcularlas
// cuesta la lista de cotizaciones y una consulta de pagos, y un desplegable no las mira.
function listBasic() {
  return items.filter((i) => i.active !== false).map(sanitize);
}

async function get(id) {
  return withStats(items.find((i) => i.id === Number(id) && i.active !== false));
}

function findByEmail(email) {
  return items.find((i) => i.active !== false && i.email && i.email.toLowerCase() === String(email).toLowerCase());
}

// Lo mínimo que requireAuth necesita para decidir si un token sigue siendo válido, y nada más.
// Deliberadamente aparte de get(): ése pasa por withStats(), que recorre TODAS las cotizaciones
// y TODOS los pagos para calcular las estadísticas de la ficha. Eso una vez por petición
// autenticada dejaría la API inservible.
function authState(id) {
  const item = items.find((i) => i.id === Number(id) && i.active !== false);
  return item ? { status: item.status, tokenVersion: item.tokenVersion || 0 } : null;
}

async function create(data) {
  const item = {
    id: nextId,
    name: data.name || "",
    companyName: data.companyName || "",
    phone: data.phone || "",
    email: data.email || "",
    password: data.password ? await hashPassword(data.password) : "",
    mustChangePassword: !!data.password,
    // Se incrementa al cambiar la contraseña; requireAuth compara este número con el que lleva
    // el token, de modo que los emitidos antes del cambio dejan de valer en el acto.
    tokenVersion: 0,
    address: data.address || "",
    commissionType: COMMISSION_TYPES.includes(data.commissionType) ? data.commissionType : "Percentage",
    commissionRate: data.commissionRate ?? 0,
    taxId: data.taxId || "",
    notes: data.notes || "",
    photo: data.photo || null,
    status: STATUSES.includes(data.status) ? data.status : "Active",
    active: true,
    deletedAt: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  items.push(item);
  nextId += 1;
  persist();
  await mirrorToSql(item);
  return withStats(item);
}

async function update(id, data) {
  const item = items.find((i) => i.id === Number(id) && i.active !== false);
  if (!item) return null;
  Object.assign(item, {
    name: data.name ?? item.name,
    companyName: data.companyName ?? item.companyName,
    phone: data.phone ?? item.phone,
    email: data.email ?? item.email,
    password: data.password ? await hashPassword(data.password) : item.password,
    mustChangePassword: data.mustChangePassword ?? item.mustChangePassword,
    tokenVersion: data.tokenVersion ?? item.tokenVersion ?? 0,
    address: data.address ?? item.address,
    commissionType: data.commissionType && COMMISSION_TYPES.includes(data.commissionType) ? data.commissionType : item.commissionType,
    commissionRate: data.commissionRate ?? item.commissionRate,
    taxId: data.taxId ?? item.taxId,
    notes: data.notes ?? item.notes,
    photo: data.photo !== undefined ? data.photo : item.photo,
    status: data.status && STATUSES.includes(data.status) ? data.status : item.status,
    updatedAt: new Date().toISOString(),
  });
  persist();
  await mirrorToSql(item);
  return withStats(item);
}

function remove(id) {
  const item = items.find((i) => i.id === Number(id) && i.active !== false);
  if (!item) return false;
  item.active = false;
  item.deletedAt = new Date().toISOString();
  persist();
  return true;
}

module.exports = { STATUSES, COMMISSION_TYPES, list, listBasic, get, create, update, remove, findByEmail, authState };
