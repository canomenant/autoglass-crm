const { loadOrSeed, save, nextIdFrom } = require("../lib/persistence");

const FILE = "priceTiers.json";
let items = loadOrSeed(FILE, () => [
  { id: 1, name: "OEM", amount: 350, description: "Original Equipment Manufacturer" },
  { id: 2, name: "Recommended", amount: 295, description: "Recommended Replacement" },
  { id: 3, name: "Aftermarket", amount: 250, description: "Aftermarket Replacement" },
  { id: 4, name: "Premium OEM", amount: 450, description: "Premium or luxury vehicles" },
  { id: 5, name: "Insurance Approved", amount: 325, description: "Insurance negotiated rate" },
  { id: 6, name: "Fleet Pricing", amount: 225, description: "Fleet and commercial accounts" },
  { id: 7, name: "Custom", amount: 0, description: "User enters custom amount" },
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
  const item = {
    id: nextId,
    name: data.name || "",
    amount: data.amount ?? 0,
    description: data.description || "",
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
    name: data.name ?? item.name,
    amount: data.amount ?? item.amount,
    description: data.description ?? item.description,
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
