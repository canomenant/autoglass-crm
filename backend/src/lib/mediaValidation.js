// Validación de todo lo que llega como data: URI — adjuntos de siniestro, fotos del intake y
// fotos del técnico.
//
// Vive aparte de los stores por dos razones. Una: las reglas estaban duplicadas en
// quotes.store.js y workorders.store.js, y dos copias de una regla de seguridad divergen. Dos:
// los stores abren la conexión a Postgres al importarse, así que con las reglas dentro no había
// forma de probarlas sin base de datos — y esto es justo lo que hay que poder probar.
//
// El principio que comparten todas: NO se confía en lo que el cliente dice que es un fichero.
// `fileType` y el prefijo del data: URI los escribe el navegador y ambos son editables desde una
// llamada directa a la API. Lo único que no miente son los bytes.

const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024; // 5MB — claims run 50-200KB; room for a multi-page scan
const MAX_ATTACHMENTS = 10;
const ALLOWED_ATTACHMENT_TYPES = ["application/pdf", "image/jpeg", "image/png"];

const DATA_URL_RE = /^data:([a-z]+\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/=]+)$/i;

// La firma real del fichero. Sin esto, un "data:application/pdf;base64," con HTML dentro pasaba
// la lista blanca, y el visor de adjuntos lo abría como blob: en un <iframe> — que hereda
// nuestro origen, y con él el acceso a localStorage y al token de sesión.
const MAGIC = {
  "application/pdf": (b) => b.slice(0, 5).toString("latin1") === "%PDF-",
  "image/png": (b) => b.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  "image/jpeg": (b) => b[0] === 0xff && b[1] === 0xd8 && b[b.length - 2] === 0xff && b[b.length - 1] === 0xd9,
};

// Las fotos se renderizan como <img>, donde el riesgo no es la ejecución sino el almacenamiento
// sin límite, así que la lista de subtipos es amplia a propósito: el <input capture="environment">
// de un iPhone entrega HEIC, y cerrarla a jpeg/png rompería la subida desde el móvil — que es
// justo el aparato para el que existen esas pantallas.
const PHOTO_URL_RE = /^data:(image\/(?:jpeg|pjpeg|png|webp|gif|heic|heif));base64,([A-Za-z0-9+/=]+)$/i;
const MAX_PHOTO_BYTES = 5 * 1024 * 1024;

const INTAKE_CATEGORIES = ["driverSide", "passengerSide", "front", "rear", "damageArea", "insuranceCard"];
const MAX_PHOTOS_PER_CATEGORY = 3; // el mismo tope que ya aplicaba la UI (intake/[token]/page.js)
const MAX_TECH_PHOTOS = 20;

// Nombre de fichero que va a viajar en JSON y a aparecer en una interfaz. Se le quitan saltos de
// línea y separadores de ruta, y se le pone un techo de longitud.
function safeFileName(name) {
  return String(name || "").replace(/[\r\n\\/]/g, "_").slice(0, 200);
}

// El conjunto de URLs ya persistidas, para poder dejarlas pasar sin revalidar.
//
// Endurecer una regla no debe convertirse en "ya no se puede editar ese registro": lo histórico
// puede tener formas que la regla nueva no admite, y ahí la regla llega tarde — el dato ya está
// guardado. Se aplica a lo que entra nuevo, que es lo que sí se puede contener.
function storedUrls(existing) {
  const list = Array.isArray(existing)
    ? existing
    : Object.values(existing || {}).flatMap((v) => (Array.isArray(v) ? v : []));
  return new Set(list.map((p) => (typeof p === "string" ? p : p && p.url)).filter(Boolean));
}

// Adjuntos de siniestro: PDF/JPG/PNG, comprobados por magic bytes.
//
// Muta los elementos in situ para normalizarlos: lo que se persiste es el data: URI reconstruido
// desde el MIME ya validado, de modo que el frontend no pueda leer después un tipo distinto del
// que se comprobó aquí.
function validateInsuranceAttachments(attachments, existing = []) {
  if (attachments === undefined) return;
  if (!Array.isArray(attachments)) throw new Error("insuranceAttachments must be an array.");
  if (attachments.length > MAX_ATTACHMENTS) {
    throw new Error(`Too many attachments — the limit is ${MAX_ATTACHMENTS}.`);
  }

  const already = storedUrls(existing.map ? existing.map((a) => ({ url: a && a.dataUrl })) : []);

  for (const a of attachments) {
    if (a && already.has(a.dataUrl)) continue;

    const name = String((a && a.fileName) || "");
    const m = DATA_URL_RE.exec(String((a && a.dataUrl) || ""));
    if (!m) throw new Error(`Attachment "${name}" is not a valid base64 data URL.`);

    const declaredMime = m[1].toLowerCase();
    // El MIME del data: URI y el fileType tienen que coincidir Y estar en la lista blanca.
    // Que diverjan es exactamente lo que permitía colar un text/html etiquetado como PDF.
    if (!ALLOWED_ATTACHMENT_TYPES.includes(declaredMime) || declaredMime !== a.fileType) {
      throw new Error(`Attachment "${name}" has an unsupported file type — only PDF, JPG, and PNG are allowed.`);
    }

    const buf = Buffer.from(m[2], "base64");
    if (buf.length === 0) throw new Error(`Attachment "${name}" is empty.`);
    if (buf.length > MAX_ATTACHMENT_BYTES) {
      throw new Error(`Attachment "${name}" is too large — the limit is 5MB per file.`);
    }
    if (!MAGIC[declaredMime](buf)) {
      throw new Error(`Attachment "${name}" does not match its declared type.`);
    }

    a.dataUrl = `data:${declaredMime};base64,${buf.toString("base64")}`;
    a.fileType = declaredMime;
    a.fileName = safeFileName(name);
  }
}

// Una foto suelta: valida y devuelve la versión normalizada, conservando la forma que traía
// ({name,url} en el móvil y el intake, cadena suelta en algún registro antiguo).
function normalizePhoto(p, already, contexto) {
  const raw = typeof p === "string" ? p : p && p.url;
  if (already.has(raw)) return p;

  const m = PHOTO_URL_RE.exec(String(raw || ""));
  if (!m) throw new Error(`${contexto} is not a valid image data URL (JPEG, PNG, WebP, GIF or HEIC).`);
  const bytes = Buffer.from(m[2], "base64");
  if (bytes.length === 0 || bytes.length > MAX_PHOTO_BYTES) {
    throw new Error(`${contexto} is empty or exceeds the 5MB limit.`);
  }
  const url = `data:${m[1].toLowerCase()};base64,${bytes.toString("base64")}`;
  return typeof p === "string" ? url : { ...p, name: safeFileName(p && p.name), url };
}

// Fotos del intake. Llegan por una ruta SIN sesión: quien tiene el enlace es, por diseño, un
// anónimo. Antes no había nada — ni tipo, ni tamaño, ni cuántas— y el objeto entraba entero en
// una columna JSONB, así que bastaba repetir peticiones grandes para llenar la base.
function validateIntakePhotos(photos, existing = {}) {
  if (photos === undefined) return {};
  if (!photos || typeof photos !== "object" || Array.isArray(photos)) {
    throw new Error("intakePhotos must be an object.");
  }

  const already = storedUrls(existing);
  const clean = {};

  for (const [category, list] of Object.entries(photos)) {
    // Una categoría desconocida se descarta en silencio en vez de rechazar el envío entero: el
    // cliente ya rellenó el formulario y no tiene por qué perderlo por un campo de más.
    if (!INTAKE_CATEGORIES.includes(category)) continue;
    if (!Array.isArray(list)) throw new Error(`intakePhotos.${category} must be an array.`);
    if (list.length > MAX_PHOTOS_PER_CATEGORY) {
      throw new Error(`Too many photos for ${category} — the limit is ${MAX_PHOTOS_PER_CATEGORY}.`);
    }
    clean[category] = list.map((p) => normalizePhoto(p, already, `A photo in ${category}`));
  }
  return clean;
}

// Fotos del técnico. Llegan por el enlace móvil (sin sesión) y también por PUT /workorders/:id
// desde TechnicianWorkOrderView, así que las dos rutas pasan por aquí.
function validateTechPhotos(photos, existing = []) {
  if (!Array.isArray(photos)) throw new Error("techPhotos must be an array.");
  if (photos.length > MAX_TECH_PHOTOS) {
    throw new Error(`Too many photos — the limit is ${MAX_TECH_PHOTOS}.`);
  }
  const already = storedUrls(existing);
  return photos.map((p) => normalizePhoto(p, already, "A photo"));
}

module.exports = {
  validateInsuranceAttachments,
  validateIntakePhotos,
  validateTechPhotos,
  safeFileName,
  // Exportadas para las pruebas y para que los límites tengan un solo sitio donde cambiarse.
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENTS,
  ALLOWED_ATTACHMENT_TYPES,
  MAX_PHOTOS_PER_CATEGORY,
  MAX_TECH_PHOTOS,
  INTAKE_CATEGORIES,
};
