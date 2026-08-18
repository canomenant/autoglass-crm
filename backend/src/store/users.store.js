const { loadOrSeed, save, nextIdFrom } = require("../lib/persistence");
const { hashPassword } = require("../lib/password");

const FILE = "users.json";
let users = loadOrSeed(FILE, () => []);
let nextId = nextIdFrom(users);

function persist() {
  save(FILE, users);
}

const ROLES = ["Admin", "Tech", "Sales", "Employee"];

function sanitize(user) {
  if (!user) return user;
  const { password, ...rest } = user;
  return rest;
}

function list() {
  return users.map(sanitize);
}

function get(id) {
  return sanitize(users.find((u) => u.id === Number(id)));
}

function findByEmail(email) {
  return users.find((u) => u.email && u.email.toLowerCase() === String(email).toLowerCase());
}

async function create(data) {
  const user = {
    id: nextId,
    name: data.name || "",
    email: data.email || "",
    phone: data.phone || "",
    role: ROLES.includes(data.role) ? data.role : "Employee",
    password: data.password ? await hashPassword(data.password) : "",
    mustChangePassword: !!data.password,
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
  return sanitize(user);
}

async function update(id, data) {
  const user = users.find((u) => u.id === Number(id));
  if (!user) return null;
  Object.assign(user, {
    name: data.name ?? user.name,
    email: data.email ?? user.email,
    phone: data.phone ?? user.phone,
    role: data.role && ROLES.includes(data.role) ? data.role : user.role,
    password: data.password ? await hashPassword(data.password) : user.password,
    mustChangePassword: data.mustChangePassword ?? user.mustChangePassword,
    bank: { ...user.bank, ...data.bank },
    commission: data.commission ?? user.commission,
    salary: data.salary ?? user.salary,
    notes: data.notes ?? user.notes,
    attachments: data.attachments ?? user.attachments,
  });
  persist();
  return sanitize(user);
}

function remove(id) {
  const index = users.findIndex((u) => u.id === Number(id));
  if (index === -1) return false;
  users.splice(index, 1);
  persist();
  return true;
}

module.exports = { list, get, create, update, remove, findByEmail, ROLES };
