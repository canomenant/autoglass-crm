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

const { loadOrSeed, save, appendToAppDataArray } = require("../lib/persistence");

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
// Ids come from Postgres inside the append statement. A counter kept in process memory hands out
// the same id twice as soon as there is more than one instance — and after a dedupe it is not even
// count+1, since removing rows without renumbering leaves the count below the highest live id.

// The taxonomy the quote form stores on a vehicle, and has stored all along. Deliberately NOT the
// catalog's own bodyType strings, which are trim-level ("LE Sedan 4-Door", "Base Straight Truck -
// Half Cab") and run to 10,080 distinct values. Serving those would silently change what the field
// means on quotes and work orders. "Other" is a UI escape hatch, not a catalog value, so it is not
// here.
const BODY_TYPES = ["Convertible", "Coupe", "Hatchback", "Minivan", "Pickup", "SUV", "Sedan", "Truck", "Van", "Wagon"];

// Maps a trim-level or NHTSA BodyClass string onto the taxonomy. Order matters: "minivan" has to
// beat "van", and "sport utility" has to beat nothing else that follows. Returns "" when there is
// no honest answer — about 19% of the catalog (buses, stripped chassis, motor homes) lands there
// and is deliberately kept out of the dropdown rather than guessed at.
function normalizeBodyType(value) {
  const s = String(value || "").toLowerCase();
  if (!s) return "";
  // "Mini Passenger Van" is how this catalog spells a minivan — every Odyssey, Pacifica and Sienna
  // row uses it, and matching only the single word "minivan" filed all of them under Van.
  if (s.includes("minivan") || s.includes("mini passenger van") || s.includes("mini cargo van")) return "Minivan";
  if (s.includes("suv") || s.includes("sport utility") || s.includes("multi-purpose")) return "SUV";
  // Cab styles imply a pickup even when the word never appears ("King Ranch Crew Cab 4-Door").
  if (s.includes("pickup") || /\b(crew|ext|extended|reg|regular|club|quad|king|access|double|super)\s*cab\b/.test(s)) return "Pickup";
  if (s.includes("convertible") || s.includes("cabriolet") || s.includes("roadster")) return "Convertible";
  if (s.includes("hatchback") || s.includes("liftback")) return "Hatchback";
  if (s.includes("wagon")) return "Wagon";
  if (s.includes("van")) return "Van";
  if (s.includes("coupe")) return "Coupe";
  if (s.includes("sedan") || s.includes("saloon")) return "Sedan";
  if (s.includes("truck")) return "Truck";
  return "";
}

// Must stay character-for-character identical to the squash in
// persistence.js#appendToAppDataArray — one decides what the UI offers to add, the other decides
// what the database accepts, and a gap between them offers what the other refuses.
// scripts/verify-add-vehicle.js pins the two together.
function normalizeVehicleKey(value) {
  return String(value ?? "").toLowerCase().replace(/[ \t\r\n\-._/]+/g, "");
}

// An entry's effective body type: the stored value when it is already taxonomy, otherwise mapped
// from the trim string. Written this way so the cascade works both before and after
// scripts/normalize-vehicle-body-types.js runs — that migration makes reads cheaper and the stored
// data honest, it is not a prerequisite for any of this to function.
function effectiveBodyType(item) {
  const stored = String(item.bodyType || "").trim();
  if (BODY_TYPES.includes(stored)) return stored;
  return normalizeBodyType(stored);
}

// 92,958 entries scanned per keystroke would be visible, so the cascade is indexed once and reused.
// Rebuilt when the array grows (appendToAppDataArray pushes straight into the shared cache array,
// which is this same `items`) or when update/remove bump the revision.
let cascadeCache = null;
let cachedLength = -1;
let cachedRevision = -1;
let revision = 0;

function invalidateCascade() {
  revision += 1;
}

function cascadeIndex() {
  if (cascadeCache && cachedLength === items.length && cachedRevision === revision) return cascadeCache;

  const byYear = new Map();
  for (const item of items) {
    const year = Number(item.year);
    if (!Number.isFinite(year) || !year) continue;
    const makeName = String(item.make || "").trim();
    const modelName = String(item.model || "").trim();
    if (!makeName || !modelName) continue;

    if (!byYear.has(year)) byYear.set(year, new Map());
    const makes = byYear.get(year);

    const makeKey = normalizeVehicleKey(makeName);
    if (!makes.has(makeKey)) makes.set(makeKey, { name: makeName, models: new Map() });
    const models = makes.get(makeKey).models;

    const modelKey = normalizeVehicleKey(modelName);
    if (!models.has(modelKey)) models.set(modelKey, { name: modelName, bodyTypes: new Set() });

    const bodyType = effectiveBodyType(item);
    if (bodyType) models.get(modelKey).bodyTypes.add(bodyType);
  }

  // Body type is a property of the model far more than of the model year, so a year with none of
  // its own can borrow from the same make+model in other years. That is inference, and it is
  // reported as such — but it only ever widens the choices offered, never picks one, so the worst
  // case is an extra option in a list the user is choosing from anyway. Without it a 2025 Tacoma
  // offers all ten, because every one of its eight catalog rows is a bare trim name ("SR5",
  // "TRD Pro") with no body word in it at all.
  const byModel = new Map();
  for (const item of items) {
    const makeName = String(item.make || "").trim();
    const modelName = String(item.model || "").trim();
    if (!makeName || !modelName) continue;
    const bodyType = effectiveBodyType(item);
    if (!bodyType) continue;
    const modelKey = `${normalizeVehicleKey(makeName)}|${normalizeVehicleKey(modelName)}`;
    if (!byModel.has(modelKey)) byModel.set(modelKey, new Set());
    byModel.get(modelKey).add(bodyType);
  }

  cascadeCache = { byYear, byModel, years: [...byYear.keys()].sort((a, b) => b - a) };
  cachedLength = items.length;
  cachedRevision = revision;
  return cascadeCache;
}

// --- cascade -----------------------------------------------------------------
// Each level answers only for the level above it. This is the whole point of the change: NHTSA
// returns the same 195 makes for 2025 and for 1995, Tesla included.
function years() {
  return cascadeIndex().years;
}

function makes(year) {
  const makesForYear = cascadeIndex().byYear.get(Number(year));
  if (!makesForYear) return [];
  return [...makesForYear.values()].map((m) => m.name).sort((a, b) => a.localeCompare(b));
}

function models(year, make) {
  const makesForYear = cascadeIndex().byYear.get(Number(year));
  const entry = makesForYear?.get(normalizeVehicleKey(make));
  if (!entry) return [];
  return [...entry.models.values()].map((m) => m.name).sort((a, b) => a.localeCompare(b));
}

// Empty is a legitimate answer, not a failure: rows seeded from NHTSA carry year/make/model and no
// body type, because NHTSA's model listing has none. The caller offers the full taxonomy in that
// case rather than a dead end, and VIN decodes fill it in over time.
// Returns { bodyTypes, source }. The source is the honest part: "exact" came from this very
// year/make/model, "model" was borrowed from the same model in other years, "taxonomy" means
// nothing is known and the caller gets the full list. Roughly 20% of combinations land on
// "taxonomy" — buses and stripped chassis, plus models the catalog only ever recorded as trim
// names. The seeded 2025/2026 rows land there too, since NHTSA's model listing carries no body
// type; VIN decodes fill those in over time.
function bodyTypes(year, make, model) {
  const index = cascadeIndex();
  const makeKey = normalizeVehicleKey(make);
  const modelKey = normalizeVehicleKey(model);

  const modelEntry = index.byYear.get(Number(year))?.get(makeKey)?.models.get(modelKey);
  const exact = modelEntry ? [...modelEntry.bodyTypes] : [];
  if (exact.length) return { bodyTypes: exact.sort((a, b) => a.localeCompare(b)), source: "exact" };

  const inherited = index.byModel.get(`${makeKey}|${modelKey}`);
  if (inherited?.size) return { bodyTypes: [...inherited].sort((a, b) => a.localeCompare(b)), source: "model" };

  return { bodyTypes: [...BODY_TYPES], source: "taxonomy" };
}

function findByCombination(year, make, model, bodyType) {
  const y = Number(year);
  const mk = normalizeVehicleKey(make);
  const md = normalizeVehicleKey(model);
  const bt = normalizeVehicleKey(bodyType);
  return (
    items.find(
      (i) =>
        Number(i.year) === y &&
        normalizeVehicleKey(i.make) === mk &&
        normalizeVehicleKey(i.model) === md &&
        normalizeVehicleKey(effectiveBodyType(i)) === bt
    ) || null
  );
}

function persist() {
  save(FILE, items);
}

function list() {
  return items;
}

function get(id) {
  return items.find((i) => i.id === Number(id));
}

// Returns { created } or { duplicate } — a duplicate is an expected outcome the quote form turns
// into "this vehicle is already in the catalog, use it", not an error.
//
// Appends atomically instead of going through persist(), which rewrites all 92,958 entries and
// drops one of two simultaneous adds. Uniqueness is the whole combination, since the same model
// legitimately exists across years and body types.
async function create(data, actor) {
  const year = Number(data.year);
  const make = String(data.make || "").trim();
  const model = String(data.model || "").trim();
  const rawBodyType = String(data.bodyType || "").trim();

  if (!Number.isInteger(year) || year < 1900 || year > 2100) throw new Error("Year must be a 4-digit year.");
  if (!make) throw new Error("Make is required.");
  if (!model) throw new Error("Model is required.");

  // Normalized on the way in so the catalog only ever grows taxonomy values, and the dropdown does
  // not sprout a one-off spelling that then fails to match anything.
  const bodyType = BODY_TYPES.includes(rawBodyType) ? rawBodyType : normalizeBodyType(rawBodyType);
  if (rawBodyType && !bodyType) {
    throw new Error(`Unrecognized body type "${rawBodyType}". Expected one of: ${BODY_TYPES.join(", ")}.`);
  }

  // Checked here, in JS, before the append. The SQL guard compares the stored bodyType as text,
  // and until scripts/normalize-vehicle-body-types.js runs the stored value is the raw trim
  // ("LE Sedan 4-Door") while the incoming one is taxonomy ("Sedan") — as text those do not match,
  // so the guard would happily write a second 2025 Toyota Camry. findByCombination() applies the
  // same mapping the cascade does, so it sees they are the same vehicle. The SQL guard stays as
  // the concurrency backstop for combinations that are genuinely new to both.
  const alreadyThere = findByCombination(year, make, model, bodyType);
  if (alreadyThere) return { duplicate: alreadyThere };

  const entry = await appendToAppDataArray(
    FILE,
    {
      year,
      make,
      model,
      bodyType,
      // The trim string the catalog was built from, kept beside the taxonomy rather than replaced
      // by it. Empty for hand-added and NHTSA-seeded rows, which never had one.
      trimDescription: String(data.trimDescription || "").trim(),
      addedBy: actor || "",
    },
    { uniqueField: ["year", "make", "model", "bodyType"], timestampField: "addedAt" }
  );

  // appendToAppDataArray already pushed into the shared cache array, which is this same `items`,
  // so there is no push to do here — only the cascade index to rebuild.
  invalidateCascade();
  if (!entry) return { duplicate: findByCombination(year, make, model, bodyType) };
  return { created: entry };
}

function update(id, data) {
  const item = get(id);
  if (!item) return null;
  // addedBy/addedAt record who actually created the entry and are deliberately not assignable.
  Object.assign(item, {
    year: data.year ?? item.year,
    make: data.make ?? item.make,
    model: data.model ?? item.model,
    bodyType: data.bodyType ?? item.bodyType,
    trimDescription: data.trimDescription ?? item.trimDescription ?? "",
  });
  persist();
  invalidateCascade();
  return item;
}

function remove(id) {
  const index = items.findIndex((i) => i.id === Number(id));
  if (index === -1) return false;
  items.splice(index, 1);
  persist();
  invalidateCascade();
  return true;
}

module.exports = {
  list,
  get,
  create,
  update,
  remove,
  years,
  makes,
  models,
  bodyTypes,
  findByCombination,
  normalizeBodyType,
  normalizeVehicleKey,
  BODY_TYPES,
};
