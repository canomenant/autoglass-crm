# Auditoría de Ciberseguridad — AutoGlass CRM

**Fecha:** 2026-08-25 · **Commit auditado:** `58dc90c` (rama `main`)
**Alcance:** `backend/src/**` (Express 4 + PostgreSQL), `frontend/src/**` (Next.js 14 App Router), `docker-compose.yml`, dependencias e historial de Git.
**Marcos aplicados:** OWASP Top 10 (2021), CWE/SANS Top 25, Zero Trust / Mínimo Privilegio, GDPR Art. 5/25/32.

---

> ## Estado de remediación — 2026-08-25
>
> **23 de 26 hallazgos corregidos.** Segunda pasada completada: revisión ruta por ruta de los 44
> ficheros de rutas (la primera cubría 12 a fondo), que destapó **dos hallazgos nuevos**, #25 y
> #26, ya corregidos. Todo verificado contra la API en marcha y fijado con **63 pruebas de
> regresión** (`npm run test:security`, sin servidor ni base de datos). Con el segundo factor
> implementado (#23), la suite son **95 pruebas**.
>
> **#10 cerrado del todo.** Ya no queda con la validación desactivada: se fija la CA propia de
> Railway (`backend/certs/railway-root-ca.pem`, CN=root-ca, caduca oct 2028) y se valida contra
> ella. Comprobado que una CA distinta se rechaza y que un CN inesperado se rechaza. La hoja del
> proxy lleva CN=localhost, así que la comprobación de nombre se sustituye por la verificación de
> ese CN concreto — está documentado en `db.js`.
>
> Lo que sigue abierto:
>
> | # | Hallazgo | Por qué sigue abierto |
> |---|---|---|
> | 3 | PII en el historial de Git | Reescribir el historial es destructivo e irreversible y obliga a rehacer todos los clones. **Decisión del propietario.** Los comandos están en su sección. |
> | 11 | `next` / `postcss` | Triado: de los 21 avisos de Next, **la mayoría no aplican** — no hay Server Actions, ni rewrites, ni `remotePatterns` en `next/image`, ni nonces de CSP, y el bypass de middleware por i18n es de Pages Router (aquí es App Router). CVE-2025-29927 ya está parcheado en 14.2.25. El arreglo formal es Next 16 (dos versiones mayores): mantenimiento planificado, no urgencia. `nanoid` y `brace-expansion` **sí** corregidos. `xlsx` no tiene parche — contenido con `Object.freeze(Object.prototype)` en los 10 scripts de importación. |
> | 20 | JWT en `localStorage` | Migrar a cookie `HttpOnly` exige además protección CSRF. Mitigado por #2 y por la CSP de #9. |
> | 24 | `forgot-password` inoperante | Requiere infraestructura de correo, que la aplicación no tiene (sus notificaciones se **registran**, no se envían). |
>
> ### #23 — Segundo factor (MFA): IMPLEMENTADO
>
> TOTP (RFC 6238) para cuentas de administrador, opcional y por cuenta. **No cambia nada para
> quien no lo active**: el login de las demás cuentas sigue igual.
>
> Implementado con `node:crypto`, **sin añadir dependencias** — el algoritmo son cuarenta líneas
> de HMAC y truncamiento, y a cambio es comprobable: `tests/totp.test.js` lo verifica contra los
> seis vectores de prueba publicados en el RFC 6238, así que genera exactamente los mismos códigos
> que cualquier implementación conforme. La cadena de suministro es uno de los riesgos que este
> mismo informe señala (#11), y el arranque de sesión no es el sitio para añadir superficie.
>
> Decisiones de diseño que importan:
>
> - **El reto intermedio no es una sesión.** Entre "la contraseña es correcta" y "el código es
>   correcto" hace falta llevar estado; se hace con un token de 5 minutos marcado con
>   `purpose: "mfa-challenge"`, y `requireAuth` rechaza cualquier token que lleve `purpose`. Sin
>   eso, saltarse el segundo factor consistiría en usar el reto tal cual contra cualquier
>   endpoint — el fallo clásico de este flujo. Verificado: el reto da 401 en `/workorders`,
>   `/customers`, `/reports/sales`, `/users` y `/auth/mfa/status`.
> - **El secreto va cifrado en reposo** (AES-256-GCM, `MFA_ENCRYPTION_KEY`, deliberadamente
>   separada de `JWT_SECRET` para que rotar el secreto de sesión no expulse a todos de su propio
>   segundo factor). Un volcado de la base —o el historial de Git, que ya pasó con los clientes—
>   no entrega las semillas. GCM además detecta la manipulación.
> - **Un código vale una vez.** Se guarda la ventana TOTP consumida y se rechaza repetirla: sin
>   eso, un código visto de reojo o interceptado sigue siendo aritmética válida durante 90
>   segundos, y el segundo factor deja de ser "algo que sólo tiene el dueño del teléfono".
> - **Ocho códigos de recuperación**, con bcrypt y de un solo uso. Sin ellos, perder el teléfono
>   sería perder la cuenta de administrador, y la salida acabaría siendo un backdoor permanente.
>   Alfabeto sin `0/O/1/I/L`: se copian a mano y transcribir mal aquí cuesta la cuenta.
> - **Desactivar exige contraseña *y* código**, no sólo la sesión: con sólo la sesión, una robada
>   apagaría el segundo factor.
> - `/auth/mfa/verify` va bajo el limitador de login — seis dígitos son un millón de
>   combinaciones y sin límite se agotan en minutos.
>
> Probado de extremo a extremo contra la API con un usuario temporal creado y borrado (la tabla
> quedó como estaba, sin rastro): alta → activación → login con reto → verificación → repetición
> rechazada → código de recuperación de un solo uso (8→7) → baja con contraseña y código → login
> normal otra vez.
>
> **Pendiente de operación:** `MFA_ENCRYPTION_KEY` ya está en el `.env` local; hay que ponerla
> también en Railway antes de desplegar, o `/auth/mfa/setup` responderá 503 (falla cerrado, no
> guarda secretos en claro). Sólo se ofrece a cuentas `ADMIN` de `users.store`; agentes y técnicos
> quedan fuera por ahora — los técnicos trabajan desde el móvil en la calle y ahí la fricción es
> alta y el valor bajo.
>
> **Acciones operativas ya hechas:** `JWT_SECRET` sustituido por 48 bytes aleatorios (invalida
> todas las sesiones abiertas); columna `technicians.token_version` creada; CA de Railway fijada;
> hook de pre-commit instalado en `.git/hooks/pre-commit` que bloquea `.env` y
> `backend/data/*.json`.
>
> **Acción operativa pendiente:** rotar la contraseña de Postgres — se ha transmitido en claro
> en cada conexión hasta que se activó TLS.
>
> ### Hallazgos de la segunda pasada
>
> **[ALTO] #25 — IDOR en `GET /api/payments/:id/bonus-items`.**
> [payments.routes.js:73](backend/src/routes/payments.routes.js:73) no comprobaba propiedad,
> mientras sus dos hermanas —`GET /:id` y `GET /:id/notes`— sí lo hacían. Con el montaje
> autorizando GET a `AGENT`, cualquier agente leía el desglose de bonos de cualquier lote,
> incluidos los de técnicos y los de otros agentes, iterando ids. **Corregido** con el mismo
> `ownsPayment` que usan las otras dos, devolviendo 404 en vez de 403. La prueba de regresión
> recorre *todas* las rutas GET de instancia de ese fichero y exige que cada una compruebe
> propiedad o exija ADMIN, para que la próxima que se añada no repita el olvido.
>
> **[MEDIO] #26 — Datos bancarios y comerciales visibles a cualquier agente.**
> `GET /api/distributors` devolvía la ficha completa a `AGENT`, con `accountNumber` (número de
> cuenta bancaria del proveedor), `taxId` y `paymentTerms`. `GET /api/partner-companies` devolvía
> `leadPrice`, que es lo que la empresa paga por cada lead. Mismo patrón que #13. **Corregido**
> con proyecciones por rol; verificado que el formulario de cotización conserva lo que usa
> (`id` + `name`, `id` + `companyName`):
>
> | Recurso | ADMIN | No-ADMIN | Descartado |
> |---|---|---|---|
> | `distributors` | 22 campos | 8 | `accountNumber`, `taxId`, `paymentTerms`, `notes` |
> | `partnerCompanies` | completo | 4 | `leadPrice`, `notes`, `phone`, `email` |
> | `agents` (#13) | completo | 4 | `taxId`, `address`, `commissionRate`, `commissionsPaid` |
>
> ### Refactorización de apoyo
>
> La validación de medios estaba duplicada en `quotes.store.js` y `workorders.store.js` — dos
> copias de una regla de seguridad divergen. Ahora vive en
> [mediaValidation.js](backend/src/lib/mediaValidation.js), sin dependencia de la base de datos,
> que es lo que permite probarla sin Postgres.


> ### Regresiones encontradas al probar en el navegador
>
> Reportadas por el equipo mientras usaba la aplicación, reproducidas en el navegador y corregidas
> antes de desplegar.
>
> **[BLOQUEANTE] La CSP del hallazgo #9 rompía el autocompletado de direcciones.** Introducida por
> esta misma auditoría. `connect-src` autorizaba `maps.googleapis.com` pero no
> `places.googleapis.com`: el widget de direcciones carga su script desde el primero y pide las
> sugerencias al segundo, que es **otro host**. El campo se veía normal y no sugería nada, en
> silencio.
>
> Confirmado en el navegador con el evento `securitypolicyviolation`
> (`https://places.googleapis.com/... viola connect-src`), no deducido. Tras el arreglo devuelve
> 5 sugerencias y cero violaciones. Fijado con pruebas que exigen que la CSP siga permitiendo lo
> que la aplicación necesita — `data:`/`blob:` en `img-src`, `blob:` en `frame-src` para el visor
> de PDF, y ambos hosts de Google — sin aflojar `frame-ancestors`, `object-src` ni `base-uri`.
> Endurecer no puede salir gratis a costa de romper una pantalla.
>
> **[USABILIDAD] No se podía buscar un cliente existente.** El selector era un `<select>` plano
> con 4.353 opciones: había que encontrar a la persona desplazando la lista, sin poder teclear un
> nombre. Sustituido por `SearchableSelect`, el mismo control que ese formulario ya usa para
> agentes, códigos postales y números de pieza (busca desde 2 caracteres y ordena por calidad de
> coincidencia). Se le añadió teléfono y correo al texto buscable, que es como se localiza a
> alguien en un taller. Verificado en el navegador: teléfono completo, teléfono parcial, correo y
> apellido devuelven el cliente correcto.
>
> **Aviso de despliegue:** `NEXT_PUBLIC_API_URL` se congela en tiempo de **build** y entra en la
> `connect-src` de la CSP. Si Railway compila sin esa variable, la política publicada llevará
> `http://localhost:4000` y el navegador bloqueará las llamadas a la API real.

## Resumen ejecutivo

| Nivel | Nº | Hallazgos |
|---|---|---|
| **CRÍTICO** | 3 | Secreto JWT trivial · XSS almacenado → robo de sesión · PII de clientes en el historial de Git |
| **ALTO** | 8 | Sin rate limiting · CORS abierto · Fuga de datos en link móvil público · IDOR en notificaciones · Suplantación del actor de auditoría · Sin cabeceras de seguridad · Postgres sin TLS · Dependencias vulnerables |
| **MEDIO** | 8 | IDOR en table-views · Fuga de `taxId` de agentes · Clientes visibles a técnicos · DoS por payload de 25 MB · Reportes financieros a agentes · Fuga de errores internos · Enumeración de cuentas · Sesión no invalidada |
| **BAJO** | 5 | JWT en `localStorage` · IP de auditoría falsificable · Break-glass sin comparación constante · Sin MFA · `forgot-password` inoperante |

**Riesgo global: CRÍTICO.** El hallazgo #1 por sí solo permite a cualquier persona en Internet emitir un token de administrador válido y tomar control total de la aplicación. Debe corregirse antes que nada.

**Orden de remediación:** #1 → #2 → #3 → #4 → #6 → #5/#9 → resto.

---

# CRÍTICO

## [CRÍTICO] 1 — Secreto JWT predecible (`changeme`): falsificación de tokens de administrador

**CWE-798** (Credenciales embebidas) · **CWE-330** (Aleatoriedad insuficiente) · **OWASP A02:2021 / A07:2021**

**Archivo y línea:** [backend/.env:2](backend/.env:2), consumido en [backend/src/middleware/auth.js:8](backend/src/middleware/auth.js:8) y [backend/src/routes/auth.routes.js:17](backend/src/routes/auth.routes.js:17). El mismo valor está publicado en [backend/.env.example:2](backend/.env.example:2), que **sí está en el repositorio**.

### Vector de ataque

`JWT_SECRET=changeme`. El atacante no necesita ni adivinarlo: lo lee del `.env.example` versionado en Git. Con él firma su propio token:

```js
jwt.sign({ id:"user-1", email:"x@x", name:"Admin", role:"ADMIN", entityId:1 }, "changeme", { expiresIn:"8h" })
```

Ese token pasa `jwt.verify` en `auth.js:8` y `requireRole("ADMIN")` en `auth.js:17`. A partir de ahí el atacante es administrador: `/api/reports` (P&L completo), `/api/customers` (toda la PII), `/api/payable`, `/api/users`, `/api/agents` (incluye `taxId`), y `DELETE` sobre cualquier recurso. **Sin login, sin contraseña, sin dejar rastro en ningún registro de acceso fallido.** Toda la superficie de autenticación y autorización queda anulada.

Agravante: `auth.js:8` no fija algoritmo. Si el secreto se sustituyera por una clave pública (RS256), un token con `alg: HS256` firmado con esa clave pública seguiría validando — la confusión de algoritmo clásica.

### Código actual vulnerable

```bash
# backend/.env  y  backend/.env.example
JWT_SECRET=changeme
```
```js
// backend/src/middleware/auth.js:7-12
try {
  req.user = jwt.verify(token, process.env.JWT_SECRET);
  next();
} catch {
  res.status(401).json({ error: "Unauthorized" });
}
```

### Refactorización segura

**a) Generar un secreto real** (256 bits) y cargarlo en Railway, nunca en un fichero versionado:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

**b) Arrancar en fallo si el secreto es débil o falta.** Nuevo `backend/src/config/secrets.js`:

```js
// Un secreto débil no es un aviso, es una brecha: cualquiera puede firmar un token ADMIN.
// El proceso no debe llegar a escuchar en un puerto sin uno real.
const WEAK = new Set(["changeme", "secret", "jwtsecret", "dev", "test", "password"]);

function requireJwtSecret() {
  const s = process.env.JWT_SECRET;
  if (!s || s.length < 32 || WEAK.has(s.toLowerCase())) {
    throw new Error(
      "JWT_SECRET ausente o débil. Genere uno con: " +
      "node -e \"console.log(require('crypto').randomBytes(48).toString('base64url'))\""
    );
  }
  return s;
}

module.exports = { JWT_SECRET: requireJwtSecret() };
```

**c) Fijar el algoritmo en ambos extremos** — emisión y verificación:

```js
// backend/src/middleware/auth.js
const jwt = require("jsonwebtoken");
const { JWT_SECRET } = require("../config/secrets");

const VERIFY_OPTS = { algorithms: ["HS256"], issuer: "autoglass-crm", maxAge: "8h" };

function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Unauthorized" });
  try {
    req.user = jwt.verify(token, JWT_SECRET, VERIFY_OPTS);
    next();
  } catch {
    res.status(401).json({ error: "Unauthorized" });
  }
}
```
```js
// backend/src/routes/auth.routes.js:16-19
const { JWT_SECRET } = require("../config/secrets");

function issueToken(res, payload) {
  const token = jwt.sign(payload, JWT_SECRET, {
    algorithm: "HS256",
    issuer: "autoglass-crm",
    expiresIn: "8h",
  });
  res.json({ token, user: payload });
}
```

**d) Vaciar el placeholder del ejemplo** para que nadie lo copie a producción:

```bash
# backend/.env.example
# Obligatorio. Mínimo 32 caracteres, generado al azar. El arranque falla si es débil.
# node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
JWT_SECRET=
```

> Rotar el secreto invalida todas las sesiones activas. Es el efecto deseado: cualquier token emitido con `changeme` debe dejar de valer.

---

## [CRÍTICO] 2 — XSS almacenado por confusión de MIME en adjuntos → robo de sesión

**CWE-79** (XSS) · **CWE-434** (Subida de fichero peligroso) · **OWASP A03:2021**

**Archivos y líneas:**
- Validación insuficiente: [backend/src/store/quotes.store.js:15-27](backend/src/store/quotes.store.js:15)
- Explotación: [frontend/src/components/QuoteForm.js:144-153](frontend/src/components/QuoteForm.js:144) y [frontend/src/components/QuoteForm.js:445-449](frontend/src/components/QuoteForm.js:445)

### Vector de ataque

El backend valida el campo **declarado por el cliente** `a.fileType` contra una lista blanca, pero nunca comprueba que el prefijo MIME del `dataUrl` coincida:

```js
// quotes.store.js:18
if (!ALLOWED_ATTACHMENT_TYPES.includes(a.fileType)) { ... }   // ← sólo mira fileType
const dataUrl = String(a.dataUrl || "");                       // ← el MIME real nunca se comprueba
```

En el frontend, `dataUrlToBlob()` extrae el MIME **del `dataUrl`**, no del `fileType` validado:

```js
// QuoteForm.js:148-149
const mimeMatch = header.match(/data:(.*?);base64/);
const mime = mimeMatch ? mimeMatch[1] : "application/octet-stream";
```

y el modal decide cómo renderizar mirando otra vez `fileType`:

```js
// QuoteForm.js:433, 445-449
const isImage = attachment.fileType !== "application/pdf";
...
) : ( <iframe src={blobUrl} ... /> )
```

Un agente (o cualquiera con el token robado de un agente) envía por API:

```json
{ "insuranceAttachments": [{
    "fileName": "claim.pdf",
    "fileType": "application/pdf",
    "dataUrl": "data:text/html;base64,PHNjcmlwdD5mZXRjaCgnaHR0cHM6Ly9ldmlsL3g/dD0nK2xvY2FsU3RvcmFnZS50b2tlbik8L3NjcmlwdD4="
}] }
```

`fileType` pasa la lista blanca → `isImage === false` → se abre un `<iframe src="blob:https://app/...">` cuyo Blob tiene tipo `text/html`. **Un `blob:` hereda el origen de quien lo creó**, así que el HTML se ejecuta con el origen de la aplicación. En cuanto un **administrador** abre esa cotización para revisar el siniestro, el script lee `localStorage.getItem("token")` (hallazgo #20) y lo exfiltra. Escalada vertical AGENT → ADMIN, persistente y disparada por la víctima.

La ausencia de CSP (hallazgo #9) elimina la única barrera que habría frenado el `fetch()` saliente.

### Código actual vulnerable

```js
// backend/src/store/quotes.store.js:15-27
function validateInsuranceAttachments(attachments) {
  if (!Array.isArray(attachments)) return;
  for (const a of attachments) {
    if (!ALLOWED_ATTACHMENT_TYPES.includes(a.fileType)) {
      throw new Error(`Attachment "${a.fileName || ""}" has an unsupported file type...`);
    }
    const dataUrl = String(a.dataUrl || "");
    const base64Body = dataUrl.slice(dataUrl.indexOf(",") + 1);
    const approxBytes = (base64Body.length * 3) / 4;
    if (approxBytes > MAX_ATTACHMENT_BYTES) { throw new Error(...); }
  }
}
```

### Refactorización segura

**a) Backend — el `dataUrl` manda, y su contenido se comprueba por *magic bytes*:**

```js
// backend/src/store/quotes.store.js
const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;
const MAX_ATTACHMENTS = 10;
const ALLOWED_ATTACHMENT_TYPES = ["application/pdf", "image/jpeg", "image/png"];

// La firma real del fichero, no lo que el cliente dice que es. `fileType` y el prefijo del
// dataUrl los escribe el navegador y ambos son editables desde una llamada directa a la API;
// estos bytes son el propio contenido.
const MAGIC = {
  "application/pdf": (b) => b.slice(0, 5).toString("latin1") === "%PDF-",
  "image/png":       (b) => b.slice(0, 8).equals(Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a])),
  "image/jpeg":      (b) => b[0] === 0xff && b[1] === 0xd8 && b[b.length - 2] === 0xff && b[b.length - 1] === 0xd9,
};

const DATA_URL_RE = /^data:([a-z]+\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/=]+)$/i;

function validateInsuranceAttachments(attachments) {
  if (attachments === undefined) return;
  if (!Array.isArray(attachments)) throw new Error("insuranceAttachments must be an array.");
  if (attachments.length > MAX_ATTACHMENTS) {
    throw new Error(`Too many attachments — the limit is ${MAX_ATTACHMENTS}.`);
  }

  for (const a of attachments) {
    const name = String(a?.fileName || "");
    const m = DATA_URL_RE.exec(String(a?.dataUrl || ""));
    if (!m) throw new Error(`Attachment "${name}" is not a valid base64 data URL.`);

    const [, declaredMime, base64Body] = m;

    // El MIME del dataUrl y el fileType deben coincidir Y estar en la lista blanca. Divergir
    // es exactamente lo que permitía guardar un text/html bajo la etiqueta application/pdf.
    if (!ALLOWED_ATTACHMENT_TYPES.includes(declaredMime) || declaredMime !== a.fileType) {
      throw new Error(`Attachment "${name}" has an unsupported file type — only PDF, JPG, and PNG are allowed.`);
    }

    let buf;
    try { buf = Buffer.from(base64Body, "base64"); }
    catch { throw new Error(`Attachment "${name}" is not valid base64.`); }

    if (buf.length === 0) throw new Error(`Attachment "${name}" is empty.`);
    if (buf.length > MAX_ATTACHMENT_BYTES) {
      throw new Error(`Attachment "${name}" is too large — the limit is 5MB per file.`);
    }
    if (!MAGIC[declaredMime](buf)) {
      throw new Error(`Attachment "${name}" does not match its declared type.`);
    }

    // Se normaliza: lo que se persiste es el dataUrl reconstruido a partir del MIME validado,
    // así el frontend no puede volver a leer un tipo distinto del que se comprobó.
    a.dataUrl = `data:${declaredMime};base64,${buf.toString("base64")}`;
    a.fileType = declaredMime;
    a.fileName = name.replace(/[\r\n\\/]/g, "_").slice(0, 200);
  }
}
```

**b) Frontend — el Blob se construye con el MIME validado, y el visor se aísla:**

```js
// frontend/src/components/QuoteForm.js
// El MIME viene del fileType que el servidor validó contra los magic bytes, NO del encabezado
// del dataUrl: ese encabezado lo elige quien envía el adjunto, y un text/html ahí se ejecutaba
// con nuestro origen al abrirlo como blob: en un <iframe>.
const RENDERABLE_MIMES = new Set(["application/pdf", "image/jpeg", "image/png"]);

function dataUrlToBlob(dataUrl, validatedMime) {
  const mime = RENDERABLE_MIMES.has(validatedMime) ? validatedMime : "application/octet-stream";
  const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}
```
```js
// llamadas actualizadas
const blobUrl = URL.createObjectURL(dataUrlToBlob(a.dataUrl, a.fileType));                   // downloadAttachment
const url     = URL.createObjectURL(dataUrlToBlob(attachment.dataUrl, attachment.fileType)); // modal
```
```jsx
{/* AttachmentThumbnail: no usar el dataUrl crudo como src */}
<img src={blobUrl} alt={attachment.fileName} ... />
```
```jsx
{/* AttachmentPreviewModal — sandbox: aunque algo se colara, no ejecuta scripts ni sale del marco */}
<iframe
  src={blobUrl}
  title={attachment.fileName}
  sandbox=""
  referrerPolicy="no-referrer"
  className="w-full h-[80vh] border-0"
/>
```

**c) Y aplicar la CSP del hallazgo #9**, que corta la exfiltración aunque el script llegue a ejecutarse.

---

## [CRÍTICO] 3 — PII completa de clientes reales en el historial de Git

**CWE-359** (Exposición de información privada) · **OWASP A01/A02:2021** · **GDPR Art. 5(1)(f), 32**

**Archivo:** `backend/data/customers.json`, añadido en el commit `364ed40` ("Initial commit"). Actualmente ignorado por [backend/.gitignore:4](backend/.gitignore:4), pero **sigue presente en el historial**.

### Vector de ataque

`.gitignore` no borra nada del pasado. `git show 364ed40:backend/data/customers.json` devuelve 147 KB de datos personales de clientes reales:

```json
{ "firstName": "John", "lastName": "Lukic", "phone": "5122135055",
  "email": "johnlukic@yahoo.com", "address": "311 Jarbridge Dr Kyle, TX",
  "vehicle": { "year": "2016", "make": "Honda", "model": "CR-V" } }
```

Cualquiera que clone el repositorio —un contratista, un empleado que se va, un fork accidentalmente público, una integración CI con permiso de lectura— obtiene nombre, teléfono, correo, **domicilio particular** y vehículo de toda la cartera. Es material directo para *phishing* dirigido, ingeniería social contra la aseguradora y localización física de personas. El mismo historial contiene `agents.json`, `technicians.json`, `payments.json`, `expenses.json` e `invoices.json`.

Bajo GDPR/CCPA esto constituye una brecha notificable si el repositorio ha sido accesible a terceros. También rompe el derecho de supresión (Art. 17): un cliente borrado de la base sigue en el historial.

### Refactorización segura

**1. Determinar la exposición antes de reescribir nada:**

```bash
git log --all --oneline -- backend/data/customers.json
git remote -v   # ¿existe un remoto? ¿es privado? ¿quién tiene acceso de lectura?
```

**2. Purgar los blobs del historial** con `git-filter-repo` (la herramienta recomendada; `filter-branch` está desaconsejada):

```bash
pip install git-filter-repo
git clone --mirror . ../autoglass-crm-backup.git      # copia íntegra antes de tocar nada
git filter-repo --invert-paths --path backend/data/ --force
```

**3. Rotar todo lo que el historial haya expuesto:** contraseñas de agentes y técnicos (ya rotadas en `efdc47c`), `JWT_SECRET` (hallazgo #1) y las credenciales de Postgres.

**4. Forzar la reescritura en el remoto y hacer que todos los clones se rehagan desde cero.** Los clones antiguos conservan los objetos; deben eliminarse, no actualizarse.

**5. Prevención.** Hook de pre-commit:

```bash
# .git/hooks/pre-commit
#!/bin/sh
if git diff --cached --name-only | grep -qE '(^|/)(\.env$|data/.*\.json$)'; then
  echo "BLOQUEADO: no se versionan .env ni backend/data/*.json (contienen PII y credenciales)."
  exit 1
fi
```

**6. Documentar la evaluación de impacto.** Si el repositorio fue accesible fuera del equipo, valorar la notificación a la autoridad de control en 72 h (GDPR Art. 33).

> **Nota positiva:** `backend/.env` **nunca** se ha versionado — verificado sobre todo el historial. La higiene actual de `.gitignore` es correcta y meticulosa; el problema es exclusivamente retrospectivo.

---

# ALTO

## [ALTO] 4 — Sin rate limiting: fuerza bruta sobre el login y abuso de endpoints públicos

**CWE-307** (Intentos de autenticación sin restricción) · **CWE-770** · **OWASP A07:2021**

**Archivo y línea:** [backend/src/index.js:58-63](backend/src/index.js:58) — no existe ningún limitador en toda la aplicación (verificado: cero coincidencias de `rate-limit` en `src/` y en `package.json`).

### Vector de ataque

`POST /api/auth/login` acepta intentos ilimitados. El atacante recorre la lista de correos de agentes y técnicos —obtenible del propio historial de Git, hallazgo #3— con un diccionario, sin bloqueo, sin retardo y sin registro. `bcrypt` con coste 12 (~250 ms) frena algo, pero también convierte cada petición en 250 ms de CPU: **200 peticiones concurrentes saturan el bucle de eventos y tumban la API** — el mismo endpoint sirve para credential stuffing y para denegación de servicio.

Los endpoints públicos amplifican el problema:
- `POST /api/checkout/create-checkout-session` ([checkout.routes.js:7](backend/src/routes/checkout.routes.js:7)) → crea sesiones de Stripe sin límite (coste económico + rate limit de Stripe).
- `GET /api/intake/:token/vin-decode/:vin` ([intake.routes.js:52](backend/src/routes/intake.routes.js:52)) → proxy libre hacia la API del NHTSA; convierte el servidor en amplificador y arriesga el bloqueo de la IP saliente.
- `GET /api/payout-statement/:token` y `GET /api/workorders/mobile/:token` → fuerza bruta sobre tokens de 80 bits (inviable), pero cada intento consume una consulta a Postgres.

### Código actual vulnerable

```js
// backend/src/index.js:58-63
app.use(cors());
app.post("/api/checkout/webhook", express.raw({ type: "application/json" }), stripeWebhook);
app.use(express.json({ limit: "25mb" }));
// ... ningún limitador en ninguna capa
app.use("/api/auth", authRoutes);
```

### Refactorización segura

```bash
npm install express-rate-limit --prefix backend
```

```js
// backend/src/middleware/rateLimit.js
const rateLimit = require("express-rate-limit");

const base = {
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests. Please try again later." },
};

// Login: por IP y por cuenta. Sólo por IP, una botnet rota direcciones; sólo por cuenta,
// un atacante bloquea a un usuario legítimo a voluntad. Los dos juntos cubren ambos casos.
const loginLimiter = rateLimit({
  ...base,
  windowMs: 15 * 60 * 1000,
  limit: 10,
  skipSuccessfulRequests: true,
  keyGenerator: (req) => `${req.ip}|${String(req.body?.email || "").toLowerCase()}`,
});

// Endpoints públicos sin sesión: intake, link móvil, comprobante, checkout.
const publicLimiter = rateLimit({ ...base, windowMs: 15 * 60 * 1000, limit: 60 });

// Cinturón general para toda la API autenticada.
const apiLimiter = rateLimit({ ...base, windowMs: 60 * 1000, limit: 300 });

module.exports = { loginLimiter, publicLimiter, apiLimiter };
```

```js
// backend/src/index.js
const { loginLimiter, publicLimiter, apiLimiter } = require("./middleware/rateLimit");

// Detrás del proxy de Railway la IP real llega en X-Forwarded-For. Un solo salto de proxy:
// NO usar `true`, que permitiría falsificar la IP añadiendo una cabecera propia y saltarse
// el limitador entero.
app.set("trust proxy", 1);

app.use("/api", apiLimiter);
app.use("/api/auth/login", loginLimiter);
app.use("/api/auth/forgot-password", loginLimiter);
app.use("/api/intake", publicLimiter);
app.use("/api/checkout", publicLimiter);
app.use("/api/payout-statement", publicLimiter);
app.use("/api/workorders/mobile", publicLimiter);
```

**Mitigación adicional:** bloqueo temporal de cuenta tras N fallos consecutivos (`failed_login_count` + `locked_until`), y alerta ante un pico de 401 en `/api/auth/login`.

---

## [ALTO] 5 — CORS permisivo: cualquier origen puede consumir la API

**CWE-942** (Lista blanca de orígenes excesivamente permisiva) · **OWASP A05:2021**

**Archivo y línea:** [backend/src/index.js:60](backend/src/index.js:60)

### Vector de ataque

`cors()` sin opciones responde `Access-Control-Allow-Origin: *` a **toda** petición. Como la sesión viaja en la cabecera `Authorization` y no en cookie, esto no es CSRF clásico — pero sí significa que:

1. Cualquier página web puede leer libremente las respuestas de los endpoints públicos (`/api/intake/:token`, `/api/workorders/mobile/:token`, `/api/payout-statement/:token`). Basta con que un sitio malicioso conozca ese token —del historial del navegador, del *referer* (hallazgo #9), o de un SMS reenviado— para leer los datos íntegros del cliente desde el navegador de cualquier visitante.
2. Elimina la defensa en profundidad ante el XSS del hallazgo #2.
3. Si la sesión se mueve a cookies (recomendable, hallazgo #20), esta configuración se convierte de inmediato en CSRF total.

### Código actual vulnerable

```js
// backend/src/index.js:60
app.use(cors());
```

### Refactorización segura

```js
// backend/src/index.js
// Lista blanca explícita. `FRONTEND_URL` ya existe en el entorno (lo usa checkout.routes.js
// para las URL de retorno de Stripe), así que es la misma fuente de verdad.
const ALLOWED_ORIGINS = (process.env.CORS_ORIGINS || process.env.FRONTEND_URL || "http://localhost:3000")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

app.use(
  cors({
    origin(origin, cb) {
      // Sin cabecera Origin = petición no-navegador (curl, webhook de Stripe, health check):
      // no hay política de mismo origen que aplicar, y bloquearla rompería el monitoreo.
      if (!origin) return cb(null, true);
      if (ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
      return cb(new Error("Origin not allowed by CORS"));
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    maxAge: 600,
  })
);
```

```bash
# backend/.env.example
# Orígenes autorizados, separados por coma. Sin comodines.
CORS_ORIGINS=https://crm.autoglass.example
```

---

## [ALTO] 6 — El link móvil público expone el token de pago, los costes internos y la póliza

**CWE-200** (Exposición de información sensible) · **CWE-213** · **OWASP A01:2021**

**Archivo y línea:** [backend/src/routes/workorders.routes.js:29-33](backend/src/routes/workorders.routes.js:29), que devuelve el objeto completo de [backend/src/lib/sqlMappers.js:205-266](backend/src/lib/sqlMappers.js:205).

### Vector de ataque

El endpoint público del técnico devuelve `mapWorkOrder(row)` **entero**. Ese objeto incluye:

| Campo | Por qué importa |
|---|---|
| `paymentToken` | **Es la credencial del link de pago del cliente.** Quien tenga el link móvil obtiene el link de pago y puede abrir sesiones de Stripe (`checkout.routes.js:9`). |
| `laborCost`, `glassCost`, `commission` | Márgenes y comisiones internas — el técnico ve lo que gana la empresa y el agente sobre su propio trabajo. |
| `internalNotes` | Notas explícitamente internas. |
| `policyNumber`, `claimNumber` | Datos de la aseguradora; suficientes para suplantar al cliente ante ella. |
| `phone`, `email`, `address`, `vehicle.vin` | PII del cliente. |
| `publicAccessLog` | El propio registro de auditoría, incluidas las IP de accesos anteriores. |

El link se envía **por SMS** y no caduca nunca (decisión documentada en `workorders.store.js:236`). Un SMS reenviado, un móvil perdido, una captura en un grupo de WhatsApp, o un técnico que ya no trabaja en la empresa: cualquiera de esos casos entrega todo lo anterior.

El contraste está en el mismo fichero: `GET /pay/:token` ([workorders.routes.js:52-61](backend/src/routes/workorders.routes.js:52)) **sí** proyecta sólo cuatro campos. La ruta móvil es la que se quedó sin ese filtro.

### Código actual vulnerable

```js
// backend/src/routes/workorders.routes.js:29-33
router.get("/mobile/:token", async (req, res) => {
  const workOrder = await store.getByToken(req.params.token);
  if (!workOrder) return res.status(404).json({ error: "Work order not found" });
  res.json(await withInsuranceName(workOrder));   // ← el objeto completo
});
```

### Refactorización segura

```js
// backend/src/routes/workorders.routes.js

// Lo que el técnico necesita para hacer el trabajo, y nada más. Es una lista blanca, no una
// lista negra: un campo nuevo en mapWorkOrder() no se filtra solo por haberse añadido.
// Deliberadamente fuera: paymentToken (es la credencial del link de pago del cliente),
// laborCost/glassCost/commission (márgenes internos), internalNotes, y publicAccessLog
// (el propio registro de auditoría, con las IP de accesos anteriores).
function projectForMobileLink(workOrder, insuranceCompanyName) {
  return {
    id: workOrder.id,
    workOrderNo: workOrder.workOrderNo,
    status: workOrder.status,
    customerName: workOrder.customerName,
    phone: workOrder.phone,
    address: workOrder.address,
    vehicle: workOrder.vehicle,
    jobType: workOrder.jobType,
    glassType: workOrder.glassType,
    partNumber: workOrder.partNumber,
    nagsDescription: workOrder.nagsDescription,
    appointmentDate: workOrder.appointmentDate,
    appointmentTime: workOrder.appointmentTime,
    appointmentDurationMinutes: workOrder.appointmentDurationMinutes,
    specialInstructions: workOrder.specialInstructions,
    techInstructions: workOrder.techInstructions,
    techPhotos: workOrder.techPhotos,
    insuranceCompanyName,
  };
}

router.get("/mobile/:token", async (req, res) => {
  const workOrder = await store.getByToken(req.params.token);
  if (!workOrder) return res.status(404).json({ error: "Work order not found" });
  const withName = await withInsuranceName(workOrder);
  res.json(projectForMobileLink(withName, withName.insuranceCompanyName));
});

router.put("/mobile/:token", async (req, res) => {
  const workOrder = await store.updateFromMobileLink(req.params.token, req.body);
  if (!workOrder) return res.status(404).json({ error: "Work order not found" });
  const withName = await withInsuranceName(workOrder);
  res.json(projectForMobileLink(withName, withName.insuranceCompanyName));
});
```

**Mitigaciones adicionales:**
- Añadir caducidad al token del link móvil (p. ej. 14 días desde la cita), manteniendo la revocación manual que ya existe.
- Restringir `status` a la lista de estados válidos en `updateFromMobileLink` — hoy acepta cualquier cadena:

```js
// backend/src/store/workorders.store.js — dentro de updateFromMobileLink
const MOBILE_ALLOWED_STATUSES = ["Assigned", "In Progress", "Completed", "On Hold"];
if (data.status !== undefined) {
  if (!MOBILE_ALLOWED_STATUSES.includes(data.status)) throw new Error("Invalid status");
  ...
}
```

---

## [ALTO] 7 — IDOR: cualquier técnico o agente lee las notificaciones de cualquier orden

**CWE-639** (BOLA/IDOR) · **OWASP A01:2021**

**Archivo y línea:** [backend/src/routes/workorders.routes.js:99-101](backend/src/routes/workorders.routes.js:99)

### Vector de ataque

La ruta comprueba el **rol** pero no la **propiedad**. Dos líneas más abajo, `GET /:id` sí llama a `ownsWorkOrder()`; ésta se lo saltó.

Un técnico autenticado itera `GET /api/workorders/1/notifications`, `/2/notifications`… El `id` no es secreto: aparece en las URL del panel, en las respuestas de la API y en el historial del navegador. Obtiene el histórico de notificaciones de **todas** las órdenes de la empresa: teléfonos de todos los técnicos (`recipient`), mensajes internos, y el mapa temporal de qué trabajo se asignó a quién y cuándo — inteligencia competitiva completa para alguien que se marcha.

### Código actual vulnerable

```js
// backend/src/routes/workorders.routes.js:99-101
router.get("/:id/notifications", requireAuth, requireRole("ADMIN", "AGENT", "TECHNICIAN"), async (req, res) => {
  res.json(await notificationsStore.list(req.params.id));   // ← sin comprobar propiedad
});
```

### Refactorización segura

```js
// backend/src/routes/workorders.routes.js
// El rol dice "puede existir una orden que le pertenezca"; la propiedad dice "ésta es".
// GET /:id ya hacía las dos comprobaciones — ésta se había quedado con la primera sola.
router.get("/:id/notifications", requireAuth, requireRole("ADMIN", "AGENT", "TECHNICIAN"), async (req, res) => {
  const workOrder = await store.get(req.params.id);
  if (!workOrder) return res.status(404).json({ error: "Work order not found" });
  if (!(await ownsWorkOrder(req.user, workOrder))) {
    // 404 y no 403: un 403 confirma que la orden existe, que es justo lo que busca quien enumera.
    return res.status(404).json({ error: "Work order not found" });
  }
  res.json(await notificationsStore.list(req.params.id));
});
```

---

## [ALTO] 8 — Suplantación del actor de auditoría: `performedBy` lo elige el cliente

**CWE-778** (Registro insuficiente) · **CWE-807** (Decisión basada en entrada no confiable) · **OWASP A09:2021**

**Archivos y líneas:**
- Origen: [frontend/src/lib/api.js:250-253](frontend/src/lib/api.js:250)
- Consumo: [backend/src/routes/payments.routes.js:7-9](backend/src/routes/payments.routes.js:7), [backend/src/routes/invoices.routes.js:10-12](backend/src/routes/invoices.routes.js:10), [backend/src/routes/tableViews.routes.js:6-8](backend/src/routes/tableViews.routes.js:6)

### Vector de ataque

El nombre del actor que queda registrado en cada operación financiera viene del **cuerpo o la query de la petición**, no del token verificado:

```js
function actor(req) {
  return req.body?.performedBy || req.query?.performedBy || "System";
}
```

y el frontend lo toma de `localStorage`, que el usuario controla:

```js
function withActor(data) {
  const user = getCurrentUser();                 // localStorage.getItem("user")
  return { ...data, performedBy: user?.name || "System" };
}
```

Quien aprueba un lote de pagos fraudulento envía `{"performedBy": "Antonio Cano"}` y el registro acusa a otra persona. O `"System"`, y no acusa a nadie. Afecta a `approvePayment`, `payPayment`, `cancelPayment`, `voidInvoice`, `recordInvoicePayment` y a las notas de crédito/débito — precisamente las operaciones donde la trazabilidad *es* el control. Ante un fraude interno, los registros no prueban nada.

`req.user.name` ya está disponible en todas esas rutas (van tras `requireAuth`); simplemente no se usa.

### Refactorización segura

```js
// backend/src/lib/actor.js
// La identidad sale SIEMPRE del token verificado. `performedBy` en el cuerpo o la query lo
// escribe el cliente: sirve para firmar una aprobación de pago con el nombre de otro, que es
// exactamente lo que un registro de auditoría existe para impedir.
function actorFrom(req) {
  return req.user?.name || req.user?.email || "Unknown";
}

module.exports = { actorFrom };
```

```js
// payments.routes.js / invoices.routes.js / tableViews.routes.js
const { actorFrom: actor } = require("../lib/actor");
// (se elimina la función local `actor`; las llamadas `actor(req)` no cambian)
```

```js
// frontend/src/lib/api.js — el cliente deja de enviar el campo
// El servidor toma el actor del token; enviarlo desde aquí era, además de inútil, la vía
// para falsificarlo.
function withActor(data) {
  return data;
}
```

**Refuerzo** — rechazar el campo si llega, para detectar intentos:

```js
app.use("/api", (req, res, next) => {
  if (req.body && "performedBy" in req.body) {
    console.warn(`[audit] performedBy recibido del cliente en ${req.method} ${req.originalUrl} — ignorado`);
    delete req.body.performedBy;
  }
  next();
});
```

---

## [ALTO] 9 — Sin cabeceras de seguridad: sin CSP, sin HSTS, clickjacking posible

**CWE-1021** (Restricción inadecuada de marcos) · **CWE-693** · **OWASP A05:2021**

**Archivos:** [backend/src/index.js](backend/src/index.js) (sin `helmet`) y [frontend/next.config.js:6](frontend/next.config.js:6) (`nextConfig = {}`, sin `headers()`).

### Vector de ataque

Ni la API ni el frontend emiten una sola cabecera de seguridad:

- **Sin `Content-Security-Policy`:** el XSS del hallazgo #2 pasa de ejecución a exfiltración sin obstáculo. Un `connect-src 'self'` habría bloqueado el `fetch()` al dominio del atacante.
- **Sin `X-Frame-Options` / `frame-ancestors`:** el panel se puede embeber en un iframe invisible. *Clickjacking* sobre "Aprobar pago", "Eliminar orden de trabajo" o "Regenerar link móvil" — acciones de un clic con consecuencia financiera directa.
- **Sin `Strict-Transport-Security`:** quien escriba `crm.autoglass.example` sin `https://` hace la primera petición en claro. Un atacante en la misma Wi-Fi (taller, cafetería — el caso de uso de los técnicos en campo) hace *SSL stripping* y captura el JWT del `Authorization`.
- **Sin `X-Content-Type-Options: nosniff`:** el navegador puede reinterpretar el tipo de una respuesta, ampliando la superficie del hallazgo #2.
- **Sin `Referrer-Policy`:** las URL contienen tokens (`/intake/<token>`, `/work-orders/mobile/<token>`). Al pulsar cualquier enlace externo, el token completo viaja en la cabecera `Referer` hacia un tercero.

### Refactorización segura

**Backend:**

```bash
npm install helmet --prefix backend
```
```js
// backend/src/index.js
const helmet = require("helmet");

app.use(
  helmet({
    // La API sólo devuelve JSON: la CSP restrictiva no rompe nada aquí y frena que una
    // respuesta se renderice como documento.
    contentSecurityPolicy: {
      directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"], baseUri: ["'none'"] },
    },
    hsts: { maxAge: 63072000, includeSubDomains: true, preload: true },
    crossOriginResourcePolicy: { policy: "same-site" },
    referrerPolicy: { policy: "no-referrer" },
  })
);
app.disable("x-powered-by");   // deja de anunciar Express
```

**Frontend:**

```js
// frontend/next.config.js
const createNextIntlPlugin = require("next-intl/plugin");
const withNextIntl = createNextIntlPlugin("./src/i18n/request.js");

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";
const isDev = process.env.NODE_ENV !== "production";

// connect-src es la directiva que corta la exfiltración del XSS de adjuntos: aunque un script
// llegue a ejecutarse, no puede enviar el token a un dominio ajeno.
// blob: en img-src/frame-src es imprescindible: el visor de adjuntos renderiza blob: URLs.
const csp = [
  "default-src 'self'",
  `script-src 'self' ${isDev ? "'unsafe-eval'" : ""} 'unsafe-inline' https://maps.googleapis.com`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://maps.gstatic.com https://*.googleapis.com",
  "font-src 'self' data:",
  `connect-src 'self' ${API} https://maps.googleapis.com`,
  "frame-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "upgrade-insecure-requests",
].join("; ");

const nextConfig = {
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: csp },
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          // Las URL llevan tokens (/intake/<token>, /work-orders/mobile/<token>): sin esto
          // el token entero viaja en el Referer al pulsar cualquier enlace externo.
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=(self), payment=()" },
        ],
      },
    ];
  },
};

module.exports = withNextIntl(nextConfig);
```

> `script-src 'unsafe-inline'` es un compromiso: Next 14 inyecta scripts en línea y eliminarlo exige nonces vía middleware. Aun así, `connect-src`, `frame-ancestors` y `object-src 'none'` ya cortan la exfiltración y el clickjacking. `camera=(self)` se mantiene porque intake y la vista del técnico suben fotos desde el móvil.

---

## [ALTO] 10 — Conexión a PostgreSQL sin TLS a través de Internet público

**CWE-319** (Transmisión de datos sensibles en claro) · **OWASP A02:2021**

**Archivo y línea:** [backend/src/config/db.js:7-9](backend/src/config/db.js:7); cadena de conexión en [backend/.env:3](backend/.env:3).

### Vector de ataque

```js
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
```

`node-postgres` **no cifra por defecto**. La cadena apunta a `sakura.proxy.rlwy.net:11990` — un host público de Railway, alcanzado por Internet, no por una red privada. Sin `ssl` ni `sslmode=require`, el protocolo de conexión y todo el tráfico posterior viajan en claro: la contraseña de la base, las consultas y **todas las filas devueltas** (clientes, pagos, comisiones, adjuntos de siniestros en base64).

Cualquiera con visibilidad sobre el camino de red captura las credenciales de la base y a partir de ahí accede a todo directamente, sin pasar por la aplicación ni por ninguno de sus controles de acceso.

`docker-compose.yml:8` usa además la contraseña `autoglass_dev_password`, aceptable en local siempre que el puerto no se exponga a toda la red.

### Refactorización segura

```js
// backend/src/config/db.js
const { Pool, types } = require("pg");

types.setTypeParser(1700, (v) => (v === null ? null : parseFloat(v)));

const url = process.env.DATABASE_URL || "";
// Sólo se exime localhost: ahí el tráfico no sale de la máquina. Cualquier otro host implica
// atravesar la red, y node-postgres no cifra a menos que se le pida explícitamente — la
// contraseña y todas las filas viajarían en claro.
const isLocal = /@(localhost|127\.0\.0\.1|\[::1\])[:/]/.test(url);

const pool = new Pool({
  connectionString: url,
  ...(isLocal
    ? {}
    : {
        // rejectUnauthorized: true valida la cadena de certificación del servidor. Ponerlo en
        // false cifra pero no autentica: no impide un intermediario, sólo lo hace invisible.
        ssl: {
          rejectUnauthorized: true,
          ...(process.env.DATABASE_CA_CERT ? { ca: process.env.DATABASE_CA_CERT } : {}),
        },
      }),
  max: 20,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
});

pool.on("error", (err) => console.error("[pg] idle client error:", err.message));

module.exports = pool;
```

```bash
# backend/.env — añadir sslmode a la cadena
DATABASE_URL=postgresql://user:PASSWORD@sakura.proxy.rlwy.net:11990/railway?sslmode=require
```

```yaml
# docker-compose.yml — no exponer Postgres a toda la red local
    ports:
      - "127.0.0.1:5432:5432"
```

> **Acción operativa:** la contraseña de producción está en texto plano en `backend/.env`. El fichero nunca se ha versionado (verificado), pero reside en el disco de una estación de trabajo. Recomendado moverla a las variables de entorno de Railway, retirarla del `.env` local y **rotarla**, dado que se ha transmitido en claro en cada conexión hasta ahora.

---

## [ALTO] 11 — Dependencias con vulnerabilidades conocidas

**CWE-1395** (Dependencia de componente vulnerable) · **OWASP A06:2021**

**Archivos:** [frontend/package.json:9](frontend/package.json:9), [backend/package.json:31](backend/package.json:31)

### Vector de ataque

`npm audit` reporta 3 vulnerabilidades altas en el frontend y 2 en el backend:

| Paquete | Instalado | Severidad | Impacto |
|---|---|---|---|
| `next` | 14.2.35 | **Alta** | 21 avisos abiertos: XSS en App Router con nonces de CSP, SSRF en Server Actions y en *rewrites*, envenenamiento de caché de RSC, *request smuggling* en rewrites, múltiples DoS. |
| `postcss` | ≤8.5.22 (transitivo de `next`) | **Alta** | Lectura de ficheros arbitrarios vía `sourceMappingURL` controlado por el atacante; XSS por `</style>` sin escapar. |
| `nanoid` | <3.3.18 | **Alta** | Bucle infinito con `size = 0` (DoS). |
| `xlsx` | 0.18.5 | **Alta** | **Prototype Pollution** + ReDoS. **Sin versión corregida en npm.** |
| `brace-expansion` | 4.0.0–5.0.8 | **Alta** | DoS por expansión sin límite (OOM). |

`xlsx` es el más delicado: no tiene arreglo publicado en el registro npm y se usa en `import_xlsx.js` / `import_csv.js`. Un fichero manipulado puede contaminar `Object.prototype` y, desde ahí, alterar comprobaciones de autorización en el mismo proceso.

> Nota: CVE-2025-29927 (bypass de middleware en Next) **sí** está parcheado — se corrigió en 14.2.25 y aquí hay 14.2.35.

### Refactorización segura

```bash
# 1. Arreglos automáticos sin cambio de mayor
npm audit fix --prefix frontend
npm audit fix --prefix backend

# 2. Next.js — el salto a 16.x es de versión mayor; probar en rama aparte.
npm install next@latest --prefix frontend
```

Para `xlsx`, sustituirlo por el build oficial mantenido o migrar a `exceljs`:

```bash
# Opción A — build oficial de SheetJS (fuera del registro npm)
npm install --prefix backend https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz

# Opción B — reemplazo mantenido en npm
npm install exceljs --prefix backend && npm uninstall xlsx --prefix backend
```

Mientras persista `xlsx`, contener el riesgo de *prototype pollution*: los scripts de importación son de línea de comandos, así que ejecutarlos aislados del servidor y **congelar el prototipo** al inicio:

```js
// backend/import_xlsx.js — primera línea del fichero
// xlsx tiene prototype pollution sin parche publicado. Congelar el prototipo hace que la
// escritura falle en silencio (o lance en modo estricto) en lugar de contaminar el proceso.
Object.freeze(Object.prototype);
```

**Medidas continuas:** activar Dependabot o Renovate, y añadir `npm audit --audit-level=high` como paso bloqueante en CI.

---

# MEDIO

## [MEDIO] 12 — IDOR en `/api/table-views`: leer, modificar y borrar las vistas de otros

**CWE-639** · **OWASP A01:2021** · **Archivo:** [backend/src/routes/tableViews.routes.js:6-36](backend/src/routes/tableViews.routes.js:6)

### Vector de ataque

La identidad del propietario se toma de la query: `actor(req)` → `req.query.performedBy`. El filtro de `tableViews.store.js:11-15` compara contra ese valor:

```
GET /api/table-views?module=workorders&performedBy=Antonio%20Cano
```

Cualquier usuario autenticado lee así las vistas **personales** de cualquier otro. Peor: `PUT /:id`, `POST /:id/set-default` y `DELETE /:id` **no comprueban propiedad en absoluto** — operan sobre el `id` a secas. Un agente borra o reescribe las vistas guardadas del administrador iterando ids.

### Refactorización segura

```js
// backend/src/routes/tableViews.routes.js
const express = require("express");
const store = require("../store/tableViews.store");
const { actorFrom: actor } = require("../lib/actor");   // ver hallazgo #8

const router = express.Router();

// Una vista Personal pertenece a quien la creó. Sin esta comprobación, el id —que es un entero
// correlativo y aparece en las respuestas de la API— era todo lo necesario para reescribir o
// borrar la vista guardada de otra persona.
function assertCanMutate(view, userName) {
  if (!view) return { status: 404, error: "View not found" };
  if (view.scope === "Personal" && view.userName !== userName) {
    return { status: 404, error: "View not found" };
  }
  return null;
}

router.get("/", async (req, res) => {
  if (!req.query.module) return res.status(400).json({ error: "module is required" });
  res.json(await store.list(req.query.module, actor(req)));
});

router.post("/", async (req, res) => {
  res.status(201).json(await store.create(req.body, actor(req)));
});

router.put("/:id", async (req, res) => {
  const denied = assertCanMutate(store.get(req.params.id), actor(req));
  if (denied) return res.status(denied.status).json({ error: denied.error });
  res.json(await store.update(req.params.id, req.body));
});

router.post("/:id/set-default", async (req, res) => {
  const denied = assertCanMutate(store.get(req.params.id), actor(req));
  if (denied) return res.status(denied.status).json({ error: denied.error });
  res.json(await store.setDefault(req.params.id, actor(req)));
});

router.delete("/:id", async (req, res) => {
  const denied = assertCanMutate(store.get(req.params.id), actor(req));
  if (denied) return res.status(denied.status).json({ error: denied.error });
  await store.remove(req.params.id);
  res.status(204).end();
});

module.exports = router;
```

Exportar `get` desde el store si aún no lo está. Considerar además restringir la creación de vistas con `scope: "Company"` a ADMIN — hoy cualquier agente puede crear una vista visible para toda la empresa (`tableViews.store.js:22`).

---

## [MEDIO] 13 — Todo agente ve el `taxId`, domicilio y comisiones del resto de agentes

**CWE-863** (Autorización incorrecta) · **OWASP A01:2021** · **GDPR Art. 5(1)(c)**
**Archivos:** [backend/src/index.js:104](backend/src/index.js:104) y [backend/src/routes/agents.routes.js:6](backend/src/routes/agents.routes.js:6)

### Vector de ataque

`GET /api/agents` está autorizado para el rol `AGENT` y devuelve **todos** los agentes. `sanitize()` retira sólo `password`; el resto del registro sale íntegro ([agents.store.js:34-38](backend/src/store/agents.store.js:34)):

`taxId` (SSN o EIN), `address`, `phone`, `email`, `commissionType`, `commissionRate`, y por `withStats()` también `commissionsPaid`.

Un agente obtiene así el número de identificación fiscal de todos sus compañeros —material de primera para robo de identidad— junto con lo que cobra cada uno. La ruta existe para poblar un desplegable de nombres; entrega mucho más que eso.

### Refactorización segura

```js
// backend/src/routes/agents.routes.js
// Lo que un desplegable necesita. El registro completo — taxId, domicilio, tarifa de comisión,
// comisiones pagadas — sólo para ADMIN: un agente no tiene motivo para ver el número fiscal
// de sus compañeros, y `sanitize()` sólo quitaba la contraseña.
function forNonAdmin(agent) {
  return { id: agent.id, name: agent.name, companyName: agent.companyName, status: agent.status };
}

router.get("/", async (req, res) => {
  const agents = await store.list();
  res.json(req.user.role === "ADMIN" ? agents : agents.map(forNonAdmin));
});

router.get("/:id", async (req, res) => {
  const item = await store.get(req.params.id);
  if (!item) return res.status(404).json({ error: "Agent not found" });
  // Un agente sólo ve su propia ficha completa.
  if (req.user.role !== "ADMIN" && item.id !== req.user.entityId) {
    return res.json(forNonAdmin(item));
  }
  res.json(item);
});
// POST/PUT/DELETE ya son ADMIN por requireMethodRole en index.js:104
```

Aplicar el mismo criterio a `GET /api/technicians` si en algún momento se abre a roles no administradores.

---

## [MEDIO] 14 — Los técnicos pueden descargar toda la base de clientes

**CWE-1220** (Granularidad insuficiente de control de acceso) · **GDPR Art. 5(1)(c)**
**Archivos:** [backend/src/index.js:69](backend/src/index.js:69), [backend/src/routes/customers.routes.js:6](backend/src/routes/customers.routes.js:6)

### Vector de ataque

```js
app.use("/api/customers", requireAuth, requireMethodRole({ GET: ["ADMIN", "AGENT", "TECHNICIAN"], ... }), customersRoutes);
```

y la ruta devuelve la lista entera sin filtrar por alcance:

```js
router.get("/", async (req, res) => res.json(await store.list()));
```

Cualquier técnico —incluido uno de una empresa subcontratada, que es como están modelados los técnicos según la sincronización con AppSheet— hace una petición y descarga nombre, teléfono, correo, domicilio y vehículo de **toda** la cartera. Ni siquiera necesita órdenes asignadas. Es la exfiltración del activo comercial de la empresa en un solo `GET`, y una violación del principio de minimización del GDPR.

### Refactorización segura

```js
// backend/src/routes/customers.routes.js
const workOrdersStore = require("../store/workorders.store");
const quotesStore = require("../store/quotes.store");

// Cada rol ve el subconjunto que su trabajo requiere. Un técnico necesita los datos de contacto
// de los clientes cuyas órdenes tiene asignadas — no el listado completo de la empresa.
async function visibleCustomerIds(user) {
  if (user.role === "ADMIN") return null;                       // null = sin filtro
  const workOrders = await workOrdersStore.list();
  if (user.role === "TECHNICIAN") {
    return new Set(workOrders.filter((w) => w.technicianId === user.entityId).map((w) => w.customerId));
  }
  const quotes = await quotesStore.list();
  const owned = quotes.filter((q) => q.agentId === user.entityId);
  const ownedQuoteIds = new Set(owned.map((q) => q.id));
  const ids = new Set(owned.map((q) => q.customerId));
  workOrders.filter((w) => ownedQuoteIds.has(w.quoteId)).forEach((w) => ids.add(w.customerId));
  return ids;
}

router.get("/", async (req, res) => {
  const customers = await store.list();
  const allowed = await visibleCustomerIds(req.user);
  res.json(allowed ? customers.filter((c) => allowed.has(c.id)) : customers);
});

router.get("/:id", async (req, res) => {
  const customer = await store.get(req.params.id);
  if (!customer) return res.status(404).json({ error: "Customer not found" });
  const allowed = await visibleCustomerIds(req.user);
  // 404, no 403: distinguirlos confirma qué ids existen.
  if (allowed && !allowed.has(customer.id)) return res.status(404).json({ error: "Customer not found" });
  res.json(customer);
});
```

---

## [MEDIO] 15 — DoS por payload: 25 MB de cuerpo y fotos de intake sin límite, sin autenticar

**CWE-770** (Asignación sin límites) · **CWE-400** · **OWASP A05:2021**
**Archivos:** [backend/src/index.js:62](backend/src/index.js:62), [backend/src/store/quotes.store.js:726-728](backend/src/store/quotes.store.js:726)

### Vector de ataque

`express.json({ limit: "25mb" })` se aplica a **todas** las rutas, incluidas las públicas. Y `submitIntake` acepta `intakePhotos` sin ninguna validación —ni de tamaño, ni de tipo, ni de cantidad—, al contrario que `insuranceAttachments`:

```js
if (data.intakePhotos) {
  quote.intakePhotos = { ...quote.intakePhotos, ...data.intakePhotos };   // JSON arbitrario
}
```

Quien tenga un enlace de intake válido (se envía por SMS al cliente) envía repetidamente 25 MB de basura base64. Cada petición:
1. Asigna 25 MB en el heap de Node → varias concurrentes agotan la memoria del proceso.
2. Se persiste íntegra en la columna JSONB de Postgres → crecimiento ilimitado del almacenamiento, coste directo en Railway.
3. Se devuelve al panel en cada carga de la cotización.

Sin rate limiting (hallazgo #4), un solo cliente tumba la API y llena la base.

### Refactorización segura

```js
// backend/src/index.js
// 25 MB es el techo que necesitan los adjuntos de siniestro en cotizaciones autenticadas.
// Las rutas públicas no tienen ese requisito y sí tienen a un anónimo al otro lado.
app.use("/api/intake", express.json({ limit: "8mb" }));
app.use("/api/workorders/mobile", express.json({ limit: "8mb" }));
app.use("/api/checkout", express.json({ limit: "64kb" }));
app.use("/api/auth", express.json({ limit: "16kb" }));
app.use(express.json({ limit: "25mb" }));
```

```js
// backend/src/store/quotes.store.js
const INTAKE_CATEGORIES = ["driverSide", "passengerSide", "front", "rear", "damageArea", "insuranceCard"];
const MAX_PHOTOS_PER_CATEGORY = 3;   // el mismo límite que ya aplica la UI (intake/[token]/page.js:174)
const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
const PHOTO_URL_RE = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/;

// El cliente que abre el enlace de intake es anónimo por diseño. Sin esto, `intakePhotos` era
// un objeto JSON libre que iba directo a una columna JSONB: categorías inventadas, cualquier
// número de fotos y cualquier contenido, hasta el límite del cuerpo de la petición.
function validateIntakePhotos(photos) {
  if (photos === undefined) return {};
  if (!photos || typeof photos !== "object" || Array.isArray(photos)) {
    throw new Error("intakePhotos must be an object.");
  }
  const clean = {};
  for (const [category, list] of Object.entries(photos)) {
    if (!INTAKE_CATEGORIES.includes(category)) continue;      // categoría desconocida: se descarta
    if (!Array.isArray(list)) throw new Error(`intakePhotos.${category} must be an array.`);
    if (list.length > MAX_PHOTOS_PER_CATEGORY) {
      throw new Error(`Too many photos for ${category} — the limit is ${MAX_PHOTOS_PER_CATEGORY}.`);
    }
    clean[category] = list.map((p) => {
      const m = PHOTO_URL_RE.exec(String(p?.url || ""));
      if (!m) throw new Error(`A photo in ${category} is not a valid JPEG/PNG/WebP data URL.`);
      const bytes = Buffer.from(m[2], "base64");
      if (bytes.length === 0 || bytes.length > MAX_PHOTO_BYTES) {
        throw new Error(`A photo in ${category} is empty or exceeds the 5MB limit.`);
      }
      return {
        name: String(p?.name || "").replace(/[\r\n\\/]/g, "_").slice(0, 200),
        url: `data:${m[1]};base64,${bytes.toString("base64")}`,
      };
    });
  }
  return clean;
}
```
```js
// dentro de submitIntake(), sustituyendo las líneas 726-728
if (data.intakePhotos) {
  quote.intakePhotos = { ...quote.intakePhotos, ...validateIntakePhotos(data.intakePhotos) };
}
```

Aplicar la misma validación a `techPhotos` en `updateFromMobileLink` ([workorders.store.js:243-245](backend/src/store/workorders.store.js:243)), hoy igualmente sin límite.

---

## [MEDIO] 16 — Los agentes acceden a los totales financieros de toda la empresa

**CWE-863** · **OWASP A01:2021** · **Archivo:** [backend/src/routes/payments.routes.js:41-45](backend/src/routes/payments.routes.js:41)

### Vector de ataque

`GET /api/payments` filtra correctamente por agente (líneas 12-15) y `GET /api/payments/:id` comprueba propiedad con `ownsPayment()`. Pero dos rutas hermanas se quedaron sin ninguna de las dos, e `index.js:80` autoriza el método GET a `AGENT`:

```js
router.get("/bonus-summary", async (req, res) =>
  res.json({ ...(await store.bonusSummary(req.query)), types: store.BONUS_TYPES }));
router.get("/parties/:type", async (req, res) =>
  res.json({ parties: await store.partiesForType(req.params.type) }));
```

`bonusSummary()` devuelve `byParty`: el total de bonos pagados **por cada compañía y cada técnico**, con importes y recuentos. Un agente ve así lo que cobran todos los demás. `parties/:type` enumera además la lista completa de contrapartes.

### Refactorización segura

```js
// backend/src/routes/payments.routes.js
const { requireRole } = require("../middleware/auth");

// Totales agregados de toda la empresa: byParty desglosa lo que cobra cada agente y cada
// técnico. `dashboard` (línea 19) ya restringía esto a ADMIN; estas dos se quedaron fuera.
router.get("/bonus-summary", requireRole("ADMIN"), async (req, res) =>
  res.json({ ...(await store.bonusSummary(req.query)), types: store.BONUS_TYPES }));

router.get("/parties/:type", requireRole("ADMIN"), async (req, res) =>
  res.json({ parties: await store.partiesForType(req.params.type) }));
```

---

## [MEDIO] 17 — El manejador de errores filtra detalles internos y enmascara los 500

**CWE-209** (Exposición por mensaje de error) · **OWASP A05:2021** · **Archivo:** [backend/src/index.js:117-120](backend/src/index.js:117)

### Vector de ataque

```js
app.use((err, req, res, next) => {
  console.error(err);
  res.status(400).json({ error: err.message || "Unexpected error" });
});
```

Dos problemas distintos:

1. **`err.message` se devuelve tal cual.** Un error de `pg` incluye nombres de tabla y de columna, texto de la consulta y restricciones violadas (`duplicate key value violates unique constraint "work_orders_work_order_no_key"`). Eso entrega el esquema de la base pieza a pieza — el reconocimiento previo a cualquier intento de inyección. Un `ECONNREFUSED` revela el host y el puerto de Postgres.
2. **Todo se devuelve como `400`.** Un fallo interno genuino se presenta como error del cliente: no aparece en las métricas de 5xx, la monitorización no alerta, y una caída de la base pasa desapercibida.

### Refactorización segura

```js
// backend/src/index.js
const crypto = require("crypto");

// Los errores de validación de los stores (payments.store.js#status-transition,
// quotes.store.js#attachments) son mensajes escritos para la persona y deben llegar. Los que
// nacen de pg, de la red o de un bug no: llevan nombres de tabla, texto de consulta y rutas
// internas.
app.use((err, req, res, next) => {
  const status = err.status || (err.name === "ValidationError" ? 400 : 500);

  // Correlación: el usuario recibe un id, el operador encuentra el error completo por ese id.
  const errorId = crypto.randomBytes(8).toString("hex");
  console.error(`[${errorId}] ${req.method} ${req.originalUrl} ${status}`, err);

  if (status >= 500) {
    return res.status(500).json({ error: "Internal server error", errorId });
  }
  res.status(status).json({ error: err.message || "Bad request" });
});
```

Marcar los errores de negocio existentes con `err.status = 400` allí donde se lanzan (o darles `name = "ValidationError"`), de modo que sólo esos lleguen con su texto al cliente.

---

## [MEDIO] 18 — Enumeración de cuentas en el login

**CWE-204** (Discrepancia observable en la respuesta) · **OWASP A07:2021**
**Archivo:** [backend/src/routes/auth.routes.js:49](backend/src/routes/auth.routes.js:49) y [:59](backend/src/routes/auth.routes.js:59)

### Vector de ataque

Dos respuestas distinguibles para un mismo `POST /api/auth/login`:

| Situación | Respuesta |
|---|---|
| Cuenta inexistente o contraseña incorrecta | `401 "Invalid credentials"` |
| Cuenta existente, contraseña **correcta**, estado inactivo | `401 "This account is inactive"` |

El segundo mensaje confirma dos cosas a la vez: que la cuenta existe **y** que la contraseña probada es válida. Quien reutilice credenciales filtradas de otras brechas obtiene confirmación directa de qué pares correo/contraseña funcionan, listos para usar en cuanto la cuenta se reactive o en cualquier otro servicio donde se repitan.

Existe además un canal temporal: cuando no hay cuenta, `verifyPassword` retorna de inmediato (`password.js:26`); cuando la hay, se ejecuta un `bcrypt.compare` de coste 12 (~250 ms). Esa diferencia es medible por red y permite enumerar correos válidos aunque se unifiquen los mensajes.

### Refactorización segura

```js
// backend/src/routes/auth.routes.js
const bcrypt = require("bcryptjs");

// Hash de una contraseña que nadie usa, con el mismo coste que los reales. Se compara contra él
// cuando el correo no existe, de modo que la respuesta tarda lo mismo haya cuenta o no: sin esto,
// la diferencia entre retornar al instante y ejecutar un bcrypt de coste 12 (~250 ms) enumera
// correos válidos por tiempo aunque los mensajes sean idénticos.
const DUMMY_HASH = bcrypt.hashSync("::nonexistent-account-timing-equalizer::", 12);

router.post("/login", async (req, res) => {
  const { email, password } = req.body || {};
  const INVALID = { error: "Invalid credentials" };

  if (typeof email !== "string" || typeof password !== "string") {
    await bcrypt.compare(String(password || ""), DUMMY_HASH);
    return res.status(401).json(INVALID);
  }

  // ... break-glass (ver hallazgo #22) ...

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

    // Una cuenta inactiva devuelve el MISMO 401 que una contraseña incorrecta. Decir
    // "esta cuenta está inactiva" confirma a la vez que el correo existe y que la contraseña
    // probada es la buena — justo lo que busca quien reutiliza credenciales filtradas.
    if (c.record.status !== undefined && c.record.status !== "Active") {
      return res.status(401).json(INVALID);
    }
    if (needsRehash) c.store.update(c.record.id, { password }).catch((e) => console.error("rehash failed:", e.message));

    return issueToken(res, {
      id: `${c.prefix}-${c.record.id}`, email: c.record.email, name: c.record.name,
      role, entityId: c.record.id, mustChangePassword: c.record.mustChangePassword,
    });
  }

  // Ninguna coincidencia: se iguala el coste con el hash señuelo.
  await bcrypt.compare(password, DUMMY_HASH);
  return res.status(401).json(INVALID);
});
```

> El usuario cuya cuenta esté realmente inactiva debe recibir la explicación por otro canal (correo del administrador), nunca en la respuesta del login.

---

## [MEDIO] 19 — Cambiar la contraseña no invalida las sesiones existentes; no hay revocación de JWT

**CWE-613** (Expiración de sesión insuficiente) · **OWASP A07:2021**
**Archivo:** [backend/src/routes/auth.routes.js:72-96](backend/src/routes/auth.routes.js:72)

### Vector de ataque

`POST /api/auth/change-password` actualiza el hash pero no toca los tokens ya emitidos. Un JWT es autocontenido: sigue validando durante sus 8 horas completas.

El escenario es exactamente el de una cuenta comprometida. El usuario se da cuenta, cambia la contraseña —el gesto universal de "expulsar al intruso"— y el atacante conserva el acceso hasta 8 horas más. Lo mismo al desactivar un agente (`status: "Inactive"`) o al despedir a un técnico: el `status` se comprueba **sólo en el login**, nunca en `requireAuth`. Un empleado despedido a las 9:00 sigue operando con normalidad hasta las 17:00.

### Refactorización segura

Añadir un `tokenVersion` por cuenta, incluirlo en el token y verificarlo en cada petición:

```js
// backend/src/routes/auth.routes.js — al emitir, incluir la versión actual
return issueToken(res, { id: `agent-${agent.id}`, ..., tokenVersion: agent.tokenVersion || 0 });

// ...y al cambiar la contraseña, incrementarla:
await store.update(entityId, {
  password: newPassword,
  mustChangePassword: false,
  // Invalida todo token emitido antes de este momento. Cambiar la contraseña es el gesto con
  // el que alguien expulsa a un intruso; sin esto el token robado seguía valiendo 8 horas.
  tokenVersion: (record.tokenVersion || 0) + 1,
});
res.json({ message: "Password updated. Please sign in again." });
```

```js
// backend/src/middleware/auth.js
const usersStore = require("../store/users.store");
const agentsStore = require("../store/agents.store");
const techniciansStore = require("../store/technicians.store");

const STORE_BY_ROLE = { ADMIN: usersStore, AGENT: agentsStore, TECHNICIAN: techniciansStore };

async function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Unauthorized" });

  let claims;
  try {
    claims = jwt.verify(token, JWT_SECRET, VERIFY_OPTS);
  } catch {
    return res.status(401).json({ error: "Unauthorized" });
  }

  // El break-glass no tiene registro que consultar.
  if (claims.entityId != null) {
    const store = STORE_BY_ROLE[claims.role];
    const record = store && (await store.get(claims.entityId));
    // Cuenta borrada o desactivada: el status se comprobaba sólo en el login, así que un
    // técnico despedido seguía trabajando con su token hasta 8 horas después.
    if (!record || (record.status !== undefined && record.status !== "Active")) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    if ((record.tokenVersion || 0) !== (claims.tokenVersion || 0)) {
      return res.status(401).json({ error: "Unauthorized" });
    }
  }

  req.user = claims;
  next();
}
```

Añadir `tokenVersion: 0` en los `create()` de los tres stores y permitirlo en sus `update()`.

> `agents.store` y `users.store` sirven desde memoria y `technicians.store` desde Postgres por clave primaria; el coste por petición es despreciable. Si más adelante pesa, cachear el par `(entityId, tokenVersion)` con un TTL de 60 s.

---

# BAJO

## [BAJO] 20 — El JWT vive en `localStorage`

**CWE-922** (Almacenamiento inseguro de información sensible)
**Archivo:** [frontend/src/app/[locale]/login/page.js:32](frontend/src/app/[locale]/login/page.js:32), [frontend/src/lib/api.js:15](frontend/src/lib/api.js:15)

`localStorage` es legible por cualquier JavaScript del origen. Es lo que convierte el hallazgo #2 en robo de sesión en lugar de una molestia. Una cookie `HttpOnly` es inaccesible al script aunque haya XSS.

**Mitigación (por orden de coste):**
1. **Inmediato y gratis:** aplicar la CSP del hallazgo #9 y el saneado de adjuntos del #2 — eliminan el vector de lectura.
2. **A medio plazo:** migrar a cookie `HttpOnly; Secure; SameSite=Strict`. Requiere `credentials: "include"` en `api.js`, CORS con lista blanca (hallazgo #5, ya con `credentials: true`) y **protección CSRF** (token de doble envío), que hoy no hace falta precisamente porque la sesión no viaja en cookie.

```js
// backend/src/routes/auth.routes.js — versión con cookie
function issueToken(res, payload) {
  const token = jwt.sign(payload, JWT_SECRET, { algorithm: "HS256", issuer: "autoglass-crm", expiresIn: "8h" });
  res.cookie("session", token, {
    httpOnly: true,                                   // inaccesible a document.cookie y a cualquier XSS
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",                               // el navegador no la adjunta en peticiones de otro sitio
    maxAge: 8 * 60 * 60 * 1000,
    path: "/",
  });
  res.json({ user: payload });                        // el token ya no viaja en el cuerpo
}
```

---

## [BAJO] 21 — La IP del registro de auditoría es falsificable

**CWE-348** (Uso de fuente de entrada no confiable) · **Archivo:** [backend/src/routes/payoutStatement.routes.js:10](backend/src/routes/payoutStatement.routes.js:10)

```js
const ip = req.headers["x-forwarded-for"] || req.socket?.remoteAddress || null;
```

`X-Forwarded-For` la escribe el cliente. Como `app.set("trust proxy")` no está configurado, Express no la valida ni la normaliza. Quien acceda a un comprobante puede grabar en `publicAccessLog` la IP que quiera — incluida la de un compañero, para desviar la atención. El registro que existe precisamente para saber quién abrió un comprobante ajeno lo dicta quien lo abre.

```js
// backend/src/routes/payoutStatement.routes.js
router.get("/:token", async (req, res) => {
  // req.ip respeta `app.set("trust proxy", 1)`: toma el último salto no confiable de
  // X-Forwarded-For en lugar del valor entero que escribe el cliente.
  const statement = await store.statementByToken(req.params.token, { ip: req.ip || null });
  if (!statement) return res.status(404).json({ error: "Statement not found" });
  res.json(statement);
});
```

**Adicional:** `publicAccessLog` crece sin límite con cada apertura ([payments.store.js:689-690](backend/src/store/payments.store.js:689)). Conviene recortarlo para que un token filtrado no permita inflar la fila JSONB indefinidamente:

```js
payment.publicAccessLog = [...(payment.publicAccessLog || []),
  { timestamp: new Date().toISOString(), via: "statement-viewed", ip: meta.ip || null }].slice(-200);
```

---

## [BAJO] 22 — Break-glass: comparación no constante y credencial en claro

**CWE-208** (Discrepancia temporal observable) · **Archivo:** [backend/src/routes/auth.routes.js:26-33](backend/src/routes/auth.routes.js:26)

```js
password === process.env.EMERGENCY_ADMIN_PASSWORD
```

El operador `===` sobre cadenas cortocircuita en el primer byte distinto. Explotarlo por red es poco práctico, pero se elimina sin coste. Más relevante: la contraseña reside en claro en una variable de entorno y este acceso **no deja ningún rastro**.

El diseño en sí es sólido —desactivado salvo que ambas variables estén puestas, sin credencial embebida, documentado en `.env.example`—; los ajustes son de endurecimiento.

```js
// backend/src/routes/auth.routes.js
const crypto = require("crypto");

// timingSafeEqual exige longitudes iguales, así que se comparan los digest: longitud fija
// siempre y sin filtrar la longitud real de la contraseña.
function safeEqual(a, b) {
  const ha = crypto.createHash("sha256").update(String(a ?? "")).digest();
  const hb = crypto.createHash("sha256").update(String(b ?? "")).digest();
  return crypto.timingSafeEqual(ha, hb);
}

if (process.env.EMERGENCY_ADMIN_EMAIL && process.env.EMERGENCY_ADMIN_PASSWORD_HASH) {
  const emailOk = safeEqual(String(email || "").toLowerCase(), process.env.EMERGENCY_ADMIN_EMAIL.toLowerCase());
  // Hash bcrypt en lugar de texto plano: la variable de entorno queda expuesta en el panel de
  // Railway, en `printenv` y en cualquier volcado del proceso.
  const passOk = emailOk && (await bcrypt.compare(String(password || ""), process.env.EMERGENCY_ADMIN_PASSWORD_HASH));
  if (passOk) {
    // Este acceso salta todos los controles normales: tiene que ser ruidoso.
    console.warn(`[SECURITY] Break-glass admin login usado desde ${req.ip} a las ${new Date().toISOString()}`);
    return issueToken(res, { id: "emergency-admin", email, name: "Emergency Admin", role: "ADMIN", entityId: null, mustChangePassword: false });
  }
  if (emailOk) console.warn(`[SECURITY] Break-glass FALLIDO desde ${req.ip}`);
}
```

Generar el hash con: `node -e "console.log(require('bcryptjs').hashSync(process.argv[1],12))" 'la-contraseña'`

---

## [BAJO] 23 — Sin MFA para cuentas administrativas

**OWASP A07:2021**

Una única contraseña separa a un atacante del control total de la información financiera y de la PII de todos los clientes. Recomendado TOTP (RFC 6238) obligatorio para el rol `ADMIN`:

```bash
npm install otplib qrcode --prefix backend
```

Esquema: columna `mfa_secret` cifrada + `mfa_enabled`; en el login, si `mfa_enabled`, devolver `{ mfaRequired: true, challengeId }` en lugar del token y exigir un segundo paso `POST /api/auth/mfa/verify`. Añadir 8 códigos de recuperación de un solo uso, almacenados con hash.

---

## [BAJO] 24 — `forgot-password` no hace nada

**Archivo:** [backend/src/routes/auth.routes.js:68-70](backend/src/routes/auth.routes.js:68)

```js
router.post("/forgot-password", (req, res) => {
  res.json({ message: "If the account exists, a reset link was sent." });
});
```

La respuesta genérica es correcta frente a la enumeración, pero el endpoint miente: no envía nada. El usuario que pierde su contraseña espera un correo que nunca llega y acaba pidiéndosela al administrador por un canal informal —WhatsApp, teléfono—, que es peor que no tener la función.

Al implementarlo: token de un solo uso de ≥32 bytes almacenado **con hash** (no en claro), caducidad de 15-30 minutos, invalidación al usarse, incremento de `tokenVersion` (hallazgo #19), y el `loginLimiter` del hallazgo #4 aplicado a este endpoint.

Mientras tanto, es preferible que la interfaz indique que el restablecimiento se solicita al administrador, en lugar de mostrar un formulario que no hace nada.

---

# Buenas prácticas ya implementadas

Reconocimiento explícito de lo que está bien resuelto — y que no debe romperse al aplicar lo anterior.

### Inyección SQL — sin hallazgos

Revisadas las 78 fuentes del backend. **Todas** las consultas usan marcadores parametrizados `$1..$n` de `node-postgres`. La construcción dinámica de SQL —que suele ser el punto débil— está bien contenida:

- `notes.store.js:134` usa un patrón `add(sql, v)` que sustituye `$$` por el índice real del argumento; los fragmentos de condición son literales del código, nunca entrada del usuario.
- `payable.store.js:65-68` (`COLUMNA_DE_GRUPO`) devuelve una de **dos** cadenas fijas escogidas por un booleano, no por una entrada.
- `persistence.js:82` interpola nombres de columna, pero éstos son `Object.keys(fields)` y ambos invocantes (`partNumbers.store.js:71`, `vehicleTypes.store.js:257`) pasan literales del código. **Refuerzo recomendado:** añadir `if (!/^[a-zA-Z]+$/.test(name)) throw ...` sobre `columns`, para que la seguridad de esa función no dependa de la disciplina de sus futuros invocantes.
- `workorders.store.js:181` — la ordenación se resuelve **en JavaScript** contra un mapa `SORTABLE_FIELDS`, no con un `ORDER BY` interpolado. Es exactamente la forma correcta de evitar la inyección en ordenación.
- `payments.store.js:451` usa `= ANY($1::bigint[])` con conversión de tipo explícita en lugar de un `IN` construido con `join`.

### Aleatoriedad criptográfica — correcta

Cero apariciones de `Math.random()`. Todos los tokens usan `crypto.randomBytes()` o `crypto.randomUUID()`: intake 16 bytes (128 bits), link móvil / token de pago / comprobante 10 bytes (80 bits). Resistentes a fuerza bruta.

### Hashing de contraseñas — correcto

`backend/src/lib/password.js` aplica bcrypt con coste 12, por encima del mínimo recomendado por OWASP. El diseño de punto único de control es acertado: la longitud mínima se impone en `hashPassword()`, no en la interfaz, así que una llamada directa a la API no puede saltárselo. La guarda para hash vacío (`if (!stored) return { valid: false }`) impide que una cuenta sin contraseña acepte `""` — un fallo frecuente y bien resuelto aquí. La migración con `needsRehash` para registros heredados está correctamente planteada.

### Ejecución de comandos y ficheros — sin hallazgos

Ni `child_process`, ni `exec`, ni `eval`, ni `new Function` en todo el backend. La única escritura de ficheros (`persistence.js:41`) usa una ruta derivada de constantes del código. `restore()` (`persistence.js:165`) concatena un nombre sin normalizar, pero sólo es alcanzable desde scripts de línea de comandos, nunca por HTTP. **Refuerzo recomendado:** añadir de todos modos `if (path.dirname(path.resolve(source)) !== path.resolve(BACKUPS_DIR)) throw ...`.

### XSS reflejado — sin hallazgos

Un solo `dangerouslySetInnerHTML` en todo el frontend ([layout.js:38](frontend/src/app/[locale]/layout.js:38)), y su contenido es una constante del código para inicializar el tema — sin interpolación de datos. El resto del renderizado usa JSX, que escapa automáticamente. El único XSS de la aplicación es el almacenado del hallazgo #2, que llega por otra vía.

### Webhook de Stripe — correcto

[stripeWebhook.js:7](backend/src/webhooks/stripeWebhook.js:7) verifica la firma con `constructEvent()` antes de tocar nada, y [index.js:61](backend/src/index.js:61) monta `express.raw()` **antes** de `express.json()` — el orden correcto, y un error frecuente. El importe se toma de `session.amount_total` (Stripe) y no del cliente. Con el secreto sin configurar, `constructEvent` lanza y devuelve 400: falla cerrado.

### Control de acceso — mayoritariamente sólido

La matriz por método de `requireMethodRole` en `index.js:65-110` es un diseño explícito y legible, con las excepciones justificadas en comentarios (catálogo de piezas y de vehículos abiertos a POST de agentes, con PUT/DELETE reservados a ADMIN). `quotes.routes.js` comprueba propiedad en **todas** sus rutas de instancia. `workorders.routes.js:69-77` filtra por alcance para técnicos y agentes. `payments.routes.js` tiene `ownsPayment`. Los hallazgos #7, #12 y #16 son omisiones puntuales en un patrón por lo demás correcto.

`updateFromMobileLink` ([workorders.store.js:236](backend/src/store/workorders.store.js:236)) es un buen ejemplo de mínimo privilegio: lista blanca de dos campos, ruta separada de `update()` para que ningún campo pueda cruzarse entre ambas, y auditoría de cada cambio. El comentario que explica por qué la ruta antigua basada en `id` era insegura documenta el razonamiento para quien venga después.

`sanitize()` retira `password` en los tres stores de identidad (`users`, `agents`, `technicians`) antes de devolver nada por la API.

### Gestión de secretos en Git — correcta a partir de ahora

`backend/.env` **nunca** se ha versionado, verificado sobre todo el historial. El `.gitignore` del backend es exhaustivo y sus comentarios explican el porqué de cada exclusión, incluidos los ficheros de respaldo con hashes previos a la rotación. El único problema es retrospectivo (hallazgo #3).

### Diseño de tokens públicos — bien razonado

Los tres enlaces sin sesión (intake, link móvil, comprobante) están construidos con criterio: el token es la credencial, la revocación se hace emitiendo uno nuevo, cada apertura queda registrada, y el 404 es idéntico para un token inexistente y para uno revocado — con el comentario que explica que distinguirlos confirmaría un acierto a quien prueba tokens ([payoutStatement.routes.js:12-13](backend/src/routes/payoutStatement.routes.js:12)). `GET /workorders/pay/:token` proyecta sólo cuatro campos, que es exactamente el patrón que le falta a la ruta móvil (hallazgo #6).

---

# Plan de remediación

| # | Hallazgo | Nivel | Esfuerzo | Prioridad |
|---|---|---|---|---|
| 1 | Secreto JWT `changeme` | CRÍTICO | 1 h | **Inmediata** |
| 2 | XSS almacenado en adjuntos | CRÍTICO | 4 h | **Inmediata** |
| 3 | PII en el historial de Git | CRÍTICO | 3 h + coordinación | **Inmediata** |
| 4 | Sin rate limiting | ALTO | 2 h | Semana 1 |
| 6 | Fuga en el link móvil | ALTO | 1 h | Semana 1 |
| 7 | IDOR en notificaciones | ALTO | 15 min | Semana 1 |
| 5 | CORS abierto | ALTO | 30 min | Semana 1 |
| 9 | Cabeceras de seguridad | ALTO | 2 h | Semana 1 |
| 10 | Postgres sin TLS | ALTO | 1 h | Semana 1 |
| 8 | `performedBy` falsificable | ALTO | 1 h | Semana 2 |
| 11 | Dependencias vulnerables | ALTO | 4 h (Next 16 es mayor) | Semana 2 |
| 12–19 | Hallazgos MEDIO | MEDIO | ~8 h en conjunto | Semana 2-3 |
| 20–24 | Hallazgos BAJO | BAJO | ~12 h (MFA aparte) | Trimestre |

**Verificación posterior:** repetir esta auditoría tras aplicar los CRÍTICO y ALTO, y añadir a CI un paso de `npm audit --audit-level=high` y un análisis estático (`semgrep --config=p/owasp-top-ten`) que impida reintroducir estos patrones.
