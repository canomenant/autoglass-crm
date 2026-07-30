const { loadOrSeed, save, nextIdFrom } = require("../lib/persistence");

const FILE = "partnerCompanies.json";
let companies = loadOrSeed(FILE, () => []);
let nextId = nextIdFrom(companies);

function persist() {
  save(FILE, companies);
}

function list() {
  return companies;
}

function get(id) {
  return companies.find((c) => c.id === Number(id));
}

function create(data) {
  const company = {
    id: nextId,
    companyName: data.companyName || "",
    contactName: data.contactName || "",
    phone: data.phone || "",
    email: data.email || "",
    leadPrice: data.leadPrice ?? 0,
    notes: data.notes || "",
    active: data.active ?? true,
    createdAt: new Date().toISOString(),
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
    companyName: data.companyName ?? company.companyName,
    contactName: data.contactName ?? company.contactName,
    phone: data.phone ?? company.phone,
    email: data.email ?? company.email,
    leadPrice: data.leadPrice ?? company.leadPrice,
    notes: data.notes ?? company.notes,
    active: data.active ?? company.active,
  });
  persist();
  return company;
}

function remove(id) {
  const index = companies.findIndex((c) => c.id === Number(id));
  if (index === -1) return false;
  companies.splice(index, 1);
  persist();
  return true;
}

module.exports = { list, get, create, update, remove };
