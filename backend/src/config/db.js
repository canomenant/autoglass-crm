const fs = require("fs");
const path = require("path");
const { Pool, types } = require("pg");

// NUMERIC (oid 1700) comes back as a string by default to avoid float rounding loss.
// Parse centrally here so every store's mapRow() can treat money fields as plain JS numbers.
types.setTypeParser(1700, (v) => (v === null ? null : parseFloat(v)));

const url = process.env.DATABASE_URL || "";

// node-postgres NO cifra por defecto. La base vive en un host público de Railway alcanzado por
// Internet, así que sin esto el protocolo de conexión, la contraseña y todas las filas
// devueltas —clientes, pagos, comisiones, adjuntos de siniestros— viajaban en claro.
//
// Sólo se exime localhost: ahí el tráfico no sale de la máquina.
const isLocal = /@(localhost|127\.0\.0\.1|\[::1\])[:/]/.test(url);

// La CA con la que validar. Inline (DATABASE_CA_CERT, cómodo para Railway) o en fichero
// (DATABASE_CA_CERT_FILE, cómodo en local). Por defecto, la raíz de Railway que viene en el repo.
function loadCa() {
  if (process.env.DATABASE_CA_CERT) return process.env.DATABASE_CA_CERT;
  const file = process.env.DATABASE_CA_CERT_FILE || path.join(__dirname, "..", "..", "certs", "railway-root-ca.pem");
  try {
    return fs.readFileSync(file, "utf-8");
  } catch {
    return null;
  }
}

// Railway firma el certificado del proxy con una CA propia (CN=root-ca), no con una CA pública,
// así que la validación contra el almacén del sistema falla ("self-signed certificate in
// certificate chain"). La respuesta correcta NO es rejectUnauthorized:false —eso cifra pero no
// autentica, y un intermediario pasa igual—: es fijar esa CA y validar contra ella.
//
// El detalle: el certificado de hoja lleva CN=localhost, porque lo emite el proxy para el
// servidor que tiene detrás, no para el nombre público. La comprobación de nombre estándar lo
// rechazaría, así que se sustituye por la que sí tiene sentido aquí: que el certificado sea
// exactamente el que ese proxy emite. La cadena la sigue validando `ca` + rejectUnauthorized.
//
// Qué protege: a alguien que se interponga con un certificado autofirmado propio, o con uno
// legítimo de una CA pública, ya no le vale — necesitaría uno firmado por esta raíz.
// Qué no protege: a otro inquilino de Railway firmado por la MISMA raíz. Cerrar eso del todo
// exige la red privada del proveedor, donde el tráfico no sale a Internet.
const EXPECTED_LEAF_CN = process.env.DATABASE_CERT_CN || "localhost";

function checkServerIdentity(host, cert) {
  if (cert && cert.subject && cert.subject.CN === EXPECTED_LEAF_CN) return undefined;
  return new Error(
    `Certificado inesperado para ${host}: CN=${cert && cert.subject && cert.subject.CN}, ` +
      `se esperaba CN=${EXPECTED_LEAF_CN}. Si el proveedor cambió su certificado, actualice ` +
      `backend/certs/railway-root-ca.pem y DATABASE_CERT_CN.`
  );
}

const ca = isLocal ? null : loadCa();
const noVerify = process.env.DATABASE_SSL_NO_VERIFY === "true";

let ssl;
if (isLocal) {
  ssl = undefined;
} else if (ca && !noVerify) {
  ssl = { ca, rejectUnauthorized: true, checkServerIdentity };
} else {
  // Último recurso, y ruidoso: sin CA no hay nada contra lo que validar.
  ssl = { rejectUnauthorized: !noVerify };
  if (noVerify) {
    console.warn(
      "[pg] DATABASE_SSL_NO_VERIFY=true — la conexión va cifrada pero SIN validar el certificado " +
        "del servidor, así que no protege frente a un intermediario. Quite esa variable para " +
        "volver a validar contra backend/certs/railway-root-ca.pem."
    );
  } else if (!ca) {
    console.warn("[pg] Sin CA para validar (falta backend/certs/railway-root-ca.pem y DATABASE_CA_CERT).");
  }
}

// Sin connectionTimeoutMillis: seed() abre en paralelo una consulta pesada por cada
// distribuidor, y un tope corto convierte esa cola normal de arranque en un fallo.
//
// idleTimeoutMillis: el valor por defecto de pg es 10 SEGUNDOS. Con la base al otro lado de
// internet, abrir una conexión son TCP + TLS + autenticación (medido: hasta ~4s en frío), y el
// ritmo de uso del taller —clic, leer, teclear medio minuto, guardar— dejaba el pool vacío entre
// una acción y la siguiente: casi cada operación pagaba la reconexión completa, que es lo que se
// sentía como "tarda en jalar y en guardar". Las conexiones se conservan 10 minutos, con
// keep-alive TCP para que ningún intermediario (el proxy de Railway incluido) las mate por
// silencio.
const pool = new Pool({
  connectionString: url,
  ...(ssl ? { ssl } : {}),
  idleTimeoutMillis: 10 * 60 * 1000,
  keepAlive: true,
  keepAliveInitialDelayMillis: 30 * 1000,
});

// Un cliente inactivo que se cae (corte de red, reinicio del proveedor) emite 'error' en el
// pool. Sin este manejador, Node lo trata como excepción no capturada y tumba el proceso.
pool.on("error", (err) => console.error("[pg] idle client error:", err.message));

// Latido: mantiene al menos una conexión establecida y caliente aunque nadie use la app un rato,
// y detecta una caída antes de que la descubra un usuario con su clic. unref(): el temporizador
// no impide que el proceso termine (scripts one-off que importan este pool).
const HEARTBEAT_MS = 60 * 1000;
setInterval(() => {
  pool.query("SELECT 1").catch((err) => console.warn("[pg] heartbeat falló:", err.message));
}, HEARTBEAT_MS).unref();

module.exports = pool;
