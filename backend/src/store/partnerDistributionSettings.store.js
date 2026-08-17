const { loadOrSeed, save } = require("../lib/persistence");

const FILE = "partnerDistributionSettings.json";
// Singleton object, not an array — this store holds exactly one global setting, unlike every
// other file behind persistence.js which holds a catalog list.
let settings = loadOrSeed(FILE, () => ({ startDate: null }));

function persist() {
  save(FILE, settings);
}

function get() {
  return settings;
}

function update(data) {
  settings = { startDate: data.startDate || null };
  persist();
  return settings;
}

module.exports = { get, update };
