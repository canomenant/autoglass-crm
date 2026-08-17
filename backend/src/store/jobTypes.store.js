const { loadOrSeed, save, nextIdFrom } = require("../lib/persistence");

const FILE = "jobTypes.json";
let items = loadOrSeed(FILE, () => [
  { id: 1, name: "Front Right Window Regulator", type: "Parts", isTaxable: true },
  { id: 2, name: "Roll Up Window", type: "Services", isTaxable: false },
  { id: 3, name: "Window Installation", type: "Services", isTaxable: false },
  { id: 4, name: "Front Left Door Glass", type: "Parts", isTaxable: true },
  { id: 5, name: "Chip Repair", type: "Services", isTaxable: false },
  { id: 6, name: "Rear Right Quarter Glass", type: "Parts", isTaxable: true },
  { id: 7, name: "Rear Right Vent Glass", type: "Parts", isTaxable: true },
  { id: 8, name: "Front Left Vent Glass", type: "Parts", isTaxable: true },
  { id: 9, name: "Molding", type: "Molding", isTaxable: true },
  { id: 10, name: "Delivery Surcharge", type: "Services", isTaxable: false },
  { id: 11, name: "Rear Right Window Regulator", type: "Parts", isTaxable: true },
  { id: 12, name: "Rear Right Door Glass", type: "Parts", isTaxable: true },
  { id: 13, name: "Front Right Quarter Glass", type: "Parts", isTaxable: true },
  { id: 14, name: "Labor", type: "Services", isTaxable: false },
  { id: 15, name: "Front Left Quarter Glass", type: "Parts", isTaxable: true },
  { id: 16, name: "Rain Sensor Pad", type: "Parts", isTaxable: true },
  { id: 17, name: "Rear Left Window Regulator", type: "Parts", isTaxable: true },
  { id: 18, name: "Front Right Door Glass", type: "Parts", isTaxable: true },
  { id: 19, name: "Back Glass", type: "Parts", isTaxable: true },
  { id: 20, name: "Rear Left Door Glass", type: "Parts", isTaxable: true },
  { id: 21, name: "Trip", type: "Services", isTaxable: false },
  { id: 22, name: "Rear Left Quarter Glass", type: "Parts", isTaxable: true },
  { id: 23, name: "Windshield Cowling", type: "Parts", isTaxable: true },
  { id: 24, name: "Windshield Replacement", type: "Parts", isTaxable: true },
  { id: 25, name: "Gasket", type: "Molding", isTaxable: true },
  { id: 26, name: "Rear Left Vent Glass", type: "Parts", isTaxable: true },
  { id: 27, name: "Front Right Vent Glass", type: "Parts", isTaxable: true },
  { id: 28, name: "Front Left Window Regulator", type: "Parts", isTaxable: true },
  { id: 29, name: "Door Glass Replacement", type: "Parts", isTaxable: true },
  { id: 30, name: "Back Glass Replacement", type: "Parts", isTaxable: true },
  { id: 31, name: "Molding Replacement", type: "Parts", isTaxable: true },
  { id: 32, name: "Supplies", type: "Parts", isTaxable: true },
  { id: 33, name: "Calibration", type: "Services", isTaxable: false },
  { id: 34, name: "Rock Chip Repair", type: "Services", isTaxable: false },
  { id: 35, name: "Mobile Service", type: "Services", isTaxable: false },
]);
let nextId = nextIdFrom(items);

function persist() {
  save(FILE, items);
}

const TYPES = ["Parts", "Services", "Molding"];

// Backfills isTaxable for rows persisted before this field existed — loadOrSeed only runs the
// seed function on a first-ever boot, so jobTypes.json already on disk skips it entirely.
(function backfillIsTaxable() {
  let changed = false;
  for (const item of items) {
    if (item.isTaxable === undefined) {
      item.isTaxable = item.type !== "Services";
      changed = true;
    }
  }
  if (changed) persist();
})();

function list() {
  return items;
}

function get(id) {
  return items.find((i) => i.id === Number(id));
}

function findByName(name) {
  return items.find((i) => i.name.toLowerCase() === String(name).trim().toLowerCase());
}

function create(data) {
  const name = (data.name || "").trim();
  const existing = findByName(name);
  if (existing) return existing;
  const item = {
    id: nextId,
    name,
    type: TYPES.includes(data.type) ? data.type : "Parts",
    isTaxable: data.isTaxable !== false,
  };
  items.push(item);
  nextId += 1;
  persist();
  return item;
}

function update(id, data) {
  const item = get(id);
  if (!item) return null;
  const nextName = data.name !== undefined ? data.name.trim() : item.name;
  const duplicate = nextName !== item.name && findByName(nextName);
  Object.assign(item, {
    name: duplicate ? item.name : nextName,
    type: data.type && TYPES.includes(data.type) ? data.type : item.type,
    isTaxable: data.isTaxable !== undefined ? !!data.isTaxable : item.isTaxable,
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

module.exports = { TYPES, list, get, create, update, remove, findByName };
