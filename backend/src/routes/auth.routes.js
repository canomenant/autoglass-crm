const express = require("express");
const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const agentsStore = require("../store/agents.store");
const techniciansStore = require("../store/technicians.store");
const usersStore = require("../store/users.store");
const { verifyPassword } = require("../lib/password");
const { requireAuth } = require("../middleware/auth");
const { JWT_SECRET, SIGN_OPTIONS } = require("../config/secrets");
const mfa = require("../lib/mfa");
const { issueChallenge, readChallenge } = require("./mfa.routes");

const router = express.Router();

// users.store roles (Admin/Tech/Sales/Employee) are a different, older vocabulary than the JWT
// roles (ADMIN/AGENT/TECHNICIAN) the rest of the app checks — only "Admin" has a defined mapping
// today. A "Sales"/"Tech"/"Employee" users.store record intentionally can't log in yet.
const USERS_ROLE_MAP = { Admin: "ADMIN" };

// Una sola respuesta para todo fallo de login. Antes había dos distinguibles: una cuenta
// desactivada con la contraseña CORRECTA devolvía "This account is inactive", que confirma a la
// vez que el correo existe y que la contraseña probada es la buena — exactamente lo que busca
// quien prueba credenciales filtradas de otras brechas.
const INVALID = { error: "Invalid credentials" };

// Hash de una contraseña que nadie usa, con el mismo coste (12) que los reales. Se compara
// contra él cuando el correo no existe para que la respuesta tarde lo mismo haya cuenta o no:
// sin esto, la diferencia entre retornar al instante y ejecutar un bcrypt de ~250 ms enumera
// correos válidos por tiempo aunque los mensajes sean idénticos.
const DUMMY_HASH = bcrypt.hashSync("::nonexistent-account-timing-equalizer::", 12);

function issueToken(res, payload) {
  const token = jwt.sign(payload, JWT_SECRET, SIGN_OPTIONS);
  res.json({ token, user: payload });
}

// timingSafeEqual exige longitudes iguales, así que se comparan los digest: longitud fija
// siempre, y sin filtrar la longitud real del secreto por la vía de lanzar o no lanzar.
function safeEqual(a, b) {
  const ha = crypto.createHash("sha256").update(String(a ?? "")).digest();
  const hb = crypto.createHash("sha256").update(String(b ?? "")).digest();
  return crypto.timingSafeEqual(ha, hb);
}

// Break-glass: sólo alcanzable cuando ambas variables están puestas, así que está apagado por
// defecto y no hay credencial embebida que se pueda filtrar. La contraseña se guarda como hash
// bcrypt y no en claro — una variable de entorno queda expuesta en el panel de Railway, en
// `printenv` y en cualquier volcado del proceso.
//
// Devuelve el payload del token si acierta, null si no aplica o falla.
async function tryEmergencyAdmin(req, email, password) {
  const { EMERGENCY_ADMIN_EMAIL, EMERGENCY_ADMIN_PASSWORD_HASH } = process.env;
  if (!EMERGENCY_ADMIN_EMAIL || !EMERGENCY_ADMIN_PASSWORD_HASH) return null;

  const emailOk = safeEqual(String(email || "").toLowerCase(), EMERGENCY_ADMIN_EMAIL.toLowerCase());
  const passOk = emailOk && (await bcrypt.compare(String(password || ""), EMERGENCY_ADMIN_PASSWORD_HASH));

  if (passOk) {
    // Este acceso se salta todos los controles normales y no deja rastro en ningún store.
    // Tiene que ser ruidoso: el aviso en el log es la única evidencia de que ocurrió.
    console.warn(`[SECURITY] Break-glass admin login USADO desde ${req.ip} — ${new Date().toISOString()}`);
    return { id: "emergency-admin", email, name: "Emergency Admin", role: "ADMIN", entityId: null, mustChangePassword: false };
  }
  if (emailOk) console.warn(`[SECURITY] Break-glass admin login FALLIDO desde ${req.ip} — ${new Date().toISOString()}`);
  return null;
}

router.post("/login", async (req, res) => {
  const { email, password } = req.body || {};

  if (typeof email !== "string" || typeof password !== "string") {
    // Se paga el mismo coste que un intento real para no delatar la forma del cuerpo.
    await bcrypt.compare(String(password || ""), DUMMY_HASH);
    return res.status(401).json(INVALID);
  }

  const emergency = await tryEmergencyAdmin(req, email, password);
  if (emergency) return issueToken(res, emergency);

  const candidates = [
    { record: usersStore.findByEmail(email), role: null, store: usersStore, prefix: "user" },
    { record: agentsStore.findByEmail(email), role: "AGENT", store: agentsStore, prefix: "agent" },
    { record: await techniciansStore.findByEmail(email), role: "TECHNICIAN", store: techniciansStore, prefix: "tech" },
  ];

  for (const c of candidates) {
    if (!c.record) continue;
    const role = c.role || USERS_ROLE_MAP[c.record.role];
    if (!role) continue;

    const { valid, needsRehash } = await verifyPassword(password, c.record.password);
    if (!valid) continue;

    // Mismo 401 que una contraseña incorrecta: ver el comentario de INVALID.
    if (c.record.status !== undefined && c.record.status !== "Active") {
      return res.status(401).json(INVALID);
    }
    if (needsRehash) {
      c.store.update(c.record.id, { password }).catch((e) => console.error("rehash failed:", e.message));
    }

    // Segundo factor: la contraseña es correcta, pero todavía no hay sesión. Se devuelve un reto
    // de vida corta que SÓLO sirve para POST /auth/mfa/verify — requireAuth lo rechaza por su
    // claim `purpose`, así que no es una sesión a medias con la que se pueda operar.
    if (c.record.mfaEnabled) {
      return res.json({
        mfaRequired: true,
        challenge: issueChallenge(c.record),
      });
    }

    return issueToken(res, {
      id: `${c.prefix}-${c.record.id}`,
      email: c.record.email,
      name: c.record.name,
      role,
      entityId: c.record.id,
      mustChangePassword: c.record.mustChangePassword,
      // requireAuth lo compara con el valor almacenado: cambiar la contraseña lo incrementa y
      // deja fuera a cualquier sesión abierta antes de ese momento.
      tokenVersion: c.record.tokenVersion || 0,
    });
  }

  // Ningún candidato: se iguala el coste con el hash señuelo antes de responder.
  await bcrypt.compare(password, DUMMY_HASH);
  return res.status(401).json(INVALID);
});

// Segundo paso del login. Sin sesión todavía: lo que autoriza es el reto emitido arriba más un
// código válido. Va montado con el limitador de login (index.js): seis dígitos son un millón de
// combinaciones y sin límite de intentos se agotan en minutos.
router.post("/mfa/verify", async (req, res) => {
  const INVALIDO = { error: "That code is not valid." };

  let claims;
  try {
    claims = readChallenge(req.body?.challenge);
  } catch {
    // Reto caducado o manipulado: se vuelve a empezar por la contraseña.
    return res.status(401).json({ error: "Your sign-in attempt expired. Please start again." });
  }

  // get() devuelve el registro saneado (sin secreto ni códigos); findByEmail devuelve el crudo,
  // que es el que la verificación necesita.
  const perfil = usersStore.get(claims.entityId);
  const record = perfil && usersStore.findByEmail(perfil.email);
  if (!record || !record.mfaEnabled) return res.status(401).json(INVALIDO);

  const { ok, step, replay } = mfa.verifyTotp(record, req.body?.token);

  if (ok) {
    // Se marca la ventana consumida ANTES de emitir la sesión: es lo que impide reutilizar un
    // código visto de reojo o interceptado durante los 90 segundos que sigue siendo aritmética
    // válida.
    await usersStore.update(record.id, { mfaLastStep: step });
  } else {
    if (replay) console.warn(`[SECURITY] Código MFA repetido para ${record.email} desde ${req.ip}`);
    // Si no es un TOTP válido, puede ser un código de recuperación. Se consume de una sola vez.
    const idx = await mfa.consumeBackupCode(req.body?.token, record.mfaBackupCodes);
    if (idx === -1) return res.status(401).json(INVALIDO);

    const restantes = record.mfaBackupCodes.filter((_, i) => i !== idx);
    await usersStore.update(record.id, { mfaBackupCodes: restantes });
    console.warn(
      `[SECURITY] Código de recuperación usado por ${record.email} desde ${req.ip} — quedan ${restantes.length}`
    );
  }

  return issueToken(res, {
    id: `user-${record.id}`,
    email: record.email,
    name: record.name,
    role: USERS_ROLE_MAP[record.role],
    entityId: record.id,
    mustChangePassword: record.mustChangePassword,
    tokenVersion: record.tokenVersion || 0,
  });
});

router.post("/forgot-password", (req, res) => {
  res.json({ message: "If the account exists, a reset link was sent." });
});

router.post("/change-password", requireAuth, async (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  const { role, entityId } = req.user;

  if (entityId == null) {
    return res.status(400).json({ error: "This account cannot change its password here." });
  }
  if (!newPassword || newPassword.length < 8) {
    return res.status(400).json({ error: "New password must be at least 8 characters." });
  }

  const store = { ADMIN: usersStore, AGENT: agentsStore, TECHNICIAN: techniciansStore }[role];
  if (!store) return res.status(400).json({ error: "This account cannot change its password here." });

  // findByEmail (unlike list/get) returns the unsanitized record — the password hash is needed
  // here to verify currentPassword, and every store's findByEmail already returns it raw.
  const record = await store.findByEmail(req.user.email);
  if (!record) return res.status(404).json({ error: "Account not found" });

  const { valid } = await verifyPassword(currentPassword, record.password);
  if (!valid) return res.status(401).json({ error: "Current password is incorrect" });

  await store.update(entityId, {
    password: newPassword,
    mustChangePassword: false,
    // Cambiar la contraseña es el gesto con el que alguien expulsa a un intruso. Sin esto no
    // expulsaba a nadie: un JWT es autocontenido y el token robado seguía valiendo sus 8 horas.
    // Incrementarlo invalida todas las sesiones abiertas, incluida la de quien lo cambia.
    tokenVersion: (record.tokenVersion || 0) + 1,
  });

  res.json({ message: "Password updated. Please sign in again." });
});

module.exports = router;
