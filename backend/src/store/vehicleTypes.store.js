const YEARS = [2026, 2025, 2024, 2023];

const BASE_MODELS = [
  { make: "Ford", model: "F-150", bodyType: "Truck" },
  { make: "Ford", model: "Explorer", bodyType: "SUV" },
  { make: "Ford", model: "Escape", bodyType: "SUV" },
  { make: "Ford", model: "Mustang", bodyType: "Coupe" },
  { make: "Ford", model: "Transit", bodyType: "Van" },
  { make: "Toyota", model: "Camry", bodyType: "Sedan" },
  { make: "Toyota", model: "Corolla", bodyType: "Sedan" },
  { make: "Toyota", model: "Tacoma", bodyType: "Truck" },
  { make: "Toyota", model: "RAV4", bodyType: "SUV" },
  { make: "Toyota", model: "Highlander", bodyType: "SUV" },
  { make: "Honda", model: "Civic", bodyType: "Sedan" },
  { make: "Honda", model: "Accord", bodyType: "Sedan" },
  { make: "Honda", model: "CR-V", bodyType: "SUV" },
  { make: "Honda", model: "Pilot", bodyType: "SUV" },
  { make: "Honda", model: "Odyssey", bodyType: "Van" },
  { make: "Chevrolet", model: "Silverado", bodyType: "Truck" },
  { make: "Chevrolet", model: "Equinox", bodyType: "SUV" },
  { make: "Chevrolet", model: "Malibu", bodyType: "Sedan" },
  { make: "Chevrolet", model: "Tahoe", bodyType: "SUV" },
  { make: "Chevrolet", model: "Camaro", bodyType: "Coupe" },
];

const { loadOrSeed, save, nextIdFrom } = require("../lib/persistence");
const pool = require("../config/db");
const { isShadowEnabled, shadowRead } = require("../lib/sqlShadow");

const FILE = "vehicleTypes.json";
let items = loadOrSeed(FILE, () => {
  const seeded = [];
  let id = 1;
  for (const year of YEARS) {
    for (const base of BASE_MODELS) {
      seeded.push({ id, year, make: base.make, model: base.model, bodyType: base.bodyType });
      id += 1;
    }
  }
  return seeded;
});
let nextId = nextIdFrom(items);

function persist() {
  save(FILE, items);
}

function vehicleMatchKey(v) {
  const year = v.year ?? "";
  const make = (v.make || "").trim().toLowerCase();
  const model = (v.model || "").trim().toLowerCase();
  const bodyType = (v.bodyType ?? v.body_type ?? "").trim().toLowerCase();
  return `${year}|${make}|${model}|${bodyType}`;
}

async function listFromSql() {
  const r = await pool.query("SELECT id, year, make, model, body_type FROM vehicles");
  return r.rows;
}

function compareVehicle() {
  // Match key already covers every field this catalog has (year/make/model/bodyType) —
  // nothing left to diff once two rows share a key.
  return null;
}

function list() {
  // No dedicated *_SOURCE flag was requested for this catalog — it just follows the global toggle.
  if (isShadowEnabled()) {
    shadowRead({
      label: "vehicleTypes",
      jsonResult: items,
      sqlQueryFn: listFromSql,
      matchKeyFn: vehicleMatchKey,
      compareFn: compareVehicle,
    }).catch(() => {});
  }
  return items;
}

function get(id) {
  return items.find((i) => i.id === Number(id));
}

function create(data) {
  const item = {
    id: nextId,
    year: data.year || "",
    make: data.make || "",
    model: data.model || "",
    bodyType: data.bodyType || "",
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
    year: data.year ?? item.year,
    make: data.make ?? item.make,
    model: data.model ?? item.model,
    bodyType: data.bodyType ?? item.bodyType,
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

module.exports = { list, get, create, update, remove, listFromSql };
