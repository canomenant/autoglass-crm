const { loadOrSeed, save, nextIdFrom } = require("../lib/persistence");

const FILE = "paymentStatus.json";
let items = loadOrSeed(FILE, () => [
  { id: 1, name: "Paid" },
  { id: 2, name: "Pending" },
  { id: 3, name: "Partially Paid" },
  { id: 4, name: "Not Paid" },
  { id: 5, name: "Refunded" },
  { id: 6, name: "Chargeback" },
]);
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

function create(data) {
  const item = { id: nextId, name: data.name || "" };
  items.push(item);
  nextId += 1;
  persist();
  return item;
}

function update(id, data) {
  const item = get(id);
  if (!item) return null;
  Object.assign(item, { name: data.name ?? item.name });
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

module.exports = { list, get, create, update, remove };
