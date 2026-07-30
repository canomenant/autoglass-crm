const GROUPS = [
  {
    county: "Los Angeles",
    tax: 0.095,
    entries: [
      ["90001", "Los Angeles"],
      ["90011", "Los Angeles"],
      ["90272", "Pacific Palisades"],
      ["90274", "Palos Verdes Peninsula"],
      ["90275", "Rancho Palos Verdes"],
      ["90277", "Redondo Beach"],
      ["90278", "Redondo Beach"],
    ],
  },
  {
    county: "San Francisco",
    tax: 0.0863,
    entries: [
      ["94134", "San Francisco"],
      ["94137", "San Francisco"],
      ["94139", "San Francisco"],
      ["94141", "San Francisco"],
      ["94143", "San Francisco"],
      ["94144", "San Francisco"],
      ["94145", "San Francisco"],
      ["94151", "San Francisco"],
      ["94158", "San Francisco"],
      ["94160", "San Francisco"],
      ["94161", "San Francisco"],
      ["94163", "San Francisco"],
      ["94177", "San Francisco"],
      ["94188", "San Francisco"],
    ],
  },
  {
    county: "Sacramento",
    tax: 0.0875,
    entries: [
      ["94203", "Sacramento"],
      ["94204", "Sacramento"],
      ["94205", "Sacramento"],
      ["94206", "Sacramento"],
      ["94207", "Sacramento"],
      ["94208", "Sacramento"],
      ["94209", "Sacramento"],
      ["94211", "Sacramento"],
      ["94229", "Sacramento"],
      ["94230", "Sacramento"],
      ["94232", "Sacramento"],
      ["94234", "Sacramento"],
      ["94235", "Sacramento"],
      ["94236", "Sacramento"],
      ["94237", "Sacramento"],
      ["94239", "Sacramento"],
      ["94240", "Sacramento"],
      ["94244", "Sacramento"],
      ["94245", "Sacramento"],
      ["94247", "Sacramento"],
      ["94248", "Sacramento"],
      ["94249", "Sacramento"],
      ["94250", "Sacramento"],
      ["94252", "Sacramento"],
      ["94254", "Sacramento"],
      ["94256", "Sacramento"],
      ["94257", "Sacramento"],
      ["94258", "Sacramento"],
      ["94259", "Sacramento"],
      ["94261", "Sacramento"],
      ["94262", "Sacramento"],
    ],
  },
];

const { loadOrSeed, save, nextIdFrom } = require("../lib/persistence");

const FILE = "zipCodes.json";
let items = loadOrSeed(FILE, () => {
  const seeded = [];
  let id = 1;
  for (const group of GROUPS) {
    for (const [zipcode, city] of group.entries) {
      seeded.push({
        id,
        city,
        county: group.county,
        state: "CA",
        zipcode,
        tax: group.tax,
        serviceArea: true,
        longTripRequired: false,
        longTripFee: 0,
        distanceFromBase: 0,
      });
      id += 1;
    }
  }
  // Example from the Long Trip spec: outside the normal service area.
  seeded.push({
    id,
    city: "El Centro",
    county: "Imperial",
    state: "CA",
    zipcode: "92243",
    tax: 0.0775,
    serviceArea: false,
    longTripRequired: true,
    longTripFee: 85,
    distanceFromBase: 95,
  });
  return seeded;
});
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

function findByZipcode(zipcode) {
  return items.find((i) => i.zipcode === String(zipcode).trim());
}

function create(data) {
  const zipcode = String(data.zipcode || "").trim();
  const existing = findByZipcode(zipcode);
  if (existing) {
    Object.assign(existing, {
      city: data.city ?? existing.city,
      county: data.county ?? existing.county,
      state: data.state ?? existing.state,
      tax: data.tax ?? existing.tax,
      serviceArea: data.serviceArea ?? existing.serviceArea,
      longTripRequired: data.longTripRequired ?? existing.longTripRequired,
      longTripFee: data.longTripFee ?? existing.longTripFee,
      distanceFromBase: data.distanceFromBase ?? existing.distanceFromBase,
    });
    return existing;
  }
  const item = {
    id: nextId,
    city: data.city || "",
    county: data.county || "",
    state: data.state || "CA",
    zipcode,
    tax: data.tax ?? 0,
    serviceArea: data.serviceArea ?? true,
    longTripRequired: data.longTripRequired ?? false,
    longTripFee: data.longTripFee ?? 0,
    distanceFromBase: data.distanceFromBase ?? 0,
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
    city: data.city ?? item.city,
    county: data.county ?? item.county,
    state: data.state ?? item.state,
    zipcode: data.zipcode ?? item.zipcode,
    tax: data.tax ?? item.tax,
    serviceArea: data.serviceArea ?? item.serviceArea,
    longTripRequired: data.longTripRequired ?? item.longTripRequired,
    longTripFee: data.longTripFee ?? item.longTripFee,
    distanceFromBase: data.distanceFromBase ?? item.distanceFromBase,
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

module.exports = { list, get, create, update, remove, findByZipcode };
