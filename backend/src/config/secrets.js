// Un JWT_SECRET débil no es un aviso, es una brecha: quien lo conozca firma su propio token
// { role: "ADMIN" } y pasa requireAuth sin haber tenido nunca una cuenta. El valor "changeme"
// estaba además publicado en .env.example, que sí se versiona — no habia ni que adivinarlo.
//
// Por eso esto se comprueba al cargar el módulo y lanza: el proceso no debe llegar a escuchar
// en un puerto con un secreto que cualquiera puede reproducir.
const WEAK_SECRETS = new Set([
  "changeme", "change-me", "secret", "jwtsecret", "jwt_secret", "mysecret",
  "dev", "devsecret", "test", "testing", "password", "supersecret", "todo",
]);

const MIN_LENGTH = 32;

function requireJwtSecret() {
  const secret = process.env.JWT_SECRET;
  const hint =
    'Genere uno con: node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'base64url\'))"';

  if (!secret) throw new Error(`JWT_SECRET no está definido. ${hint}`);
  if (secret.length < MIN_LENGTH) {
    throw new Error(`JWT_SECRET es demasiado corto (${secret.length} caracteres, mínimo ${MIN_LENGTH}). ${hint}`);
  }
  if (WEAK_SECRETS.has(secret.toLowerCase())) {
    throw new Error(`JWT_SECRET es un valor de ejemplo conocido y no sirve como secreto. ${hint}`);
  }
  return secret;
}

// Opciones compartidas por quien firma y quien verifica. El algoritmo se fija en ambos extremos
// a propósito: sin `algorithms` en la verificación, un token con "alg" elegido por el atacante
// se acepta mientras la firma cuadre — la confusión de algoritmo clásica.
const JWT_ALGORITHM = "HS256";
const JWT_ISSUER = "autoglass-crm";
const JWT_EXPIRES_IN = "8h";

const SIGN_OPTIONS = { algorithm: JWT_ALGORITHM, issuer: JWT_ISSUER, expiresIn: JWT_EXPIRES_IN };
const VERIFY_OPTIONS = { algorithms: [JWT_ALGORITHM], issuer: JWT_ISSUER };

module.exports = {
  JWT_SECRET: requireJwtSecret(),
  SIGN_OPTIONS,
  VERIFY_OPTIONS,
};
