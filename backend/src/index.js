require("dotenv").config();
const crypto = require("crypto");
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
require("express-async-errors");

// Se carga aquí arriba a propósito: valida JWT_SECRET al importar y lanza si es débil o falta,
// de modo que el proceso no llega a escuchar en un puerto con un secreto que cualquiera puede
// reproducir.
require("./config/secrets");

const { initPostgres } = require("./lib/initPostgres");
const { loginLimiter, publicLimiter, apiLimiter } = require("./middleware/rateLimit");

async function main() {
  try {
    await initPostgres();
    console.log("Postgres app_data cache loaded.");
  } catch (err) {
    console.error("initPostgres failed (continuing without Postgres cache):", err.message);
  }

  const authRoutes = require("./routes/auth.routes");
  const quotesRoutes = require("./routes/quotes.routes");
  const workordersRoutes = require("./routes/workorders.routes");
  const customersRoutes = require("./routes/customers.routes");
  const insuranceRoutes = require("./routes/insurance.routes");
  const distributorsRoutes = require("./routes/distributors.routes");
  const expensesRoutes = require("./routes/expenses.routes");
  const reportsRoutes = require("./routes/reports.routes");
  const usersRoutes = require("./routes/users.routes");
  const paymentsRoutes = require("./routes/payments.routes");
  const payableRoutes = require("./routes/payable.routes");
  const invoicesRoutes = require("./routes/invoices.routes");
  const tableViewsRoutes = require("./routes/tableViews.routes");
  const partnerCompaniesRoutes = require("./routes/partnerCompanies.routes");
  const presenceRoutes = require("./routes/presence.routes");
  const creditNotesRoutes = require("./routes/creditNotes.routes");
  const payoutStatementRoutes = require("./routes/payoutStatement.routes");
  const debitNotesRoutes = require("./routes/debitNotes.routes");
  const calibrationTypesRoutes = require("./routes/calibrationTypes.routes");
  const paymentMethodsRoutes = require("./routes/paymentMethods.routes");
  const expenseCategoriesRoutes = require("./routes/expenseCategories.routes");
  const priceTiersRoutes = require("./routes/priceTiers.routes");
  const partNumbersRoutes = require("./routes/partNumbers.routes");
  const vehicleTypesRoutes = require("./routes/vehicleTypes.routes");
  const vehicleRoutes = require("./routes/vehicle.routes");
  const jobTypesRoutes = require("./routes/jobTypes.routes");
  const businessPartnersRoutes = require("./routes/businessPartners.routes");
  const partnerDistributionSettingsRoutes = require("./routes/partnerDistributionSettings.routes");
  const zipCodesRoutes = require("./routes/zipCodes.routes");
  const tagsRoutes = require("./routes/tags.routes");
  const techniciansRoutes = require("./routes/technicians.routes");
  const agentsRoutes = require("./routes/agents.routes");
  const paymentStatusRoutes = require("./routes/paymentStatus.routes");
  const intakeRoutes = require("./routes/intake.routes");
  const { router: mfaRoutes } = require("./routes/mfa.routes");
  const checkoutRoutes = require("./routes/checkout.routes");
  const stripeWebhook = require("./webhooks/stripeWebhook");
  const { seed } = require("./seed");
  const { requireAuth, requireRole, requireMethodRole } = require("./middleware/auth");

  const app = express();

  await seed();

  // Railway/Nginx ponen la IP real en X-Forwarded-For. Un solo salto: NO usar `true`, que haría
  // que Express creyera la cabecera entera y permitiría falsificar la IP para saltarse el
  // limitador y para ensuciar los registros de acceso de los comprobantes.
  app.set("trust proxy", 1);
  app.disable("x-powered-by");

  app.use(
    helmet({
      // La API sólo devuelve JSON: una CSP restrictiva no rompe nada aquí y evita que una
      // respuesta acabe interpretándose como documento.
      contentSecurityPolicy: {
        directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"], baseUri: ["'none'"] },
      },
      hsts: { maxAge: 63072000, includeSubDomains: true, preload: true },
      crossOriginResourcePolicy: { policy: "same-site" },
      referrerPolicy: { policy: "no-referrer" },
    })
  );

  // Lista blanca explícita. `cors()` a secas respondía Access-Control-Allow-Origin: * a toda
  // petición, lo que dejaba a cualquier página leer las respuestas de las rutas públicas
  // (intake, link móvil, comprobante) desde el navegador de quien la visitara.
  // FRONTEND_URL ya existe en el entorno — lo usa checkout.routes.js para las URL de retorno de
  // Stripe — así que es la misma fuente de verdad.
  const ALLOWED_ORIGINS = (process.env.CORS_ORIGINS || process.env.FRONTEND_URL || "http://localhost:3000")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);

  app.use(
    cors({
      origin(origin, cb) {
        // Sin cabecera Origin = petición que no viene de un navegador (curl, el webhook de
        // Stripe, un health check): no hay política de mismo origen que aplicar, y bloquearla
        // rompería el monitoreo.
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

  app.post("/api/checkout/webhook", express.raw({ type: "application/json" }), stripeWebhook);

  // El límite de 25 MB lo necesitan los adjuntos de siniestro en cotizaciones autenticadas. Las
  // rutas públicas no tienen ese requisito y sí tienen a un anónimo al otro lado, así que se les
  // pone un techo propio ANTES del general: el primer express.json() que casa es el que manda.
  app.use("/api/auth", express.json({ limit: "16kb" }));
  app.use("/api/checkout", express.json({ limit: "64kb" }));
  app.use("/api/intake", express.json({ limit: "8mb" }));
  app.use("/api/workorders/mobile", express.json({ limit: "8mb" }));
  app.use(express.json({ limit: "25mb" }));

  // Un actor de auditoría no se acepta del cliente. Se borra aquí, en un solo sitio, para que
  // ninguna ruta futura pueda volver a leerlo por descuido — lib/actor.js lo toma del token.
  app.use((req, res, next) => {
    if (req.body && typeof req.body === "object" && "performedBy" in req.body) {
      console.warn(`[audit] performedBy recibido del cliente en ${req.method} ${req.originalUrl} — ignorado`);
      delete req.body.performedBy;
    }
    next();
  });

  app.use("/api", apiLimiter);
  app.use("/api/auth/login", loginLimiter);
  app.use("/api/auth/forgot-password", loginLimiter);
  // Seis dígitos son un millón de combinaciones: sin límite se agotan en minutos.
  app.use("/api/auth/mfa/verify", loginLimiter);
  app.use("/api/intake", publicLimiter);
  app.use("/api/checkout", publicLimiter);
  app.use("/api/payout-statement", publicLimiter);
  app.use("/api/workorders/mobile", publicLimiter);
  app.use("/api/invoices/public", publicLimiter);

  const readCatalog = requireMethodRole({ GET: ["ADMIN", "AGENT"], POST: ["ADMIN"], PUT: ["ADMIN"], DELETE: ["ADMIN"] });
  const adminOnly = requireRole("ADMIN");

  // SIN requireAuth en el montaje, a propósito. Cada ruta de gestión (setup/enable/disable/status)
  // lo lleva puesta ella misma; ponerlo aquí además interceptaría /api/auth/mfa/verify —que es el
  // segundo paso del login y por definición todavía NO tiene sesión— y lo dejaría en 401 siempre.
  // Al no casar /verify con nada de este router, la petición cae al siguiente, que es authRoutes.
  app.use("/api/auth/mfa", mfaRoutes);
  app.use("/api/auth", authRoutes);
  app.use("/api/quotes", requireAuth, requireRole("ADMIN", "AGENT"), quotesRoutes);
  app.use("/api/workorders", workordersRoutes);
  app.use("/api/customers", requireAuth, requireMethodRole({ GET: ["ADMIN", "AGENT", "TECHNICIAN"], POST: ["ADMIN", "AGENT"], PUT: ["ADMIN"], DELETE: ["ADMIN"] }), customersRoutes);
  app.use("/api/insurance", requireAuth, requireMethodRole({ GET: ["ADMIN", "AGENT"], POST: ["ADMIN"], PUT: ["ADMIN"], DELETE: ["ADMIN"] }), insuranceRoutes);
  app.use("/api/distributors", requireAuth, requireMethodRole({ GET: ["ADMIN", "AGENT"], POST: ["ADMIN"], PUT: ["ADMIN"], DELETE: ["ADMIN"] }), distributorsRoutes);
  app.use("/api/expenses", requireAuth, adminOnly, expensesRoutes);
  app.use("/api/reports", requireAuth, adminOnly, reportsRoutes);
  app.use("/api/users", requireAuth, adminOnly, usersRoutes);
  // Cuentas por pagar: solo admin, es plata que se le debe a terceros.
  app.use("/api/payable", requireAuth, adminOnly, payableRoutes);
  app.use("/api/payments", requireAuth, requireMethodRole({ GET: ["ADMIN", "AGENT"], POST: ["ADMIN"], PUT: ["ADMIN"], DELETE: ["ADMIN"] }), paymentsRoutes);
  app.use("/api/invoices", invoicesRoutes);
  app.use("/api/table-views", requireAuth, tableViewsRoutes);
  app.use("/api/partner-companies", requireAuth, requireMethodRole({ GET: ["ADMIN", "AGENT"], POST: ["ADMIN"], PUT: ["ADMIN"], DELETE: ["ADMIN"] }), partnerCompaniesRoutes);
  app.use("/api/presence", requireAuth, presenceRoutes);
  app.use("/api/credit-notes", requireAuth, adminOnly, creditNotesRoutes);
  app.use("/api/debit-notes", requireAuth, adminOnly, debitNotesRoutes);
  app.use("/api/settings/calibration-types", requireAuth, readCatalog, calibrationTypesRoutes);
  app.use("/api/settings/payment-methods", requireAuth, readCatalog, paymentMethodsRoutes);
  app.use("/api/settings/expense-categories", requireAuth, adminOnly, expenseCategoriesRoutes);
  app.use("/api/settings/price-tiers", requireAuth, readCatalog, priceTiersRoutes);
  // Agents are the people writing quotes, so they are the ones who hit a part that isn't in the
  // catalog yet; leaving POST admin-only would 403 the feature for its entire audience. Editing
  // and deleting stay admin-only — creating a missing part is low-risk, rewriting or removing an
  // entry that existing quotes point at is not. Deliberately not folded into readCatalog, which
  // nine other catalogs share.
  const partNumberCatalog = requireMethodRole({ GET: ["ADMIN", "AGENT"], POST: ["ADMIN", "AGENT"], PUT: ["ADMIN"], DELETE: ["ADMIN"] });
  app.use("/api/settings/part-numbers", requireAuth, partNumberCatalog, partNumbersRoutes);
  // Same reasoning as part numbers: agents are the ones quoting, so they are the ones who hit a
  // vehicle the catalog does not have. Creating a missing vehicle is low-risk; editing or deleting
  // a row other quotes were built from is not, so those stay admin-only.
  const vehicleCatalog = requireMethodRole({ GET: ["ADMIN", "AGENT"], POST: ["ADMIN", "AGENT"], PUT: ["ADMIN"], DELETE: ["ADMIN"] });
  app.use("/api/settings/vehicle-types", requireAuth, vehicleCatalog, vehicleTypesRoutes);
  app.use("/api/vehicle", requireAuth, readCatalog, vehicleRoutes);
  app.use("/api/settings/job-types", requireAuth, readCatalog, jobTypesRoutes);
  app.use("/api/settings/business-partners", requireAuth, readCatalog, businessPartnersRoutes);
  app.use("/api/settings/partner-distribution-settings", requireAuth, readCatalog, partnerDistributionSettingsRoutes);
  app.use("/api/settings/zip-codes", requireAuth, readCatalog, zipCodesRoutes);
  app.use("/api/settings/tags", requireAuth, adminOnly, tagsRoutes);
  app.use("/api/technicians", requireAuth, adminOnly, techniciansRoutes);
  app.use("/api/agents", requireAuth, requireMethodRole({ GET: ["ADMIN", "AGENT"], POST: ["ADMIN"], PUT: ["ADMIN"], DELETE: ["ADMIN"] }), agentsRoutes);
  app.use("/api/settings/payment-status", requireAuth, adminOnly, paymentStatusRoutes);
  // Public: customer self-service intake link, no login required (relies on the unguessable token)
  // Publico: el comprobante que se le manda al tecnico o al agente, autorizado por el token.
  app.use("/api/payout-statement", payoutStatementRoutes);
  app.use("/api/intake", intakeRoutes);
  app.use("/api/checkout", checkoutRoutes);

  app.get("/api/health", (req, res) => res.json({ status: "ok" }));

  // Store-layer validation errors (e.g. payments.store.js's status-transition guards) throw plain
  // Error objects; express-async-errors forwards them here instead of letting Express's default
  // HTML error page leak a stack trace to API clients.
  //
  // Devolver err.message SIEMPRE, y siempre con un 400, tenía dos costes distintos: un error de
  // pg lleva nombres de tabla y de columna, texto de la consulta y restricciones violadas —el
  // esquema de la base entregado pieza a pieza—, y un fallo interno disfrazado de 400 no aparece
  // en las métricas de 5xx, así que una caída de la base pasaba desapercibida.
  //
  // Los errores de negocio (validación de los stores) llevan `status` o `name` y su texto sí
  // llega, porque está escrito para la persona que lo va a leer. El resto se resume, y el
  // errorId es lo que permite encontrar el detalle completo en el log del servidor.
  // Se distingue por ORIGEN, no reetiquetando los `throw` que ya existen: los stores lanzan
  // Error planos con textos escritos para la persona ("Payment cannot transition from...",
  // "Attachment X is too large") y ésos deben seguir llegando tal cual.
  //
  //  - pg marca sus errores con `severity` (y `table`, `constraint`, `routine`).
  //  - Los errores de red de Node traen `syscall`/`errno` (ECONNREFUSED, ETIMEDOUT).
  //  - TypeError/ReferenceError/RangeError/SyntaxError son bugs, no entrada inválida.
  //
  // Todo eso se resume; cualquier otra cosa es un error de negocio y conserva su mensaje.
  const BUG_TYPES = [TypeError, ReferenceError, RangeError, SyntaxError];

  function isInternal(err) {
    if (err.status) return err.status >= 500;
    if (err.severity !== undefined || err.routine !== undefined) return true;   // pg
    if (err.syscall !== undefined || err.errno !== undefined) return true;      // red / sistema
    return BUG_TYPES.some((T) => err instanceof T);
  }

  app.use((err, req, res, next) => {
    const status = err.status || (isInternal(err) ? 500 : 400);
    const errorId = crypto.randomBytes(8).toString("hex");

    console.error(`[${errorId}] ${req.method} ${req.originalUrl} -> ${status}`, err);

    if (status >= 500) {
      // El errorId es lo que une lo que ve el usuario con el error completo del log.
      return res.status(500).json({ error: "Internal server error", errorId });
    }
    res.status(status).json({ error: err.message || "Bad request" });
  });

  const PORT = process.env.PORT || 4000;
  app.listen(PORT, () => console.log(`API running on port ${PORT}`));
}

main();
