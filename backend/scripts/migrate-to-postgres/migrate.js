require("dotenv").config();
const pool = require("../../src/config/db");
const { loadOrSeed } = require("../../src/lib/persistence");
const passwordHasher = require("./lib/passwordHasher");
const photoExtractor = require("./lib/photoExtractor");
const { verify } = require("./lib/verify");

const DRY_RUN = process.argv.includes("--dry-run");
const onlyArg = process.argv.find((a) => a.startsWith("--only="));
const ONLY = onlyArg ? onlyArg.slice("--only=".length).split(",") : null;

function shouldRun(table) {
  return !ONLY || ONLY.includes(table);
}

// ---- helpers ----------------------------------------------------------

async function insertPreservingId(client, table, columns, values) {
  const cols = ["id", ...columns];
  const placeholders = cols.map((_, i) => `$${i + 1}`).join(",");
  await client.query(
    `INSERT INTO ${table} (${cols.join(",")}) OVERRIDING SYSTEM VALUE VALUES (${placeholders})`,
    values
  );
}

async function resetSequence(client, table) {
  await client.query(
    `SELECT setval(pg_get_serial_sequence('${table}','id'), COALESCE((SELECT MAX(id) FROM ${table}), 0) + 1, false)`
  );
}

async function runWave(name, fn) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await fn(client);
    if (DRY_RUN) {
      await client.query("ROLLBACK");
      console.log(`[dry-run] ${name}: rolled back`);
    } else {
      await client.query("COMMIT");
      console.log(`${name}: committed`);
    }
  } catch (err) {
    await client.query("ROLLBACK");
    console.error(`${name}: FAILED — ${err.message}`);
    throw err;
  } finally {
    client.release();
  }
}

const s = (v) => (v === undefined || v === null ? "" : v);
const n = (v) => (v === undefined || v === null || v === "" ? 0 : Number(v));
const dateOrNull = (v) => (v ? v : null);

// Defensive remap for any pre-collapse legacy status strings still on disk — the stores used to do this
// remap at load time (a one-time IIFE against the in-memory JSON array); since migrate.js reads the raw
// JSON directly (bypassing the store layer entirely), that remap no longer runs, so it's reproduced here
// to avoid violating the quotes.status / workorders.status CHECK constraints.
const QUOTE_LEGACY_STATUS_MAP = {
  "Intake Sent": "Waiting Customer", "Waiting For Customer": "Waiting Customer",
  "Customer Completed": "Ready For Review", "Ready For Pricing": "Ready For Review", "New": "Draft",
  "Pending Approval": "Ready For Review", "Scheduled": "Approved", "In Progress": "Approved",
  "Follow-Up": "Waiting Customer", "No Response": "Waiting Customer", "On Hold": "Waiting Customer",
  "Accepted": "Approved", "Opportunity To Sell Lead": "Approved", "Job Done": "Converted",
  "Pending Payment": "Converted", "Budget Issue": "Rejected", "Quote Too Cheap": "Rejected",
  "Too Expensive - Not Interested": "Rejected", "Lost To Competitor": "Rejected", "Lost - Competitor": "Rejected",
  "Lost - High Price": "Rejected", "Lost - Customer Waiting": "Rejected", "Lost - No Response": "Rejected",
  "Lost": "Rejected", "Expired": "Rejected", "Duplicate": "Rejected", "Cancelled": "Rejected",
  "Sold To Partner": "Rejected",
};
const QUOTE_STATUSES = ["Draft", "Waiting Customer", "Ready For Review", "Approved", "Converted", "Rejected"];
function normalizeQuoteStatus(status) {
  if (QUOTE_STATUSES.includes(status)) return status;
  return QUOTE_LEGACY_STATUS_MAP[status] || "Draft";
}

const WORKORDER_LEGACY_STATUS_MAP = {
  "New": "Scheduled", "Accepted": "Assigned", "Waiting Customer": "Scheduled", "Waiting Parts": "Scheduled",
  "Rescheduled": "Scheduled", "Completed Pending Payment": "Completed", "Warranty": "Completed",
  "Rework Required": "In Progress", "Charge Back": "Closed", "No Show": "Closed",
};
const WORKORDER_STATUSES = ["Scheduled", "Assigned", "In Progress", "Completed", "Paid", "Closed", "Cancelled"];
function normalizeWorkOrderStatus(status) {
  if (WORKORDER_STATUSES.includes(status)) return status;
  return WORKORDER_LEGACY_STATUS_MAP[status] || "Scheduled";
}

// ---- Wave: catalogs / lookups / misc -----------------------------------

async function migrateJobTypes(client) {
  if (!shouldRun("job_types")) return;
  const rows = loadOrSeed("jobTypes.json", () => []);
  for (const r of rows) {
    await insertPreservingId(client, "job_types", ["name", "type"], [r.id, s(r.name), s(r.type)]);
  }
  await resetSequence(client, "job_types");
}

async function migratePartNumbers(client) {
  if (!shouldRun("part_numbers")) return;
  const rows = loadOrSeed("partNumbers.json", () => []);
  for (const r of rows) {
    await insertPreservingId(
      client, "part_numbers",
      ["part_number", "job_type", "nags_description"],
      [r.id, s(r.partNumber), s(r.jobType), s(r.nagsDescription)]
    );
  }
  await resetSequence(client, "part_numbers");
}

async function migrateCalibrationTypes(client) {
  if (!shouldRun("calibration_types")) return;
  const rows = loadOrSeed("calibrationTypes.json", () => []);
  for (const r of rows) {
    await insertPreservingId(client, "calibration_types", ["name", "amount"], [r.id, s(r.name), n(r.amount)]);
  }
  await resetSequence(client, "calibration_types");
}

async function migratePriceTiers(client) {
  if (!shouldRun("price_tiers")) return;
  const rows = loadOrSeed("priceTiers.json", () => []);
  for (const r of rows) {
    await insertPreservingId(
      client, "price_tiers",
      ["name", "amount", "description"],
      [r.id, s(r.name), n(r.amount), s(r.description)]
    );
  }
  await resetSequence(client, "price_tiers");
}

async function migrateVehicleTypes(client) {
  if (!shouldRun("vehicle_types")) return;
  const rows = loadOrSeed("vehicleTypes.json", () => []);
  for (const r of rows) {
    await insertPreservingId(
      client, "vehicle_types",
      ["year", "make", "model", "body_type"],
      [r.id, n(r.year), s(r.make), s(r.model), s(r.bodyType)]
    );
  }
  await resetSequence(client, "vehicle_types");
}

async function migrateZipCodes(client) {
  if (!shouldRun("zip_codes")) return;
  const rows = loadOrSeed("zipCodes.json", () => []);
  for (const r of rows) {
    await insertPreservingId(
      client, "zip_codes",
      ["city", "county", "state", "zipcode", "tax", "service_area", "long_trip_required", "long_trip_fee", "distance_from_base"],
      [r.id, s(r.city), s(r.county), s(r.state) || "CA", s(r.zipcode || r.zipCode), n(r.tax),
       r.serviceArea !== false, !!r.longTripRequired, n(r.longTripFee), n(r.distanceFromBase)]
    );
  }
  await resetSequence(client, "zip_codes");
}

async function migratePaymentMethods(client) {
  if (!shouldRun("payment_methods")) return;
  const rows = loadOrSeed("paymentMethods.json", () => []);
  for (const r of rows) {
    await insertPreservingId(client, "payment_methods", ["name"], [r.id, s(r.name)]);
  }
  await resetSequence(client, "payment_methods");
}

async function migratePaymentStatuses(client) {
  if (!shouldRun("payment_statuses")) return;
  const rows = loadOrSeed("paymentStatus.json", () => []);
  for (const r of rows) {
    await insertPreservingId(client, "payment_statuses", ["name"], [r.id, s(r.name)]);
  }
  await resetSequence(client, "payment_statuses");
}

async function migrateTags(client) {
  if (!shouldRun("tags")) return;
  const rows = loadOrSeed("tags.json", () => []);
  for (const r of rows) {
    await insertPreservingId(client, "tags", ["name", "type"], [r.id, s(r.name), s(r.type)]);
  }
  await resetSequence(client, "tags");
}

async function migrateExpenseCategories(client) {
  if (!shouldRun("expense_categories")) return;
  const rows = loadOrSeed("expenseCategories.json", () => []);
  for (const r of rows) {
    await insertPreservingId(client, "expense_categories", ["name"], [r.id, s(r.name)]);
  }
  await resetSequence(client, "expense_categories");
}

async function migratePartnerCompanies(client) {
  if (!shouldRun("partner_companies")) return;
  const rows = loadOrSeed("partnerCompanies.json", () => []);
  for (const r of rows) {
    await insertPreservingId(
      client, "partner_companies",
      ["company_name", "contact_name", "phone", "email", "lead_price", "notes", "active", "created_at"],
      [r.id, s(r.companyName), s(r.contactName), s(r.phone), s(r.email), n(r.leadPrice), s(r.notes),
       r.active !== false, r.createdAt || new Date().toISOString()]
    );
  }
  await resetSequence(client, "partner_companies");
}

async function migrateUsers(client) {
  if (!shouldRun("users")) return;
  const rows = loadOrSeed("users.json", () => []);
  for (const r of rows) {
    await insertPreservingId(
      client, "users",
      ["name", "email", "phone", "role", "bank_name", "bank_account_number", "commission", "salary", "notes", "attachments", "created_at"],
      [r.id, s(r.name), r.email || null, s(r.phone), s(r.role) || "Employee", s(r.bank?.bankName), s(r.bank?.accountNumber),
       n(r.commission), n(r.salary), s(r.notes), JSON.stringify(r.attachments || []), r.createdAt || new Date().toISOString()]
    );
  }
  await resetSequence(client, "users");
}

async function migrateExpenses(client) {
  if (!shouldRun("expenses")) return;
  const rows = loadOrSeed("expenses.json", () => []);
  for (const r of rows) {
    await insertPreservingId(
      client, "expenses",
      ["category", "date", "amount", "notes", "attachments", "created_at"],
      [r.id, s(r.category), dateOrNull(r.date), n(r.amount), s(r.notes), JSON.stringify(r.attachments || []),
       r.createdAt || new Date().toISOString()]
    );
  }
  await resetSequence(client, "expenses");
}

async function migrateTableViews(client) {
  if (!shouldRun("table_views")) return;
  const rows = loadOrSeed("tableViews.json", () => []);
  for (const r of rows) {
    await insertPreservingId(
      client, "table_views",
      ["module", "scope", "user_name", "view_name", "columns", "is_default", "created_at", "updated_at"],
      [r.id, s(r.module), s(r.scope) || "Personal", r.userName || null, s(r.viewName) || "Untitled View",
       JSON.stringify(r.columns || []), !!r.isDefault, r.createdAt || new Date().toISOString(), r.updatedAt || new Date().toISOString()]
    );
  }
  await resetSequence(client, "table_views");
}

// ---- Wave: actor / reference entities ----------------------------------

async function migrateCustomers(client) {
  if (!shouldRun("customers")) return;
  const rows = loadOrSeed("customers.json", () => []);
  for (const r of rows) {
    const v = r.vehicle || {};
    await insertPreservingId(
      client, "customers",
      ["first_name", "last_name", "phone", "phone_alt", "email", "address", "address_type", "unit_number",
       "city", "state", "zip_code", "vehicle_year", "vehicle_make", "vehicle_model", "vehicle_body_type",
       "vehicle_vin", "vehicle_plate", "active", "deleted_at", "created_by", "updated_by", "created_at", "updated_at"],
      [r.id, s(r.firstName), s(r.lastName), s(r.phone), s(r.phoneAlt), s(r.email), s(r.address), s(r.addressType),
       s(r.unitNumber), s(r.city), s(r.state), s(r.zipCode), s(v.year), s(v.make), s(v.model), s(v.bodyType),
       s(v.vin), s(v.plate), r.active !== false, r.deletedAt || null, s(r.createdBy) || "System", s(r.updatedBy) || "System",
       r.createdAt || new Date().toISOString(), r.updatedAt || new Date().toISOString()]
    );
  }
  await resetSequence(client, "customers");
}

async function migrateInsuranceCompanies(client) {
  if (!shouldRun("insurance_companies")) return;
  const rows = loadOrSeed("insurance.json", () => []);
  for (const r of rows) {
    await insertPreservingId(
      client, "insurance_companies",
      ["name", "phone", "email", "address", "notes", "active", "deleted_at", "created_at", "updated_at"],
      [r.id, s(r.name), s(r.phone), s(r.email), s(r.address), s(r.notes), r.active !== false, r.deletedAt || null,
       r.createdAt || new Date().toISOString(), r.updatedAt || new Date().toISOString()]
    );
  }
  await resetSequence(client, "insurance_companies");
}

async function migrateDistributors(client) {
  if (!shouldRun("distributors")) return;
  const rows = loadOrSeed("distributors.json", () => []);
  for (const r of rows) {
    const logo = photoExtractor.extract(r.logo, "distributors", r.id, "logo");
    await insertPreservingId(
      client, "distributors",
      ["name", "contact_name", "phone", "mobile", "email", "address", "city", "state", "zip_code", "website",
       "account_number", "payment_terms", "tax_id", "notes", "logo", "status", "active", "deleted_at", "created_at", "updated_at"],
      [r.id, s(r.name), s(r.contactName), s(r.phone), s(r.mobile), s(r.email), s(r.address), s(r.city), s(r.state),
       s(r.zipCode), s(r.website), s(r.accountNumber), s(r.paymentTerms), s(r.taxId), s(r.notes), logo || null,
       s(r.status) || "Active", r.active !== false, r.deletedAt || null,
       r.createdAt || new Date().toISOString(), r.updatedAt || new Date().toISOString()]
    );
  }
  await resetSequence(client, "distributors");
}

async function migrateAgents(client) {
  if (!shouldRun("agents")) return;
  const rows = loadOrSeed("agents.json", () => []);
  for (const r of rows) {
    const photo = photoExtractor.extract(r.photo, "agents", r.id, "photo");
    await insertPreservingId(
      client, "agents",
      ["name", "company_name", "phone", "email", "password", "address", "commission_type", "commission_rate",
       "tax_id", "notes", "photo", "status", "active", "deleted_at", "created_at", "updated_at"],
      [r.id, s(r.name), s(r.companyName), s(r.phone), r.email || null, passwordHasher.hash(r.password), s(r.address),
       s(r.commissionType) || "Percentage", n(r.commissionRate), s(r.taxId), s(r.notes), photo || null,
       s(r.status) || "Active", r.active !== false, r.deletedAt || null,
       r.createdAt || new Date().toISOString(), r.updatedAt || new Date().toISOString()]
    );
  }
  await resetSequence(client, "agents");
}

async function migrateTechnicians(client) {
  if (!shouldRun("technicians")) return;
  const rows = loadOrSeed("technicians.json", () => []);
  for (const r of rows) {
    const photo = photoExtractor.extract(r.photo, "technicians", r.id, "photo");
    await insertPreservingId(
      client, "technicians",
      ["name", "company_name", "phone", "mobile", "email", "password", "address", "city", "state", "zip_code",
       "tax_id", "driver_license", "insurance_expiration", "notes", "photo", "status", "default_labor_rate",
       "default_commission", "service_areas", "languages", "can_receive_sms", "can_receive_links", "calendar_color",
       "active", "deleted_at", "created_at", "updated_at"],
      [r.id, s(r.name), s(r.companyName), s(r.phone), s(r.mobile), r.email || null, passwordHasher.hash(r.password),
       s(r.address), s(r.city), s(r.state), s(r.zipCode), s(r.taxId), s(r.driverLicense),
       dateOrNull(r.insuranceExpiration), s(r.notes), photo || null, s(r.status) || "Active", n(r.defaultLaborRate),
       n(r.defaultCommission), JSON.stringify(r.serviceAreas || []), JSON.stringify(r.languages || []),
       r.canReceiveSms !== false, r.canReceiveLinks !== false, s(r.calendarColor) || "#2563eb",
       r.active !== false, r.deletedAt || null, r.createdAt || new Date().toISOString(), r.updatedAt || new Date().toISOString()]
    );
  }
  await resetSequence(client, "technicians");
}

// ---- Wave: quotes -------------------------------------------------------

function sanitizedPayment(payment = {}) {
  const { method, zipCode, firstName, lastName, amount, authorizationId } = payment || {};
  // cardNumber / cvv / expirationDate intentionally dropped, never read
  return { method: method || "", zipCode: zipCode || "", firstName: firstName || "", lastName: lastName || "",
           amount: amount ?? 0, authorizationId: authorizationId || "" };
}

async function migrateQuotes(client) {
  if (!shouldRun("quotes") && !shouldRun("quote_line_items")) return;
  const rows = loadOrSeed("quotes.json", () => []);
  for (const r of rows) {
    const v = r.vehicle || {};
    const crmPhotos = photoExtractor.extractArray(r.crmPhotos, "quotes", r.id, "crmPhotos");
    const customerPhotos = photoExtractor.extractArray(r.customerPhotos, "quotes", r.id, "customerPhotos");
    const ip = r.intakePhotos || {};
    const intakePhotos = {
      driverSide: photoExtractor.extractArray(ip.driverSide, "quotes", r.id, "intakePhotos_driverSide"),
      passengerSide: photoExtractor.extractArray(ip.passengerSide, "quotes", r.id, "intakePhotos_passengerSide"),
      front: photoExtractor.extractArray(ip.front, "quotes", r.id, "intakePhotos_front"),
      rear: photoExtractor.extractArray(ip.rear, "quotes", r.id, "intakePhotos_rear"),
      damageArea: photoExtractor.extractArray(ip.damageArea, "quotes", r.id, "intakePhotos_damageArea"),
      insuranceCard: photoExtractor.extractArray(ip.insuranceCard, "quotes", r.id, "intakePhotos_insuranceCard"),
    };

    if (shouldRun("quotes")) {
      await insertPreservingId(
        client, "quotes",
        ["quote_no", "status", "document_type", "payment_type", "call_direction", "name", "date", "zip_code",
         "long_trip_fee", "service_area", "long_trip_required", "distance_from_base", "customer_type", "customer_id",
         "customer_name", "new_customer", "insurance_company_id", "agent_id", "agent_name", "policy_number",
         "claim_number", "appointment_date", "start_time", "end_time", "vehicle_year", "vehicle_make", "vehicle_model",
         "vehicle_body_type", "vehicle_vin", "vehicle_plate", "glass_type", "part_number", "nags_description",
         "glass_cost", "calibration_type", "damage_notes", "insurance", "discount", "insurance_adjustment",
         "crm_photos", "customer_photos", "tax_rate", "upsell", "commission", "paid_amount", "cash_comeback",
         "customer_suggested_price", "payment", "lost_info", "lost_info_partner_company_id", "intake_token",
         "intake_token_expires_at", "intake_sent_at", "intake_opened_at", "intake_completed_at", "intake_photos",
         "active", "deleted_at", "created_by", "updated_by", "created_at", "updated_at"],
        [r.id, s(r.quoteNo), normalizeQuoteStatus(r.status), s(r.documentType) || "WorkOrder", s(r.paymentType) || "Personal",
         s(r.callDirection) || "In", s(r.name), dateOrNull(r.date), s(r.zipCode), n(r.longTripFee), r.serviceArea !== false,
         !!r.longTripRequired, n(r.distanceFromBase), s(r.customerType) || "Existing",
         r.customerId ? Number(r.customerId) : null, s(r.customerName), JSON.stringify(r.newCustomer || {}),
         r.insuranceCompanyId ? Number(r.insuranceCompanyId) : null, r.agentId ? Number(r.agentId) : null,
         s(r.agentName), s(r.policyNumber), s(r.claimNumber), dateOrNull(r.appointmentDate), s(r.startTime),
         s(r.endTime), s(v.year), s(v.make), s(v.model), s(v.bodyType), s(v.vin), s(v.plate), s(r.glassType),
         s(r.partNumber), s(r.nagsDescription), n(r.glassCost), s(r.calibrationType), s(r.damageNotes),
         JSON.stringify(r.insurance || {}), JSON.stringify(r.discount || { type: "Percentage", value: 0, reason: "" }),
         JSON.stringify(r.insuranceAdjustment || { amount: 0, notes: "" }), JSON.stringify(crmPhotos || []),
         JSON.stringify(customerPhotos || []), n(r.taxRate), n(r.upsell), n(r.commission), n(r.paidAmount),
         n(r.cashComeback), n(r.customerSuggestedPrice), JSON.stringify(sanitizedPayment(r.payment)),
         JSON.stringify(r.lostInfo || {}), r.lostInfo?.partnerCompanyId ? Number(r.lostInfo.partnerCompanyId) : null,
         r.intakeToken || null, r.intakeTokenExpiresAt || null, r.intakeSentAt || null, r.intakeOpenedAt || null,
         r.intakeCompletedAt || null, JSON.stringify(intakePhotos), r.active !== false, r.deletedAt || null,
         s(r.createdBy) || "System", s(r.updatedBy) || "System", r.createdAt || new Date().toISOString(),
         r.updatedAt || new Date().toISOString()]
      );
    }

    if (shouldRun("quote_line_items")) {
      const lineItems = Array.isArray(r.lineItems) ? r.lineItems : [];
      for (let i = 0; i < lineItems.length; i++) {
        const li = lineItems[i];
        await client.query(
          `INSERT INTO quote_line_items
             (quote_id, position, job_type, part_number, nags_description, calibration_type, price_tier, price_part, distributor, order_number)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
          [r.id, i, s(li.jobType), s(li.partNumber), s(li.nagsDescription), s(li.calibrationType), s(li.priceTier),
           n(li.pricePart), s(li.distributor), s(li.orderNumber)]
        );
      }
    }
  }
  if (shouldRun("quotes")) await resetSequence(client, "quotes");
  if (shouldRun("quote_line_items")) await resetSequence(client, "quote_line_items");
}

// ---- Wave: work orders ---------------------------------------------------

async function migrateWorkOrders(client) {
  if (!shouldRun("workorders")) return;
  const rows = loadOrSeed("workorders.json", () => []);
  for (const r of rows) {
    const v = r.vehicle || {};
    const techPhotos = photoExtractor.extractArray(r.techPhotos, "workorders", r.id, "techPhotos");
    await insertPreservingId(
      client, "workorders",
      ["work_order_no", "quote_id", "quote_no", "customer_id", "customer_name", "work_order_type", "phone", "email",
       "address", "vehicle_year", "vehicle_make", "vehicle_model", "vehicle_body_type", "vehicle_vin", "vehicle_plate",
       "insurance_company_id", "claim_number", "policy_number", "distributor_id", "distributor", "tech",
       "technician_id", "tech_assigned_at", "part_number", "glass_type", "nags_description", "job_type", "priority",
       "labor_cost", "glass_cost", "total_sale", "status", "appointment_date", "appointment_time",
       "appointment_duration_minutes", "special_instructions", "tech_instructions", "internal_notes",
       "cancellation_reason", "cancelled_at", "payment", "payment_history", "public_token", "tech_photos",
       "active", "deleted_at", "created_by", "updated_by", "created_at", "updated_at"],
      [r.id, s(r.workOrderNo), r.quoteId ? Number(r.quoteId) : null, s(r.quoteNo),
       r.customerId ? Number(r.customerId) : null, s(r.customerName), s(r.workOrderType) || "Personal", s(r.phone),
       s(r.email), s(r.address), s(v.year), s(v.make), s(v.model), s(v.bodyType), s(v.vin), s(v.plate),
       r.insuranceCompanyId ? Number(r.insuranceCompanyId) : null, s(r.claimNumber), s(r.policyNumber),
       r.distributorId ? Number(r.distributorId) : null, s(r.distributor), s(r.tech),
       r.technicianId ? Number(r.technicianId) : null, r.techAssignedAt || null, s(r.partNumber), s(r.glassType),
       s(r.nagsDescription), s(r.jobType), s(r.priority) || "Normal", n(r.laborCost), n(r.glassCost), n(r.totalSale),
       normalizeWorkOrderStatus(r.status), dateOrNull(r.appointmentDate), s(r.appointmentTime),
       r.appointmentDurationMinutes ?? 60, s(r.specialInstructions), s(r.techInstructions), s(r.internalNotes),
       s(r.cancellationReason), r.cancelledAt || null,
       JSON.stringify(r.payment || { method: "", amount: 0, paid: false, cashComeback: 0, authorizationId: "" }),
       JSON.stringify(r.paymentHistory || []), r.publicToken || null, JSON.stringify(techPhotos || []),
       r.active !== false, r.deletedAt || null, s(r.createdBy) || "System", s(r.updatedBy) || "System",
       r.createdAt || new Date().toISOString(), r.updatedAt || new Date().toISOString()]
    );
  }
  await resetSequence(client, "workorders");
}

// ---- Wave: financial core ------------------------------------------------

async function migratePayments(client) {
  if (!shouldRun("payments")) return;
  const rows = loadOrSeed("payments.json", () => []);
  for (const r of rows) {
    await insertPreservingId(
      client, "payments",
      ["payment_number", "type", "status", "payment_method", "payment_date", "notes", "technician_id",
       "work_order_id", "customer_id", "vehicle", "job_type", "base_amount", "bonus", "deductions", "net_amount",
       "distributor_id", "invoice_number", "po_number", "part_number", "invoice_date", "due_date", "tax_amount",
       "subtotal", "total_amount", "attachment", "agent_id", "commission_type", "commission_rate", "gross_amount",
       "commission_amount", "credit_notes_total", "debit_notes_total", "transactions", "audit_log", "active",
       "deleted_at", "created_by", "updated_by", "created_at", "updated_at"],
      [r.id, s(r.paymentNumber), s(r.type), s(r.status) || "Pending", s(r.paymentMethod), dateOrNull(r.paymentDate),
       s(r.notes), r.technicianId ? Number(r.technicianId) : null, r.workOrderId ? Number(r.workOrderId) : null,
       r.customerId ? Number(r.customerId) : null, s(r.vehicle), s(r.jobType), n(r.baseAmount), n(r.bonus),
       n(r.deductions), n(r.netAmount), r.distributorId ? Number(r.distributorId) : null, s(r.invoiceNumber),
       s(r.poNumber), s(r.partNumber), dateOrNull(r.invoiceDate), dateOrNull(r.dueDate), n(r.taxAmount),
       n(r.subtotal), n(r.totalAmount), r.attachment ? JSON.stringify(r.attachment) : null,
       r.agentId ? Number(r.agentId) : null, s(r.commissionType) || "Percentage", n(r.commissionRate),
       n(r.grossAmount), n(r.commissionAmount), n(r.creditNotesTotal), n(r.debitNotesTotal),
       JSON.stringify(r.transactions || []), JSON.stringify(r.auditLog || []), r.active !== false,
       r.deletedAt || null, s(r.createdBy) || "System", s(r.updatedBy) || "System",
       r.createdAt || new Date().toISOString(), r.updatedAt || new Date().toISOString()]
    );
  }
  await resetSequence(client, "payments");
}

async function migrateNotes(client) {
  if (!shouldRun("notes")) return;
  const rows = loadOrSeed("notes.json", () => []);
  for (const r of rows) {
    await insertPreservingId(
      client, "notes",
      ["note_number", "note_type", "entity_type", "entity_id", "entity_name", "related_payment_id", "amount",
       "reason", "description", "issue_date", "attachment", "status", "created_by", "audit_log", "created_at", "updated_at"],
      [r.id, s(r.noteNumber), s(r.noteType), s(r.entityType), r.entityId ? Number(r.entityId) : null, s(r.entityName),
       r.relatedPaymentId ? Number(r.relatedPaymentId) : null, n(r.amount), s(r.reason), s(r.description),
       dateOrNull(r.issueDate), r.attachment ? JSON.stringify(r.attachment) : null, s(r.status) || "Active",
       s(r.createdBy) || "System", JSON.stringify(r.auditLog || []), r.createdAt || new Date().toISOString(),
       r.updatedAt || new Date().toISOString()]
    );
  }
  await resetSequence(client, "notes");
}

async function migrateInvoices(client) {
  if (!shouldRun("invoices") && !shouldRun("invoice_line_items")) return;
  const rows = loadOrSeed("invoices.json", () => []);
  for (const r of rows) {
    const v = r.vehicle || {};
    const split = r.splitBilling || {};

    if (shouldRun("invoices")) {
      await insertPreservingId(
        client, "invoices",
        ["invoice_number", "work_order_id", "work_order_no", "quote_id", "customer_id", "customer_name",
         "customer_phone", "customer_email", "vehicle_year", "vehicle_make", "vehicle_model", "vehicle_body_type",
         "vehicle_vin", "vehicle_plate", "insurance_company_id", "claim_number", "technician", "bill_to",
         "split_customer_amount", "split_insurance_amount", "split_deductible", "tax", "discount", "invoice_date",
         "due_date", "status", "public_token", "template", "custom_sections", "notes", "internal_notes", "payments",
         "audit_log", "created_at", "updated_at"],
        [r.id, s(r.invoiceNumber), Number(r.workOrderId), s(r.workOrderNo), r.quoteId ? Number(r.quoteId) : null,
         r.customerId ? Number(r.customerId) : null, s(r.customerName), s(r.customerPhone), s(r.customerEmail),
         s(v.year), s(v.make), s(v.model), s(v.bodyType), s(v.vin), s(v.plate),
         r.insuranceCompanyId ? Number(r.insuranceCompanyId) : null, s(r.claimNumber), s(r.technician),
         s(r.billTo) || "Customer", n(split.customerAmount), n(split.insuranceAmount), n(split.deductible), n(r.tax),
         n(r.discount), dateOrNull(r.invoiceDate), dateOrNull(r.dueDate), s(r.status) || "Draft",
         r.publicToken || null, s(r.template) || "Personal", JSON.stringify(r.customSections || {}), s(r.notes),
         s(r.internalNotes), JSON.stringify(r.payments || []), JSON.stringify(r.auditLog || []),
         r.createdAt || new Date().toISOString(), r.updatedAt || new Date().toISOString()]
      );
    }

    if (shouldRun("invoice_line_items")) {
      const items = Array.isArray(r.items) ? r.items : [];
      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        await client.query(
          `INSERT INTO invoice_line_items (invoice_id, position, description, quantity, unit_price)
           VALUES ($1,$2,$3,$4,$5)`,
          [r.id, i, s(it.description), it.quantity ?? 1, n(it.unitPrice)]
        );
      }
    }
  }
  if (shouldRun("invoices")) await resetSequence(client, "invoices");
  if (shouldRun("invoice_line_items")) await resetSequence(client, "invoice_line_items");
}

// ---- Wave: notifications / attachments -----------------------------------

async function migrateAttachments(client) {
  if (!shouldRun("attachments")) return;
  const rows = loadOrSeed("attachments.json", () => []);
  for (const r of rows) {
    await insertPreservingId(
      client, "attachments",
      ["related_type", "related_id", "file_name", "url", "uploaded_at"],
      [r.id, s(r.relatedType), r.relatedId ? Number(r.relatedId) : null, s(r.fileName), s(r.url),
       r.uploadedAt || new Date().toISOString()]
    );
  }
  await resetSequence(client, "attachments");
}

async function migrateWorkOrderNotifications(client) {
  if (!shouldRun("work_order_notifications")) return;
  const rows = loadOrSeed("workOrderNotifications.json", () => []);
  for (const r of rows) {
    await insertPreservingId(
      client, "work_order_notifications",
      ["work_order_id", "technician_id", "method", "recipient", "message", "sent_at", "status"],
      [r.id, Number(r.workOrderId), r.technicianId ? Number(r.technicianId) : null, s(r.method) || "SMS",
       s(r.recipient), s(r.message), r.sentAt || new Date().toISOString(), s(r.status) || "Sent"]
    );
  }
  await resetSequence(client, "work_order_notifications");
}

async function migrateQuoteIntakeNotifications(client) {
  if (!shouldRun("quote_intake_notifications")) return;
  const rows = loadOrSeed("quoteIntakeNotifications.json", () => []);
  for (const r of rows) {
    await insertPreservingId(
      client, "quote_intake_notifications",
      ["quote_id", "method", "recipient", "message", "sent_at", "status"],
      [r.id, Number(r.quoteId), s(r.method) || "SMS", s(r.recipient), s(r.message),
       r.sentAt || new Date().toISOString(), s(r.status) || "Sent"]
    );
  }
  await resetSequence(client, "quote_intake_notifications");
}

// ---- orchestration --------------------------------------------------------

async function main() {
  console.log(DRY_RUN ? "Running in --dry-run mode (all waves rolled back)." : "Running migration.");
  if (ONLY) console.log(`Restricting to tables: ${ONLY.join(", ")}`);

  await runWave("Wave 1: catalogs/lookups/misc", async (client) => {
    await migrateJobTypes(client);
    await migratePartNumbers(client);
    await migrateCalibrationTypes(client);
    await migratePriceTiers(client);
    await migrateVehicleTypes(client);
    await migrateZipCodes(client);
    await migratePaymentMethods(client);
    await migratePaymentStatuses(client);
    await migrateTags(client);
    await migrateExpenseCategories(client);
    await migratePartnerCompanies(client);
    await migrateUsers(client);
    await migrateExpenses(client);
    await migrateTableViews(client);
  });

  await runWave("Wave 2: actors/reference (customers, insurance, distributors, agents, technicians)", async (client) => {
    await migrateCustomers(client);
    await migrateInsuranceCompanies(client);
    await migrateDistributors(client);
    await migrateAgents(client);
    await migrateTechnicians(client);
  });

  await runWave("Wave 3: quotes + quote_line_items", async (client) => {
    await migrateQuotes(client);
  });

  await runWave("Wave 4: workorders", async (client) => {
    await migrateWorkOrders(client);
  });

  await runWave("Wave 5: payments, notes, invoices + invoice_line_items", async (client) => {
    await migratePayments(client);
    await migrateNotes(client);
    await migrateInvoices(client);
  });

  await runWave("Wave 6: notifications + attachments", async (client) => {
    await migrateAttachments(client);
    await migrateWorkOrderNotifications(client);
    await migrateQuoteIntakeNotifications(client);
  });

  if (!DRY_RUN) {
    console.log("\nVerifying row counts...");
    const ok = await verify({ only: ONLY });
    if (!ok) {
      console.error("\nMigration completed but verification found mismatches — investigate before proceeding.");
      process.exitCode = 1;
    } else {
      console.log("\nMigration completed and verified.");
    }
  } else {
    console.log("\nDry run complete — no data was committed.");
  }

  await pool.end();
}

main().catch((err) => {
  console.error("Migration failed:", err.message);
  process.exit(1);
});
