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
    // A quién se le pagó y cómo. Vivían mezclados dentro de notes ("LL MEDIA ... — Business Credit
    // Card ...5442", el formato que compuso import-operating-expenses.js); ahora son campos y las
    // notas vuelven a ser notas. split-expense-vendor-from-notes.js separó las existentes.
    vendor: data.vendor || "",
    paymentMethod: data.paymentMethod || "",
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
    vendor: data.vendor ?? expense.vendor,
    paymentMethod: data.paymentMethod ?? expense.paymentMethod,
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
