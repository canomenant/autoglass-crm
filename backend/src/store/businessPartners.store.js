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
function rateForJobType(partner, jobTypeName, jobTypesById) {
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
