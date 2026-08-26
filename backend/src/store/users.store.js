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
  // tokenVersion es estado interno de la sesión, no un campo del recurso: no forma parte de la
  // ficha del usuario y no tiene por qué salir por la API.
  // mfaSecret y mfaBackupCodes son credenciales: no salen por la API en ningún caso.
  // mfaEnabled sí, porque la pantalla de seguridad necesita saber si mostrar "activar" o "desactivar".
  const { password, tokenVersion, mfaSecret, mfaBackupCodes, mfaLastStep, ...rest } = user;
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

// Lo mínimo que requireAuth necesita para decidir si un token sigue siendo válido. Aparte de
// get(), que sanitiza y copia: esto se ejecuta en cada petición autenticada.
// users.store no tiene `status` — para estos registros existir es estar activo.
function authState(id) {
  const user = users.find((u) => u.id === Number(id));
  return user ? { status: undefined, tokenVersion: user.tokenVersion || 0 } : null;
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
    // Se incrementa al cambiar la contraseña; requireAuth compara este número con el que lleva
    // el token, de modo que los emitidos antes del cambio dejan de valer en el acto.
    tokenVersion: 0,
    // Segundo factor. mfaSecret va cifrado (lib/mfa.js), los códigos de recuperación con bcrypt,
    // y mfaLastStep es la ventana TOTP ya consumida — lo que impide repetir un código visto.
    mfaEnabled: false,
    mfaSecret: null,
    mfaBackupCodes: [],
    mfaLastStep: null,
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
    tokenVersion: data.tokenVersion ?? user.tokenVersion ?? 0,
    mfaEnabled: data.mfaEnabled ?? user.mfaEnabled ?? false,
    mfaSecret: data.mfaSecret !== undefined ? data.mfaSecret : user.mfaSecret ?? null,
    mfaBackupCodes: data.mfaBackupCodes ?? user.mfaBackupCodes ?? [],
    mfaLastStep: data.mfaLastStep ?? user.mfaLastStep ?? null,
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

module.exports = { list, get, create, update, remove, findByEmail, authState, ROLES };
