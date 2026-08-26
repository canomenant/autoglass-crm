const express = require("express");
const jwt = require("jsonwebtoken");
const usersStore = require("../store/users.store");
const totp = require("../lib/totp");
const mfa = require("../lib/mfa");
const { verifyPassword } = require("../lib/password");
const { requireAuth } = require("../middleware/auth");
const { JWT_SECRET, SIGN_OPTIONS, VERIFY_OPTIONS } = require("../config/secrets");

const router = express.Router();

// El alta y la baja del segundo factor viven bajo requireAuth: hay que tener sesión para tocar
// el propio MFA. La verificación en el login NO, porque en ese momento todavía no hay sesión —
// va montada aparte en index.js con su propio limitador.

// --- Reto intermedio del login -----------------------------------------------------------
//
// Entre "la contraseña es correcta" y "el segundo factor es correcto" hace falta llevar estado.
// Se hace con un token firmado y de vida corta, NO con una sesión a medias.
//
// purpose:"mfa-challenge" es lo que impide que este token sirva como sesión: requireAuth lo
// rechaza explícitamente. Sin esa marca, el reto ES un token válido y saltarse el segundo factor
// consistiría en usarlo tal cual contra cualquier endpoint — que es el fallo clásico de este flujo.
const CHALLENGE_PURPOSE = "mfa-challenge";
const CHALLENGE_TTL = "5m";

function issueChallenge(user) {
  return jwt.sign(
    { purpose: CHALLENGE_PURPOSE, entityId: user.id, role: "ADMIN" },
    JWT_SECRET,
    { ...SIGN_OPTIONS, expiresIn: CHALLENGE_TTL }
  );
}

function readChallenge(token) {
  const claims = jwt.verify(token, JWT_SECRET, VERIFY_OPTIONS);
  if (claims.purpose !== CHALLENGE_PURPOSE) throw new Error("No es un reto de MFA");
  return claims;
}

// --- Alta --------------------------------------------------------------------------------

// Paso 1: genera un secreto y lo devuelve para que se escanee. Todavía NO se activa nada: hasta
// que no se demuestre que la app genera códigos buenos, activar dejaría la cuenta bloqueada.
router.post("/setup", requireAuth, async (req, res) => {
  if (!mfa.isConfigured()) {
    return res.status(503).json({ error: "MFA no está configurado en este servidor (falta MFA_ENCRYPTION_KEY)." });
  }
  if (req.user.role !== "ADMIN" || req.user.entityId == null) {
    return res.status(403).json({ error: "Only admin accounts can enable MFA today." });
  }

  const record = usersStore.findByEmail(req.user.email);
  if (!record) return res.status(404).json({ error: "Account not found" });

  const secret = totp.generateSecret();
  // Se guarda cifrado y con mfaEnabled todavía en false: es un alta a medias, y el login sigue
  // sin pedir segundo factor hasta que /enable la confirme.
  await usersStore.update(record.id, { mfaSecret: mfa.encryptSecret(secret), mfaEnabled: false, mfaLastStep: null });

  res.json({
    secret,
    otpauthUri: totp.otpauthUri({ secret, account: record.email }),
  });
});

// Paso 2: confirma con un código de la app y activa. Devuelve los códigos de recuperación UNA
// sola vez — se guardan con bcrypt, así que ni el servidor puede volver a mostrarlos.
router.post("/enable", requireAuth, async (req, res) => {
  if (req.user.role !== "ADMIN" || req.user.entityId == null) {
    return res.status(403).json({ error: "Only admin accounts can enable MFA today." });
  }
  const record = usersStore.findByEmail(req.user.email);
  if (!record || !record.mfaSecret) return res.status(400).json({ error: "Start with /setup first." });
  if (record.mfaEnabled) return res.status(409).json({ error: "MFA is already enabled." });

  const { ok, step } = mfa.verifyTotp(record, req.body?.token);
  if (!ok) return res.status(401).json({ error: "That code is not valid. Check your authenticator app." });

  const codes = mfa.generateBackupCodes();
  await usersStore.update(record.id, {
    mfaEnabled: true,
    mfaBackupCodes: await mfa.hashBackupCodes(codes),
    mfaLastStep: step,
  });

  console.warn(`[SECURITY] MFA activado para ${record.email} desde ${req.ip} — ${new Date().toISOString()}`);
  res.json({
    enabled: true,
    // La única vez que se ven. A partir de aquí sólo existen sus hashes.
    backupCodes: codes,
  });
});

// Baja: exige contraseña Y un código vigente. Sólo la sesión no basta — desactivar el segundo
// factor con una sesión robada lo dejaría en nada.
router.post("/disable", requireAuth, async (req, res) => {
  const record = usersStore.findByEmail(req.user.email);
  if (!record) return res.status(404).json({ error: "Account not found" });
  if (!record.mfaEnabled) return res.status(409).json({ error: "MFA is not enabled." });

  // Comprobado antes de llamar a bcrypt: compare(undefined, hash) lanza, y ese throw acababa
  // como un 400 del manejador de errores en vez del 401 que corresponde.
  if (typeof req.body?.password !== "string" || !req.body.password) {
    return res.status(401).json({ error: "Current password is incorrect" });
  }
  const { valid } = await verifyPassword(req.body.password, record.password);
  if (!valid) return res.status(401).json({ error: "Current password is incorrect" });

  const { ok } = mfa.verifyTotp(record, req.body?.token);
  const idx = ok ? -1 : await mfa.consumeBackupCode(req.body?.token, record.mfaBackupCodes);
  if (!ok && idx === -1) return res.status(401).json({ error: "That code is not valid." });

  await usersStore.update(record.id, { mfaEnabled: false, mfaSecret: null, mfaBackupCodes: [], mfaLastStep: null });
  console.warn(`[SECURITY] MFA DESACTIVADO para ${record.email} desde ${req.ip} — ${new Date().toISOString()}`);
  res.json({ enabled: false });
});

// Estado, para que la pantalla de seguridad sepa qué ofrecer.
router.get("/status", requireAuth, (req, res) => {
  const record = req.user.entityId != null ? usersStore.findByEmail(req.user.email) : null;
  res.json({
    available: mfa.isConfigured() && req.user.role === "ADMIN" && req.user.entityId != null,
    enabled: !!(record && record.mfaEnabled),
    backupCodesRemaining: record && record.mfaEnabled ? (record.mfaBackupCodes || []).length : 0,
  });
});

module.exports = { router, issueChallenge, readChallenge, CHALLENGE_PURPOSE };
