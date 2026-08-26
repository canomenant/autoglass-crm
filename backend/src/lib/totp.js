const crypto = require("crypto");

// TOTP (RFC 6238) sobre HOTP (RFC 4226).
//
// Implementado aquí en vez de traer una dependencia por dos razones. Una: son cuarenta líneas de
// HMAC y truncamiento, sin intercambio de claves ni primitivas propias — el riesgo de escribirlo
// mal es bajo y, sobre todo, es COMPROBABLE: tests/totp.test.js lo verifica contra los vectores
// de prueba publicados en el RFC 6238, que es una prueba de corrección de verdad y no un "parece
// que funciona". Dos: la cadena de suministro es uno de los riesgos que esta misma auditoría
// señala, y cada dependencia en el arranque de sesión es superficie añadida.

const DIGITS = 6;
const PERIOD = 30; // segundos por ventana, el estándar que asumen Google Authenticator y Authy

// Base32 (RFC 4648) sin relleno: es el alfabeto que esperan las apps de autenticación en la URI
// otpauth://, no base64.
const B32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function base32Encode(buf) {
  let bits = 0;
  let valor = 0;
  let salida = "";
  for (const byte of buf) {
    valor = (valor << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      salida += B32_ALPHABET[(valor >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) salida += B32_ALPHABET[(valor << (5 - bits)) & 31];
  return salida;
}

function base32Decode(str) {
  const limpio = String(str).toUpperCase().replace(/=+$/, "").replace(/\s+/g, "");
  let bits = 0;
  let valor = 0;
  const bytes = [];
  for (const ch of limpio) {
    const idx = B32_ALPHABET.indexOf(ch);
    if (idx === -1) throw new Error("Secreto TOTP inválido: no es base32.");
    valor = (valor << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bytes.push((valor >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

// 20 bytes = 160 bits, el tamaño que recomienda el RFC 4226 para HMAC-SHA1.
function generateSecret() {
  return base32Encode(crypto.randomBytes(20));
}

// HOTP: HMAC-SHA1 del contador de 8 bytes en big-endian, y truncamiento dinámico.
function hotp(secretBase32, counter) {
  const key = base32Decode(secretBase32);
  const buf = Buffer.alloc(8);
  buf.writeUInt32BE(Math.floor(counter / 0x100000000), 0);
  buf.writeUInt32BE(counter >>> 0, 4);

  const hmac = crypto.createHmac("sha1", key).update(buf).digest();
  // El nibble bajo del último byte dice dónde empiezan los 4 bytes que se usan.
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binario =
    ((hmac[offset] & 0x7f) << 24) | ((hmac[offset + 1] & 0xff) << 16) | ((hmac[offset + 2] & 0xff) << 8) | (hmac[offset + 3] & 0xff);

  return String(binario % 10 ** DIGITS).padStart(DIGITS, "0");
}

function counterFor(timeMs = Date.now(), period = PERIOD) {
  return Math.floor(timeMs / 1000 / period);
}

function generate(secretBase32, timeMs = Date.now()) {
  return hotp(secretBase32, counterFor(timeMs));
}

// Verifica con una ventana de tolerancia: `window: 1` acepta el código anterior y el siguiente,
// que es lo que absorbe el desfase de reloj del teléfono y el tiempo que tarda alguien en teclear.
// Más ancha multiplica los códigos válidos a la vez, así que 1 es el equilibrio habitual.
//
// Devuelve el step (contador) que acertó, o null. El caller DEBE guardar ese step y rechazar los
// que no sean mayores: sin eso, un código interceptado sirve durante los 90 segundos de la
// ventana, que es exactamente el ataque de repetición que el segundo factor debe evitar.
function verify(secretBase32, token, { timeMs = Date.now(), window = 1 } = {}) {
  const limpio = String(token || "").replace(/\s+/g, "");
  if (!/^\d{6}$/.test(limpio)) return null;

  const actual = counterFor(timeMs);
  for (let delta = -window; delta <= window; delta++) {
    const step = actual + delta;
    if (step < 0) continue;
    const esperado = hotp(secretBase32, step);
    // Comparación de tiempo constante: con === el tiempo de respuesta filtra cuántos dígitos
    // iniciales acertó quien prueba, y seis dígitos se recorren mucho antes con esa pista.
    const a = Buffer.from(esperado);
    const b = Buffer.from(limpio);
    if (a.length === b.length && crypto.timingSafeEqual(a, b)) return step;
  }
  return null;
}

// La URI que se mete en el QR. `issuer` sale también como prefijo de la etiqueta porque hay
// apps que sólo leen esa parte.
function otpauthUri({ secret, account, issuer = "AutoGlass CRM" }) {
  const label = encodeURIComponent(`${issuer}:${account}`);
  const params = new URLSearchParams({
    secret,
    issuer,
    algorithm: "SHA1",
    digits: String(DIGITS),
    period: String(PERIOD),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}

module.exports = { generateSecret, generate, verify, otpauthUri, hotp, counterFor, base32Encode, base32Decode, DIGITS, PERIOD };
