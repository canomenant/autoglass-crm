const { loadOrSeed, save, nextIdFrom } = require("../lib/persistence");

const FILE = "insurance.json";
let companies = loadOrSeed(FILE, () => []);
let nextId = nextIdFrom(companies);

function persist() {
  save(FILE, companies);
}

function list() {
  return companies.filter((c) => c.active !== false);
}

function get(id) {
  return companies.find((c) => c.id === Number(id) && c.active !== false);
}

function create(data) {
  const company = {
    id: nextId,
    name: data.name || "",
    phone: data.phone || "",
    email: data.email || "",
    address: data.address || "",
    notes: data.notes || "",
    active: true,
    deletedAt: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  companies.push(company);
  nextId += 1;
  persist();
  return company;
}

function update(id, data) {
  const company = get(id);
  if (!company) return null;
  Object.assign(company, {
    name: data.name ?? company.name,
    phone: data.phone ?? company.phone,
    email: data.email ?? company.email,
    address: data.address ?? company.address,
    notes: data.notes ?? company.notes,
    updatedAt: new Date().toISOString(),
  });
  persist();
  return company;
}

function remove(id) {
  const company = get(id);
  if (!company) return false;
  company.active = false;
  company.deletedAt = new Date().toISOString();
  persist();
  return true;
}

module.exports = { list, get, create, update, remove };
