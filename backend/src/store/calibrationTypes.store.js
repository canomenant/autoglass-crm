const { loadOrSeed, save, nextIdFrom } = require("../lib/persistence");

const FILE = "calibrationTypes.json";
let items = loadOrSeed(FILE, () => [
  { id: 1, name: "Estático", amount: 150 },
  { id: 2, name: "Dinámica", amount: 250 },
  { id: 3, name: "ADAS Calibration", amount: 350 },
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
  const item = { id: nextId, name: data.name || "", amount: data.amount ?? 0 };
  items.push(item);
  nextId += 1;
  persist();
  return item;
}

function update(id, data) {
  const item = get(id);
  if (!item) return null;
  Object.assign(item, {
    name: data.name ?? item.name,
    amount: data.amount ?? item.amount,
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

module.exports = { list, get, create, update, remove };
