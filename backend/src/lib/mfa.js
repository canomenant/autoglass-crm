const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const totp = require("./totp");

// Segundo factor: cifrado del secreto en reposo, códigos de recuperación y la lógica de
// verificación con protección contra repetición.
//
// El secreto TOTP es una credencial permanente: quien lo lee genera códigos válidos para siempre,
// sin dejar rastro y sin que la víctima se entere. Guardarlo en claro convertiría un volcado de la
// base —o el propio historial de Git, que ya nos pasó con los clientes— en la anulación silenciosa
// del segundo factor de todas las cuentas. Por eso va cifrado con una clave que NO está en la base.

const ALGO = "aes-256-gcm";
const IV_BYTES = 12; // el tamaño que recomienda NIST para GCM
const BACKUP_CODE_COUNT = 8;

// La clave de cifrado vive sólo en el entorno. Deliberadamente separada de JWT_SECRET: rotar el
// secreto de sesión es una operación rutinaria (lo acabamos de hacer), y si compartieran clave,
// rotarlo dejaría a todo el mundo fuera de su propio segundo factor.
function encryptionKey() {
  const raw = process.env.MFA_ENCRYPTION_KEY;
  if (!raw) {
    throw new Error(
      "MFA_ENCRYPTION_KEY no está definida. Genérela con: " +
        "node -e \"console.log(require('crypto').randomBytes(32).toString('base64'))\""
    );
  }
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) {
    throw new Error(`MFA_ENCRYPTION_KEY debe ser de 32 bytes en base64 (son ${key.length}).`);
  }
  return key;
}

// ¿Se puede activar MFA en este despliegue? Se consulta antes de ofrecerlo, para no llevar a
// alguien por todo el alta y fallar al guardar.
function isConfigured() {
  try {
    encryptionKey();
    return true;
  } catch {
    return false;
  }
}

// GCM: cifra y autentica a la vez. El tag va guardado junto al texto cifrado, así que un secreto
// manipulado en la base falla al descifrar en vez de producir basura que parezca un secreto.
function encryptSecret(plain) {
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv(ALGO, encryptionKey(), iv);
  const enc = Buffer.concat([cipher.update(String(plain), "utf8"), cipher.final()]);
  return `v1.${iv.toString("base64")}.${cipher.getAuthTag().toString("base64")}.${enc.toString("base64")}`;
}

function decryptSecret(stored) {
  const partes = String(stored || "").split(".");
  if (partes.length !== 4 || partes[0] !== "v1") throw new Error("Secreto MFA con formato desconocido.");
  const [, iv, tag, datos] = partes;
  const decipher = crypto.createDecipheriv(ALGO, encryptionKey(), Buffer.from(iv, "base64"));
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(datos, "base64")), decipher.final()]).toString("utf8");
}

// Códigos de recuperación, para cuando el teléfono se pierde o se rompe. Sin ellos, perder el
// móvil significa perder la cuenta de administrador — y la salida sería un backdoor permanente,
// que es peor que el problema.
//
// Formato agrupado (XXXX-XXXX) porque se copian a mano. Alfabeto sin 0/O/1/I/L para que nadie
// pierda el acceso por transcribir mal un carácter ambiguo.
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

function generateBackupCodes(n = BACKUP_CODE_COUNT) {
  const codigos = [];
  for (let i = 0; i < n; i++) {
    let c = "";
    // randomInt es uniforme y criptográfico; el módulo sobre randomBytes sesgaría el alfabeto.
    for (let j = 0; j < 8; j++) c += CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)];
    codigos.push(`${c.slice(0, 4)}-${c.slice(4)}`);
  }
  return codigos;
}

function normalizeBackupCode(code) {
  return String(code || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

// Con bcrypt, igual que las contraseñas: un código de recuperación ES una contraseña de un solo
// uso, y la base no tiene por qué poder devolverlos.
async function hashBackupCodes(codigos) {
  return Promise.all(codigos.map((c) => bcrypt.hash(normalizeBackupCode(c), 10)));
}

// Devuelve el índice consumido, o -1. El caller debe BORRAR ese hash: un código de recuperación
// vale una vez, y dejarlo reutilizable lo convierte en una segunda contraseña permanente.
async function consumeBackupCode(codigo, hashes) {
  const limpio = normalizeBackupCode(codigo);
  if (!limpio) return -1;
  for (let i = 0; i < (hashes || []).length; i++) {
    if (await bcrypt.compare(limpio, hashes[i])) return i;
  }
  return -1;
}

// Verifica un código de 6 dígitos contra el secreto cifrado del registro.
//
// `lastStep` es la ventana ya usada. Rechazar los steps que no la superen es lo que impide la
// repetición: sin eso, un código visto por encima del hombro o interceptado sigue valiendo hasta
// 90 segundos, y el segundo factor deja de ser algo que sólo tiene el dueño del teléfono.
function verifyTotp(record, token, { timeMs = Date.now() } = {}) {
  if (!record || !record.mfaSecret) return { ok: false, step: null };
  const secret = decryptSecret(record.mfaSecret);
  const step = totp.verify(secret, token, { timeMs });
  if (step === null) return { ok: false, step: null };
  if (record.mfaLastStep != null && step <= record.mfaLastStep) {
    return { ok: false, step: null, replay: true };
  }
  return { ok: true, step };
}

module.exports = {
  isConfigured,
  encryptSecret,
  decryptSecret,
  generateBackupCodes,
  hashBackupCodes,
  consumeBackupCode,
  normalizeBackupCode,
  verifyTotp,
  BACKUP_CODE_COUNT,
};
