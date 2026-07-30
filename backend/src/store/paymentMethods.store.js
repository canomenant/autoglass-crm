const { loadOrSeed, save, nextIdFrom } = require("../lib/persistence");

const FILE = "paymentMethods.json";
let items = loadOrSeed(FILE, () => [
  { id: 1, name: "Cash" },
  { id: 2, name: "Zelle" },
  { id: 3, name: "PayPal" },
  { id: 4, name: "Venmo" },
  { id: 5, name: "Cash App" },
  { id: 6, name: "Check" },
  { id: 7, name: "ACH Transfer" },
  { id: 8, name: "Bank Transfer" },
  { id: 9, name: "Wire Transfer" },
  { id: 10, name: "Credit Card" },
  { id: 11, name: "Debit Card" },
  { id: 12, name: "Apple Pay" },
  { id: 13, name: "Google Pay" },
  { id: 14, name: "Tap To Pay" },
  { id: 15, name: "Capital One ****4360" },
  { id: 16, name: "Chase" },
  { id: 17, name: "Business Card ****5442" },
  { id: 18, name: "Business Card ****0533" },
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
