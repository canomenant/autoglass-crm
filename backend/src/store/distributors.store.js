const workordersStore = require("./workorders.store");
const paymentsStore = require("./payments.store");
const { loadOrSeed, save, nextIdFrom } = require("../lib/persistence");

const FILE = "distributors.json";
let distributors = loadOrSeed(FILE, () => []);
let nextId = nextIdFrom(distributors);

function persist() {
  save(FILE, distributors);
}

const STATUSES = ["Active", "Inactive"];

// Los datos compartidos se cargan UNA vez y las estadísticas de cada distribuidor se calculan en
// memoria sobre ellos. Antes cada ficha disparaba su propia consulta de pagos: listar los 33
// distribuidores eran 33 consultas idénticas contra la base remota, y era lo que hacía tardar
// varios segundos cualquier desplegable de distribuidores (p. ej. el de las notas de crédito).
// Mismo patrón que technicians.store.
async function loadStatsSources() {
  const [orders, payments] = await Promise.all([
    workordersStore.list(),
    paymentsStore.list({ type: "DISTRIBUTOR" }),
  ]);
  return { orders, payments };
}

function statsFrom(id, { orders, payments }) {
  const own = orders.filter((w) => w.distributorId === id);
  const totalPurchased = own.reduce((sum, w) => sum + Number(w.glassCost || 0), 0);
  const averageCost = own.length ? totalPurchased / own.length : 0;
  const openBalances = payments
    .filter((p) => p.distributorId === id && p.status !== "Paid" && p.status !== "Cancelled")
    .reduce((sum, p) => sum + Number(p.totalAmount || 0), 0);
  const lastOrder = own
    .slice()
    .sort((a, b) => new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt))[0];

  return {
    orders: own.length,
    totalPurchased,
    averageCost,
    openBalances,
    lastOrderDate: lastOrder ? (lastOrder.updatedAt || lastOrder.createdAt) : "",
  };
}

async function withStats(item) {
  if (!item) return item;
  return { ...item, stats: statsFrom(item.id, await loadStatsSources()) };
}

async function list() {
  const activos = distributors.filter((d) => d.active !== false);
  const sources = await loadStatsSources();
  return activos.map((d) => ({ ...d, stats: statsFrom(d.id, sources) }));
}

// Para los desplegables (cotizaciones, notas): la ficha sin estadísticas. Calcularlas cuesta la
// lista de órdenes y una consulta de pagos, y un desplegable no las mira.
function listBasic() {
  return distributors.filter((d) => d.active !== false);
}

async function get(id) {
  return withStats(distributors.find((d) => d.id === Number(id) && d.active !== false));
}

function create(data) {
  const distributor = {
    id: nextId,
    name: data.name || "",
    contactName: data.contactName || "",
    phone: data.phone || "",
    mobile: data.mobile || "",
    email: data.email || "",
    address: data.address || "",
    city: data.city || "",
    state: data.state || "",
    zipCode: data.zipCode || "",
    website: data.website || "",
    accountNumber: data.accountNumber || "",
    paymentTerms: data.paymentTerms || "",
    taxId: data.taxId || "",
    notes: data.notes || "",
    logo: data.logo || null,
    status: STATUSES.includes(data.status) ? data.status : "Active",
    active: true,
    deletedAt: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  distributors.push(distributor);
  nextId += 1;
  persist();
  return withStats(distributor);
}

function update(id, data) {
  const distributor = distributors.find((d) => d.id === Number(id) && d.active !== false);
  if (!distributor) return null;
  Object.assign(distributor, {
    name: data.name ?? distributor.name,
    contactName: data.contactName ?? distributor.contactName,
    phone: data.phone ?? distributor.phone,
    mobile: data.mobile ?? distributor.mobile,
    email: data.email ?? distributor.email,
    address: data.address ?? distributor.address,
    city: data.city ?? distributor.city,
    state: data.state ?? distributor.state,
    zipCode: data.zipCode ?? distributor.zipCode,
    website: data.website ?? distributor.website,
    accountNumber: data.accountNumber ?? distributor.accountNumber,
    paymentTerms: data.paymentTerms ?? distributor.paymentTerms,
    taxId: data.taxId ?? distributor.taxId,
    notes: data.notes ?? distributor.notes,
    logo: data.logo !== undefined ? data.logo : distributor.logo,
    status: data.status && STATUSES.includes(data.status) ? data.status : distributor.status,
    updatedAt: new Date().toISOString(),
  });
  persist();
  return withStats(distributor);
}

function remove(id) {
  const distributor = distributors.find((d) => d.id === Number(id) && d.active !== false);
  if (!distributor) return false;
  distributor.active = false;
  distributor.deletedAt = new Date().toISOString();
  persist();
  return true;
}

module.exports = { STATUSES, list, listBasic, get, create, update, remove };
