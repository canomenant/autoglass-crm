require("dotenv").config();
const path = require("path");
const express = require("express");
const cors = require("cors");
require("express-async-errors");

const { initPostgres } = require("./lib/initPostgres");

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
  const invoicesRoutes = require("./routes/invoices.routes");
  const tableViewsRoutes = require("./routes/tableViews.routes");
  const partnerCompaniesRoutes = require("./routes/partnerCompanies.routes");
  const presenceRoutes = require("./routes/presence.routes");
  const creditNotesRoutes = require("./routes/creditNotes.routes");
  const debitNotesRoutes = require("./routes/debitNotes.routes");
  const attachmentsRoutes = require("./routes/attachments.routes");
  const calibrationTypesRoutes = require("./routes/calibrationTypes.routes");
  const paymentMethodsRoutes = require("./routes/paymentMethods.routes");
  const expenseCategoriesRoutes = require("./routes/expenseCategories.routes");
  const priceTiersRoutes = require("./routes/priceTiers.routes");
  const partNumbersRoutes = require("./routes/partNumbers.routes");
  const vehicleTypesRoutes = require("./routes/vehicleTypes.routes");
  const vehicleRoutes = require("./routes/vehicle.routes");
  const jobTypesRoutes = require("./routes/jobTypes.routes");
  const zipCodesRoutes = require("./routes/zipCodes.routes");
  const tagsRoutes = require("./routes/tags.routes");
  const techniciansRoutes = require("./routes/technicians.routes");
  const agentsRoutes = require("./routes/agents.routes");
  const paymentStatusRoutes = require("./routes/paymentStatus.routes");
  const intakeRoutes = require("./routes/intake.routes");
  const checkoutRoutes = require("./routes/checkout.routes");
  const stripeWebhook = require("./webhooks/stripeWebhook");
  const { seed } = require("./seed");
  const { requireAuth, requireRole, requireMethodRole } = require("./middleware/auth");

  const app = express();

  await seed();

  app.use(cors());
  app.post("/api/checkout/webhook", express.raw({ type: "application/json" }), stripeWebhook);
  app.use(express.json({ limit: "25mb" }));
  app.use("/uploads", express.static(path.join(__dirname, "..", "public", "uploads")));

  const readCatalog = requireMethodRole({ GET: ["ADMIN", "AGENT"], POST: ["ADMIN"], PUT: ["ADMIN"], DELETE: ["ADMIN"] });
  const adminOnly = requireRole("ADMIN");

  app.use("/api/auth", authRoutes);
  app.use("/api/quotes", requireAuth, requireRole("ADMIN", "AGENT"), quotesRoutes);
  app.use("/api/workorders", workordersRoutes);
  app.use("/api/customers", requireAuth, requireMethodRole({ GET: ["ADMIN", "AGENT", "TECHNICIAN"], POST: ["ADMIN", "AGENT"], PUT: ["ADMIN"], DELETE: ["ADMIN"] }), customersRoutes);
  app.use("/api/insurance", requireAuth, requireMethodRole({ GET: ["ADMIN", "AGENT"], POST: ["ADMIN"], PUT: ["ADMIN"], DELETE: ["ADMIN"] }), insuranceRoutes);
  app.use("/api/distributors", requireAuth, requireMethodRole({ GET: ["ADMIN", "AGENT"], POST: ["ADMIN"], PUT: ["ADMIN"], DELETE: ["ADMIN"] }), distributorsRoutes);
  app.use("/api/expenses", requireAuth, adminOnly, expensesRoutes);
  app.use("/api/reports", requireAuth, adminOnly, reportsRoutes);
  app.use("/api/users", requireAuth, adminOnly, usersRoutes);
  app.use("/api/payments", requireAuth, requireMethodRole({ GET: ["ADMIN", "AGENT"], POST: ["ADMIN"], PUT: ["ADMIN"], DELETE: ["ADMIN"] }), paymentsRoutes);
  app.use("/api/invoices", invoicesRoutes);
  app.use("/api/table-views", requireAuth, tableViewsRoutes);
  app.use("/api/partner-companies", requireAuth, requireMethodRole({ GET: ["ADMIN", "AGENT"], POST: ["ADMIN"], PUT: ["ADMIN"], DELETE: ["ADMIN"] }), partnerCompaniesRoutes);
  app.use("/api/presence", requireAuth, presenceRoutes);
  app.use("/api/credit-notes", requireAuth, adminOnly, creditNotesRoutes);
  app.use("/api/debit-notes", requireAuth, adminOnly, debitNotesRoutes);
  app.use("/api/attachments", requireAuth, attachmentsRoutes);
  app.use("/api/settings/calibration-types", requireAuth, readCatalog, calibrationTypesRoutes);
  app.use("/api/settings/payment-methods", requireAuth, readCatalog, paymentMethodsRoutes);
  app.use("/api/settings/expense-categories", requireAuth, adminOnly, expenseCategoriesRoutes);
  app.use("/api/settings/price-tiers", requireAuth, readCatalog, priceTiersRoutes);
  app.use("/api/settings/part-numbers", requireAuth, readCatalog, partNumbersRoutes);
  app.use("/api/settings/vehicle-types", requireAuth, readCatalog, vehicleTypesRoutes);
  app.use("/api/vehicle", requireAuth, readCatalog, vehicleRoutes);
  app.use("/api/settings/job-types", requireAuth, readCatalog, jobTypesRoutes);
  app.use("/api/settings/zip-codes", requireAuth, readCatalog, zipCodesRoutes);
  app.use("/api/settings/tags", requireAuth, adminOnly, tagsRoutes);
  app.use("/api/technicians", requireAuth, adminOnly, techniciansRoutes);
  app.use("/api/agents", requireAuth, requireMethodRole({ GET: ["ADMIN", "AGENT"], POST: ["ADMIN"], PUT: ["ADMIN"], DELETE: ["ADMIN"] }), agentsRoutes);
  app.use("/api/settings/payment-status", requireAuth, adminOnly, paymentStatusRoutes);
  // Public: customer self-service intake link, no login required (relies on the unguessable token)
  app.use("/api/intake", intakeRoutes);
  app.use("/api/checkout", checkoutRoutes);

  app.get("/api/health", (req, res) => res.json({ status: "ok" }));

  // Store-layer validation errors (e.g. payments.store.js's status-transition guards) throw plain
  // Error objects; express-async-errors forwards them here instead of letting Express's default
  // HTML error page leak a stack trace to API clients.
  app.use((err, req, res, next) => {
    console.error(err);
    res.status(400).json({ error: err.message || "Unexpected error" });
  });

  const PORT = process.env.PORT || 4000;
  app.listen(PORT, () => console.log(`API running on port ${PORT}`));
}

main();
