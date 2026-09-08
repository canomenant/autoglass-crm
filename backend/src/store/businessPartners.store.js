const { loadOrSeed, save, nextIdFrom } = require("../lib/persistence");

const FILE = "businessPartners.json";
let items = loadOrSeed(FILE, () => []);
let nextId = nextIdFrom(items);

function persist() {
  save(FILE, items);
}

function list() {
  return items;
}

function get(id) {
  return items.find((i) => i.id === Number(id));
}

function normalizeRates(rates) {
  if (!Array.isArray(rates)) return [];
  return rates
    .map((r) => ({ jobTypeId: Number(r.jobTypeId), amount: Number(r.amount) || 0 }))
    .filter((r) => Number.isFinite(r.jobTypeId));
}

// Looks up this partner's configured rate for a job type by name (line items/work orders
// reference job types by name, not id — same "not a real FK" pattern as the Job Type catalog
// itself). Returns undefined if the partner has no rate configured for that job type, which
// callers treat as "doesn't apply to this partner" rather than "applies for $0".
// Tarifa única por trabajo (Antonio, 7-sep-2026: "$25 por work order pagada"): si el socio la
// tiene, manda sobre las tarifas por tipo de trabajo.
function rateForJobType(partner, jobTypeName, jobTypesById) {
  if (Number(partner.flatRate) > 0) return Number(partner.flatRate);
  const match = partner.rates.find((r) => {
    const jt = jobTypesById.get(r.jobTypeId);
    return jt && jt.name === jobTypeName;
  });
  return match ? match.amount : undefined;
}

function create(data) {
  const item = {
    id: nextId,
    name: (data.name || "").trim(),
    active: data.active !== false,
    rates: normalizeRates(data.rates),
    flatRate: Number(data.flatRate) > 0 ? Number(data.flatRate) : null,
    // Reglas del socio: solo trabajos con ganancia bruta MAYOR a este monto, y nunca los
    // trabajos donde el propio socio fue el técnico.
    minGrossProfit: Number.isFinite(Number(data.minGrossProfit)) ? Number(data.minGrossProfit) : null,
    excludeTechnicianName: String(data.excludeTechnicianName || "").trim(),
  };
  items.push(item);
  nextId += 1;
  persist();
  return item;
}

function update(id, data) {
  const item = get(id);
  if (!item) return null;
  Object.assign(item, {
    name: data.name !== undefined ? data.name.trim() : item.name,
    active: data.active !== undefined ? !!data.active : item.active,
    rates: data.rates !== undefined ? normalizeRates(data.rates) : item.rates,
    flatRate: data.flatRate !== undefined ? (Number(data.flatRate) > 0 ? Number(data.flatRate) : null) : item.flatRate ?? null,
    minGrossProfit: data.minGrossProfit !== undefined ? (data.minGrossProfit === null || data.minGrossProfit === "" ? null : Number(data.minGrossProfit)) : item.minGrossProfit ?? null,
    excludeTechnicianName: data.excludeTechnicianName !== undefined ? String(data.excludeTechnicianName || "").trim() : item.excludeTechnicianName || "",
  });
  persist();
  return item;
}

function remove(id) {
  const index = items.findIndex((i) => i.id === Number(id));
  if (index === -1) return false;
  items.splice(index, 1);
  persist();
  return true;
}

module.exports = { list, get, create, update, remove, rateForJobType };
