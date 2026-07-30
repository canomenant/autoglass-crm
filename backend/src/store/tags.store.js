const { loadOrSeed, save, nextIdFrom } = require("../lib/persistence");

const FILE = "tags.json";
let items = loadOrSeed(FILE, () => [
  { id: 1, name: "Draft", type: "Quote" },
  { id: 2, name: "New", type: "Quote" },
  { id: 3, name: "Pending Approval", type: "Quote" },
  { id: 4, name: "Scheduled", type: "Quote" },
  { id: 5, name: "In Progress", type: "Quote" },
  { id: 6, name: "Follow-Up", type: "Quote" },
  { id: 7, name: "No Response", type: "Quote" },
  { id: 8, name: "On Hold", type: "Quote" },
  { id: 9, name: "Accepted", type: "Quote" },
  { id: 10, name: "Opportunity To Sell Lead", type: "Quote" },
  { id: 11, name: "Job Done", type: "Quote" },
  { id: 12, name: "Pending Payment", type: "Quote" },
  { id: 13, name: "Converted", type: "Quote" },
  { id: 14, name: "Budget Issue", type: "Quote" },
  { id: 15, name: "Quote Too Cheap", type: "Quote" },
  { id: 16, name: "Too Expensive - Not Interested", type: "Quote" },
  { id: 17, name: "Lost To Competitor", type: "Quote" },
  { id: 18, name: "Lost - Competitor", type: "Quote" },
  { id: 19, name: "Lost - High Price", type: "Quote" },
  { id: 20, name: "Lost - Customer Waiting", type: "Quote" },
  { id: 21, name: "Lost - No Response", type: "Quote" },
  { id: 22, name: "Lost", type: "Quote" },
  { id: 23, name: "Expired", type: "Quote" },
  { id: 24, name: "Duplicate", type: "Quote" },
  { id: 25, name: "Cancelled", type: "Quote" },
  { id: 26, name: "Sold To Partner", type: "Quote" },
  { id: 27, name: "New", type: "Work Order" },
  { id: 28, name: "Accepted", type: "Work Order" },
  { id: 29, name: "Scheduled", type: "Work Order" },
  { id: 30, name: "In Progress", type: "Work Order" },
  { id: 31, name: "Waiting Customer", type: "Work Order" },
  { id: 32, name: "Waiting Parts", type: "Work Order" },
  { id: 33, name: "Rescheduled", type: "Work Order" },
  { id: 34, name: "Completed", type: "Work Order" },
  { id: 35, name: "Completed Pending Payment", type: "Work Order" },
  { id: 36, name: "Paid", type: "Work Order" },
  { id: 37, name: "Warranty", type: "Work Order" },
  { id: 38, name: "Rework Required", type: "Work Order" },
  { id: 39, name: "Charge Back", type: "Work Order" },
  { id: 40, name: "Cancelled", type: "Work Order" },
  { id: 41, name: "No Show", type: "Work Order" },
  { id: 42, name: "Closed", type: "Work Order" },
]);
let nextId = nextIdFrom(items);

function persist() {
  save(FILE, items);
}

const TYPES = ["Quote", "Work Order"];

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
    type: TYPES.includes(data.type) ? data.type : "Quote",
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
    type: data.type && TYPES.includes(data.type) ? data.type : item.type,
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

module.exports = { TYPES, list, get, create, update, remove };
