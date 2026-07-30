const { loadOrSeed, save, nextIdFrom } = require("../lib/persistence");

const FILE = "users.json";
let users = loadOrSeed(FILE, () => []);
let nextId = nextIdFrom(users);

function persist() {
  save(FILE, users);
}

const ROLES = ["Admin", "Tech", "Sales", "Employee"];

function list() {
  return users;
}

function get(id) {
  return users.find((u) => u.id === Number(id));
}

function create(data) {
  const user = {
    id: nextId,
    name: data.name || "",
    email: data.email || "",
    phone: data.phone || "",
    role: ROLES.includes(data.role) ? data.role : "Employee",
    bank: {
      bankName: data.bank?.bankName || "",
      accountNumber: data.bank?.accountNumber || "",
    },
    commission: data.commission ?? 0,
    salary: data.salary ?? 0,
    notes: data.notes || "",
    attachments: data.attachments || [],
    createdAt: new Date().toISOString(),
  };
  users.push(user);
  nextId += 1;
  persist();
  return user;
}

function update(id, data) {
  const user = get(id);
  if (!user) return null;
  Object.assign(user, {
    name: data.name ?? user.name,
    email: data.email ?? user.email,
    phone: data.phone ?? user.phone,
    role: data.role && ROLES.includes(data.role) ? data.role : user.role,
    bank: { ...user.bank, ...data.bank },
    commission: data.commission ?? user.commission,
    salary: data.salary ?? user.salary,
    notes: data.notes ?? user.notes,
    attachments: data.attachments ?? user.attachments,
  });
  persist();
  return user;
}

function remove(id) {
  const index = users.findIndex((u) => u.id === Number(id));
  if (index === -1) return false;
  users.splice(index, 1);
  persist();
  return true;
}

module.exports = { list, get, create, update, remove, ROLES };
