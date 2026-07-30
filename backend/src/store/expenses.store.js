const { loadOrSeed, save, nextIdFrom } = require("../lib/persistence");

const FILE = "expenses.json";
let expenses = loadOrSeed(FILE, () => []);
let nextId = nextIdFrom(expenses);

function persist() {
  save(FILE, expenses);
}

function list() {
  return expenses;
}

function get(id) {
  return expenses.find((e) => e.id === Number(id));
}

function create(data) {
  const expense = {
    id: nextId,
    category: data.category || "",
    date: data.date || new Date().toISOString().slice(0, 10),
    amount: data.amount ?? 0,
    notes: data.notes || "",
    attachments: data.attachments || [],
    createdAt: new Date().toISOString(),
  };
  expenses.push(expense);
  nextId += 1;
  persist();
  return expense;
}

function update(id, data) {
  const expense = get(id);
  if (!expense) return null;
  Object.assign(expense, {
    category: data.category ?? expense.category,
    date: data.date ?? expense.date,
    amount: data.amount ?? expense.amount,
    notes: data.notes ?? expense.notes,
    attachments: data.attachments ?? expense.attachments,
  });
  persist();
  return expense;
}

function remove(id) {
  const index = expenses.findIndex((e) => e.id === Number(id));
  if (index === -1) return false;
  expenses.splice(index, 1);
  persist();
  return true;
}

module.exports = { list, get, create, update, remove };
