const crypto = require("crypto");
const customersStore = require("./customers.store");
const calibrationTypesStore = require("./calibrationTypes.store");
const priceTiersStore = require("./priceTiers.store");
const { loadOrSeed, save, nextIdFrom } = require("../lib/persistence");
const pool = require("../config/db");
const { isShadowEnabled, shadowRead } = require("../lib/sqlShadow");
const { isDualWriteEnabled, syncToSql, nextBusinessNumber } = require("../lib/sqlSync");
const { mapQuote } = require("../lib/sqlMappers");

const FILE = "quotes.json";
let quotes = loadOrSeed(FILE, () => []);
let nextId = nextIdFrom(quotes);
let nextLineItemId =
  Math.max(0, ...quotes.flatMap((q) => (q.lineItems || []).map((li) => Number(li.id)).filter((n) => !Number.isNaN(n)))) + 1;

function persist() {
  save(FILE, quotes);
}

// One-time reconciliation: the Quote status model was collapsed from ~30 values down to
// a flat 6-value sales pipeline. Remap any legacy status still on disk to its closest
// equivalent so old records keep displaying/filtering correctly instead of showing a raw,
// untranslated status string. No-op (and safe to re-run) once every record is migrated.
const LEGACY_STATUS_MAP = {
  "Intake Sent": "Waiting Customer",
  "Waiting For Customer": "Waiting Customer",
  "Customer Completed": "Ready For Review",
  "Ready For Pricing": "Ready For Review",
  "New": "Draft",
  "Pending Approval": "Ready For Review",
  "Scheduled": "Approved",
  "In Progress": "Approved",
  "Follow-Up": "Waiting Customer",
  "No Response": "Waiting Customer",
  "On Hold": "Waiting Customer",
  "Accepted": "Approved",
  "Opportunity To Sell Lead": "Approved",
  "Job Done": "Converted",
  "Pending Payment": "Converted",
  "Budget Issue": "Rejected",
  "Quote Too Cheap": "Rejected",
  "Too Expensive - Not Interested": "Rejected",
  "Lost To Competitor": "Rejected",
  "Lost - Competitor": "Rejected",
  "Lost - High Price": "Rejected",
  "Lost - Customer Waiting": "Rejected",
  "Lost - No Response": "Rejected",
  "Lost": "Rejected",
  "Expired": "Rejected",
  "Duplicate": "Rejected",
  "Cancelled": "Rejected",
  "Sold To Partner": "Rejected",
};

(function migrateLegacyStatuses() {
  let changed = false;
  for (const quote of quotes) {
    if (LEGACY_STATUS_MAP[quote.status]) {
      quote.status = LEGACY_STATUS_MAP[quote.status];
      changed = true;
    }
  }
  if (changed) persist();
})();

// Backfill Deductible / Discount / Insurance Adjustment added for the Personal vs. Insurance
// Claim workflow split.
(function migrateDiscountShape() {
  let changed = false;
  for (const quote of quotes) {
    if (quote.insurance && quote.insurance.deductible === undefined) {
      quote.insurance.deductible = 0;
      changed = true;
    }
    if (!quote.discount) {
      quote.discount = { type: "Percentage", value: 0, reason: "" };
      changed = true;
    }
    if (!quote.insuranceAdjustment) {
      quote.insuranceAdjustment = { amount: 0, notes: "" };
      changed = true;
    }
  }
  if (changed) persist();
})();

function pad(n) {
  return String(n).padStart(4, "0");
}

function genIntakeToken() {
  return crypto.randomBytes(16).toString("hex");
}

const INTAKE_PROGRESS_FIELDS = [
  (q) => q.newCustomer?.firstName,
  (q) => q.newCustomer?.lastName,
  (q) => q.newCustomer?.phone,
  (q) => q.newCustomer?.email,
  (q) => q.newCustomer?.address,
  (q) => q.newCustomer?.city,
  (q) => q.newCustomer?.state,
  (q) => q.zipCode,
  (q) => q.vehicle?.year,
  (q) => q.vehicle?.make,
  (q) => q.vehicle?.model,
  (q) => q.vehicle?.vin,
  (q) => q.vehicle?.plate,
  (q) => q.insuranceCompanyId,
  (q) => q.policyNumber,
  (q) => q.claimNumber,
  (q) => q.glassType,
  (q) => q.damageNotes,
  (q) => q.intakePhotos?.driverSide?.length,
  (q) => q.intakePhotos?.passengerSide?.length,
  (q) => q.intakePhotos?.front?.length,
  (q) => q.intakePhotos?.rear?.length,
  (q) => q.intakePhotos?.damageArea?.length,
  (q) => q.intakePhotos?.insuranceCard?.length,
];

function computeIntakeProgress(quote) {
  const total = INTAKE_PROGRESS_FIELDS.length;
  const filled = INTAKE_PROGRESS_FIELDS.filter((get) => {
    const v = get(quote);
    return v !== undefined && v !== null && v !== "" && v !== 0;
  }).length;
  return Math.round((filled / total) * 100);
}

function computeTotals(quote) {
  const lineItems = quote.lineItems || [];
  const calibrationTypes = calibrationTypesStore.list();
  const priceTiers = priceTiersStore.list();
  const subtotalParts = lineItems.reduce((sum, li) => sum + Number(li.pricePart || 0), 0);
  const subtotalServices = lineItems.reduce((sum, li) => {
    const match = calibrationTypes.find((c) => c.name === li.calibrationType);
    return sum + Number(match?.amount || 0);
  }, 0);
  const priceTierTotal = lineItems.reduce((sum, li) => {
    const match = priceTiers.find((p) => p.name === li.priceTier);
    return sum + Number(match?.amount || 0);
  }, 0);
  const longTripFee = Number(quote.longTripFee || 0);
  const laborTotal = Number(quote.insurance?.totalLabor || 0);
  const pricePartInsurance = Number(quote.insurance?.pricePartInsurance || 0);
  const flatRateKit = Number(quote.insurance?.flatRateKit || 0);

  // Personal (retail) branch: Part Price + Calibration + Labor(tier) + Long Trip, minus a
  // discount, taxed on what remains.
  const personalComponents = subtotalParts + subtotalServices + priceTierTotal + longTripFee;
  const discountAmount =
    quote.discount?.type === "Fixed"
      ? Number(quote.discount?.value || 0)
      : personalComponents * (Number(quote.discount?.value || 0) / 100);
  const subtotal = Math.max(0, personalComponents - discountAmount);
  const taxAmount = subtotal * (Number(quote.taxRate || 0) / 100);
  const personalTotal = subtotal + taxAmount;

  // Insurance branch: NAGS-referenced claim value, adjusted, then split between what the
  // insurer owes and what the customer owes (the deductible).
  const claimTotalBeforeAdjustment = pricePartInsurance + laborTotal + flatRateKit + subtotalServices;
  const insuranceAdjustmentAmount = Number(quote.insuranceAdjustment?.amount || 0);
  const claimTotal = claimTotalBeforeAdjustment + insuranceAdjustmentAmount;
  const deductible = Number(quote.insurance?.deductible || 0);
  const customerResponsibility = deductible;
  const insuranceResponsibility = claimTotal - deductible;
  const totalClaimValue = claimTotal;

  const isInsurance = quote.paymentType === "Insurance";
  const totalAmount = isInsurance ? totalClaimValue : personalTotal;
  const remainingBalance = totalAmount - Number(quote.paidAmount || 0);

  return {
    subtotalParts,
    subtotalServices,
    priceTierTotal,
    laborTotal,
    longTripFee,
    discountAmount,
    subtotal,
    taxAmount,
    personalTotal,
    pricePartInsurance,
    flatRateKit,
    claimTotalBeforeAdjustment,
    insuranceAdjustmentAmount,
    claimTotal,
    deductible,
    customerResponsibility,
    insuranceResponsibility,
    totalClaimValue,
    totalAmount,
    remainingBalance,
  };
}

function computePriceAnalysis(quote) {
  const ourQuote = computeTotals(quote).totalAmount;
  const competitorQuote = Number(quote.lostInfo?.competitorPrice || 0);
  const differenceAmount = ourQuote - competitorQuote;
  const differencePercent = ourQuote ? (differenceAmount / ourQuote) * 100 : 0;
  return { ourQuote, competitorQuote, differenceAmount, differencePercent };
}

function withTotals(quote) {
  if (!quote) return quote;
  return { ...quote, totals: computeTotals(quote), priceAnalysis: computePriceAnalysis(quote), intakeProgress: computeIntakeProgress(quote) };
}

async function listFromSql() {
  const r = await pool.query(
    "SELECT id, quote_no, status, customer_id, vehicle_year, vehicle_make, vehicle_model, vehicle_body_type FROM quotes"
  );
  return r.rows;
}

function compareQuote(json, sql) {
  const diffs = [];
  if ((json.status || "") !== (sql.status || "")) diffs.push(`status: '${json.status}' vs '${sql.status}'`);
  const jv = json.vehicle || {};
  if ((jv.year ?? "") != (sql.vehicle_year ?? "")) diffs.push(`vehicle.year: '${jv.year}' vs '${sql.vehicle_year}'`);
  if ((jv.make || "") !== (sql.vehicle_make || "")) diffs.push(`vehicle.make: '${jv.make}' vs '${sql.vehicle_make}'`);
  if ((jv.model || "") !== (sql.vehicle_model || "")) diffs.push(`vehicle.model: '${jv.model}' vs '${sql.vehicle_model}'`);
  return diffs.length ? diffs : null;
}

function sqlSourceActive() {
  return process.env.QUOTES_SOURCE === "sql";
}

function runShadow(result) {
  if (!isShadowEnabled(process.env.QUOTES_SOURCE)) return;
  shadowRead({
    label: "quotes",
    jsonResult: result,
    sqlQueryFn: listFromSql,
    matchKeyFn: (q) => q.quoteNo || q.quote_no,
    compareFn: compareQuote,
  }).catch(() => {});
}

async function list() {
  const jsonResult = quotes.filter((q) => q.active !== false).map(withTotals);
  runShadow(jsonResult);
  if (!sqlSourceActive()) return jsonResult;
  const r = await pool.query("SELECT * FROM quotes WHERE active <> false ORDER BY created_at");
  return r.rows.map(mapQuote).map(withTotals);
}

async function get(id) {
  if (sqlSourceActive()) {
    const r = await pool.query("SELECT * FROM quotes WHERE id = $1 AND active <> false", [id]);
    if (r.rows[0]) return withTotals(mapQuote(r.rows[0]));
  }
  const quote = quotes.find((q) => String(q.id) === String(id) && q.active !== false);
  return withTotals(quote);
}

function writeQuoteToSql(quote) {
  return pool.query(
    `INSERT INTO quotes (id, quote_no, status, payment_type, customer_id, agent_id, agent_name,
       vehicle_year, vehicle_make, vehicle_model, vehicle_body_type, vehicle_vin, part_number,
       nags_description, glass_cost, tax_rate, date, document_type, call_direction, name, zip_code,
       long_trip_fee, service_area, long_trip_required, distance_from_base, customer_type, customer_name,
       new_customer, insurance_company_id, policy_number, claim_number, appointment_date, start_time,
       end_time, glass_type, calibration_type, damage_notes, insurance, discount, insurance_adjustment,
       line_items, crm_photos, customer_photos, upsell, commission, paid_amount, cash_comeback,
       customer_suggested_price, payment, lost_info, intake_token, intake_token_expires_at, intake_sent_at,
       intake_opened_at, intake_completed_at, intake_photos, active, deleted_at, created_by, updated_by, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,
       $14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,
       $27,$28,$29,$30,$31,$32,$33,$34,$35,$36,$37,$38,$39,
       $40,$41,$42,$43,$44,$45,$46,$47,$48,$49,$50,$51,$52,
       $53,$54,$55,$56,$57,$58,$59,$60,$61)
     ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status, payment_type = EXCLUDED.payment_type,
       customer_id = EXCLUDED.customer_id, agent_id = EXCLUDED.agent_id, agent_name = EXCLUDED.agent_name,
       vehicle_year = EXCLUDED.vehicle_year, vehicle_make = EXCLUDED.vehicle_make, vehicle_model = EXCLUDED.vehicle_model,
       vehicle_body_type = EXCLUDED.vehicle_body_type, vehicle_vin = EXCLUDED.vehicle_vin, part_number = EXCLUDED.part_number,
       nags_description = EXCLUDED.nags_description, glass_cost = EXCLUDED.glass_cost, tax_rate = EXCLUDED.tax_rate,
       date = EXCLUDED.date, document_type = EXCLUDED.document_type, call_direction = EXCLUDED.call_direction,
       name = EXCLUDED.name, zip_code = EXCLUDED.zip_code, long_trip_fee = EXCLUDED.long_trip_fee,
       service_area = EXCLUDED.service_area, long_trip_required = EXCLUDED.long_trip_required,
       distance_from_base = EXCLUDED.distance_from_base, customer_type = EXCLUDED.customer_type,
       customer_name = EXCLUDED.customer_name, new_customer = EXCLUDED.new_customer,
       insurance_company_id = EXCLUDED.insurance_company_id, policy_number = EXCLUDED.policy_number,
       claim_number = EXCLUDED.claim_number, appointment_date = EXCLUDED.appointment_date,
       start_time = EXCLUDED.start_time, end_time = EXCLUDED.end_time, glass_type = EXCLUDED.glass_type,
       calibration_type = EXCLUDED.calibration_type, damage_notes = EXCLUDED.damage_notes,
       insurance = EXCLUDED.insurance, discount = EXCLUDED.discount, insurance_adjustment = EXCLUDED.insurance_adjustment,
       line_items = EXCLUDED.line_items, crm_photos = EXCLUDED.crm_photos, customer_photos = EXCLUDED.customer_photos,
       upsell = EXCLUDED.upsell, commission = EXCLUDED.commission, paid_amount = EXCLUDED.paid_amount,
       cash_comeback = EXCLUDED.cash_comeback, customer_suggested_price = EXCLUDED.customer_suggested_price,
       payment = EXCLUDED.payment, lost_info = EXCLUDED.lost_info, intake_token = EXCLUDED.intake_token,
       intake_token_expires_at = EXCLUDED.intake_token_expires_at, intake_sent_at = EXCLUDED.intake_sent_at,
       intake_opened_at = EXCLUDED.intake_opened_at, intake_completed_at = EXCLUDED.intake_completed_at,
       intake_photos = EXCLUDED.intake_photos, active = EXCLUDED.active, deleted_at = EXCLUDED.deleted_at,
       updated_by = EXCLUDED.updated_by, updated_at = EXCLUDED.updated_at`,
    [
      quote.id, quote.quoteNo, quote.status, quote.paymentType, quote.customerId, quote.agentId, quote.agentName,
      quote.vehicle?.year || "", quote.vehicle?.make || "", quote.vehicle?.model || "", quote.vehicle?.bodyType || "",
      quote.vehicle?.vin || "", quote.partNumber || "", quote.nagsDescription || "", quote.glassCost || 0,
      quote.taxRate || 0, quote.date || null, quote.documentType || "WorkOrder", quote.callDirection || "In",
      quote.name || "", quote.zipCode || "", quote.longTripFee || 0, quote.serviceArea !== false,
      !!quote.longTripRequired, quote.distanceFromBase || 0, quote.customerType || "Existing", quote.customerName || "",
      JSON.stringify(quote.newCustomer || {}), quote.insuranceCompanyId || null, quote.policyNumber || "",
      quote.claimNumber || "", quote.appointmentDate || null, quote.startTime || "", quote.endTime || "",
      quote.glassType || "", quote.calibrationType || "", quote.damageNotes || "", JSON.stringify(quote.insurance || {}),
      JSON.stringify(quote.discount || {}), JSON.stringify(quote.insuranceAdjustment || {}),
      JSON.stringify(quote.lineItems || []), JSON.stringify(quote.crmPhotos || []), JSON.stringify(quote.customerPhotos || []),
      quote.upsell || 0, quote.commission || 0, quote.paidAmount || 0, quote.cashComeback || 0,
      quote.customerSuggestedPrice || 0, JSON.stringify(quote.payment || {}), JSON.stringify(quote.lostInfo || {}),
      quote.intakeToken || null, quote.intakeTokenExpiresAt || null, quote.intakeSentAt || null,
      quote.intakeOpenedAt || null, quote.intakeCompletedAt || null, JSON.stringify(quote.intakePhotos || {}),
      quote.active !== false, quote.deletedAt || null, quote.createdBy || "System", quote.updatedBy || "System",
      quote.updatedAt || null,
    ]
  );
}

function syncQuoteToSql(quote) {
  if (!isDualWriteEnabled()) return Promise.resolve();
  return syncToSql({
    entity: "quotes",
    id: quote.id,
    businessKey: quote.quoteNo,
    sqlFn: () => writeQuoteToSql(quote),
  });
}

function getByIntakeToken(token) {
  const quote = quotes.find((q) => q.intakeToken === token);
  return withTotals(quote);
}

function normalizeLineItems(lineItems) {
  if (!Array.isArray(lineItems)) return [];
  return lineItems.map((li) => ({
    id: li.id ?? nextLineItemId++,
    jobType: li.jobType || "",
    partNumber: li.partNumber || "",
    nagsDescription: li.nagsDescription || "",
    calibrationType: li.calibrationType || "",
    priceTier: li.priceTier || "",
    pricePart: li.pricePart ?? 0,
    distributor: li.distributor || "",
    orderNumber: li.orderNumber || "",
  }));
}

async function create(data) {
  const num = await nextBusinessNumber({ pool, table: "quotes", column: "quote_no", jsonNextId: nextId });
  const quote = {
    id: crypto.randomUUID(),
    quoteNo: `Q-${pad(num)}`,
    status: data.status || "Draft",
    documentType: data.documentType === "Appointment" ? "Appointment" : "WorkOrder",
    paymentType: data.paymentType === "Insurance" ? "Insurance" : "Personal",
    callDirection: data.callDirection === "Out" ? "Out" : "In",
    name: data.name || "",
    date: data.date || new Date().toISOString().slice(0, 10),
    zipCode: data.zipCode || "",
    longTripFee: data.longTripFee ?? 0,
    serviceArea: data.serviceArea ?? true,
    longTripRequired: data.longTripRequired ?? false,
    distanceFromBase: data.distanceFromBase ?? 0,
    customerType: data.customerType === "New" ? "New" : "Existing",
    customerId: data.customerId ?? null,
    customerName: data.customerName || "",
    newCustomer: {
      firstName: data.newCustomer?.firstName || "",
      lastName: data.newCustomer?.lastName || "",
      phone: data.newCustomer?.phone || "",
      phoneAlt: data.newCustomer?.phoneAlt || "",
      email: data.newCustomer?.email || "",
      address: data.newCustomer?.address || "",
      addressType: data.newCustomer?.addressType || "",
      unitNumber: data.newCustomer?.unitNumber || "",
      city: data.newCustomer?.city || "",
      state: data.newCustomer?.state || "",
    },
    insuranceCompanyId: data.insuranceCompanyId ?? null,
    agentId: data.agentId ?? null,
    agentName: data.agentName || "",
    policyNumber: data.policyNumber || "",
    claimNumber: data.claimNumber || "",
    appointmentDate: data.appointmentDate || "",
    startTime: data.startTime || "",
    endTime: data.endTime || "",
    vehicle: {
      year: data.vehicle?.year || "",
      make: data.vehicle?.make || "",
      model: data.vehicle?.model || "",
      bodyType: data.vehicle?.bodyType || "",
      vin: data.vehicle?.vin || "",
      plate: data.vehicle?.plate || "",
    },
    glassType: data.glassType || "",
    partNumber: data.partNumber || "",
    nagsDescription: data.nagsDescription || "",
    glassCost: data.glassCost ?? 0,
    calibrationType: data.calibrationType || "",
    damageNotes: data.damageNotes || "",
    insurance: {
      listPrice: data.insurance?.listPrice ?? 0,
      nagsRate: data.insurance?.nagsRate ?? 0,
      pricePartInsurance: data.insurance?.pricePartInsurance ?? 0,
      nagsLaborHour: data.insurance?.nagsLaborHour ?? 0,
      priceForHour: data.insurance?.priceForHour ?? 0,
      totalLabor: data.insurance?.totalLabor ?? 0,
      flatRateKit: data.insurance?.flatRateKit ?? 0,
      deductible: data.insurance?.deductible ?? 0,
    },
    discount: {
      type: data.discount?.type === "Fixed" ? "Fixed" : "Percentage",
      value: data.discount?.value ?? 0,
      reason: data.discount?.reason || "",
    },
    insuranceAdjustment: {
      amount: data.insuranceAdjustment?.amount ?? 0,
      notes: data.insuranceAdjustment?.notes || "",
    },
    lineItems: normalizeLineItems(data.lineItems),
    crmPhotos: Array.isArray(data.crmPhotos) ? data.crmPhotos : [],
    customerPhotos: Array.isArray(data.customerPhotos) ? data.customerPhotos : [],
    taxRate: data.taxRate ?? 0,
    upsell: data.upsell ?? 0,
    commission: data.commission ?? 0,
    paidAmount: data.paidAmount ?? 0,
    cashComeback: data.cashComeback ?? 0,
    customerSuggestedPrice: data.customerSuggestedPrice ?? 0,
    payment: {
      method: data.payment?.method || "",
      cardNumber: data.payment?.cardNumber || "",
      expirationDate: data.payment?.expirationDate || "",
      cvv: data.payment?.cvv || "",
      zipCode: data.payment?.zipCode || "",
      firstName: data.payment?.firstName || "",
      lastName: data.payment?.lastName || "",
      amount: data.payment?.amount ?? 0,
      authorizationId: data.payment?.authorizationId || "",
    },
    lostInfo: {
      reasonForLoss: data.lostInfo?.reasonForLoss || "",
      competitorName: data.lostInfo?.competitorName || "",
      competitorPhone: data.lostInfo?.competitorPhone || "",
      competitorPrice: data.lostInfo?.competitorPrice ?? 0,
      competitorWarranty: data.lostInfo?.competitorWarranty || "",
      competitorNotes: data.lostInfo?.competitorNotes || "",
      competitorCaptureDate: data.lostInfo?.competitorCaptureDate || "",
      customerBudget: data.lostInfo?.customerBudget ?? 0,
      customerComments: data.lostInfo?.customerComments || "",
      canMatchPrice: data.lostInfo?.canMatchPrice || "",
      potentialMargin: data.lostInfo?.potentialMargin ?? 0,
      leadResellCandidate: data.lostInfo?.leadResellCandidate || "",
      partnerCompanyId: data.lostInfo?.partnerCompanyId ?? null,
      salePrice: data.lostInfo?.salePrice ?? 0,
      leadStatus: data.lostInfo?.leadStatus || "",
      contactDate: data.lostInfo?.contactDate || "",
      leadOutcome: data.lostInfo?.leadOutcome || "",
      followUpDate: data.lostInfo?.followUpDate || "",
      notes: data.lostInfo?.notes || "",
    },
    intakeToken: null,
    intakeTokenExpiresAt: null,
    intakeSentAt: null,
    intakeOpenedAt: null,
    intakeCompletedAt: null,
    intakePhotos: {
      driverSide: [],
      passengerSide: [],
      front: [],
      rear: [],
      damageArea: [],
      insuranceCard: [],
    },
    active: true,
    deletedAt: null,
    createdBy: data.createdBy || data.agentName || "System",
    updatedBy: data.createdBy || data.agentName || "System",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  quotes.push(quote);
  nextId = Math.max(nextId, num) + 1;
  persist();
  if (sqlSourceActive()) {
    await writeQuoteToSql(quote);
  } else {
    syncQuoteToSql(quote).catch(() => {});
  }
  return withTotals(quote);
}

async function update(id, data) {
  const quote = quotes.find((q) => String(q.id) === String(id) && q.active !== false);
  if (!quote) return null;

  Object.assign(quote, {
    status: data.status ?? quote.status,
    documentType: data.documentType ?? quote.documentType,
    paymentType: data.paymentType ?? quote.paymentType,
    callDirection: data.callDirection ?? quote.callDirection,
    name: data.name ?? quote.name,
    date: data.date ?? quote.date,
    zipCode: data.zipCode ?? quote.zipCode,
    longTripFee: data.longTripFee ?? quote.longTripFee,
    serviceArea: data.serviceArea ?? quote.serviceArea,
    longTripRequired: data.longTripRequired ?? quote.longTripRequired,
    distanceFromBase: data.distanceFromBase ?? quote.distanceFromBase,
    customerType: data.customerType ?? quote.customerType,
    customerId: data.customerId ?? quote.customerId,
    customerName: data.customerName ?? quote.customerName,
    newCustomer: { ...quote.newCustomer, ...data.newCustomer },
    insuranceCompanyId: data.insuranceCompanyId ?? quote.insuranceCompanyId,
    agentId: data.agentId !== undefined ? data.agentId : quote.agentId,
    agentName: data.agentName ?? quote.agentName,
    policyNumber: data.policyNumber ?? quote.policyNumber,
    claimNumber: data.claimNumber ?? quote.claimNumber,
    appointmentDate: data.appointmentDate ?? quote.appointmentDate,
    startTime: data.startTime ?? quote.startTime,
    endTime: data.endTime ?? quote.endTime,
    vehicle: { ...quote.vehicle, ...data.vehicle },
    glassType: data.glassType ?? quote.glassType,
    partNumber: data.partNumber ?? quote.partNumber,
    nagsDescription: data.nagsDescription ?? quote.nagsDescription,
    glassCost: data.glassCost ?? quote.glassCost,
    calibrationType: data.calibrationType ?? quote.calibrationType,
    damageNotes: data.damageNotes ?? quote.damageNotes,
    insurance: { ...quote.insurance, ...data.insurance },
    discount: { ...quote.discount, ...data.discount },
    insuranceAdjustment: { ...quote.insuranceAdjustment, ...data.insuranceAdjustment },
    lineItems: data.lineItems ? normalizeLineItems(data.lineItems) : quote.lineItems,
    crmPhotos: Array.isArray(data.crmPhotos) ? data.crmPhotos : quote.crmPhotos,
    customerPhotos: Array.isArray(data.customerPhotos) ? data.customerPhotos : quote.customerPhotos,
    taxRate: data.taxRate ?? quote.taxRate,
    upsell: data.upsell ?? quote.upsell,
    commission: data.commission ?? quote.commission,
    paidAmount: data.paidAmount ?? quote.paidAmount,
    cashComeback: data.cashComeback ?? quote.cashComeback,
    customerSuggestedPrice: data.customerSuggestedPrice ?? quote.customerSuggestedPrice,
    payment: { ...quote.payment, ...data.payment },
    lostInfo: { ...quote.lostInfo, ...data.lostInfo },
    updatedBy: data.updatedBy || quote.updatedBy,
    updatedAt: new Date().toISOString(),
  });

  persist();
  if (sqlSourceActive()) {
    await writeQuoteToSql(quote);
  } else {
    syncQuoteToSql(quote).catch(() => {});
  }
  return withTotals(quote);
}

async function sendIntake(id, { expiresInDays } = {}) {
  const quote = quotes.find((q) => String(q.id) === String(id));
  if (!quote) return null;

  const days = Number(expiresInDays) > 0 ? Number(expiresInDays) : 7;
  quote.intakeToken = genIntakeToken();
  quote.intakeTokenExpiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
  quote.intakeSentAt = new Date().toISOString();
  quote.intakeOpenedAt = null;
  quote.intakeCompletedAt = null;
  if (quote.status === "Draft") quote.status = "Waiting Customer";

  persist();
  if (sqlSourceActive()) {
    await writeQuoteToSql(quote);
  } else {
    syncQuoteToSql(quote).catch(() => {});
  }
  return withTotals(quote);
}

function isIntakeTokenValid(quote) {
  if (!quote || !quote.intakeToken) return false;
  if (!quote.intakeTokenExpiresAt) return true;
  return new Date(quote.intakeTokenExpiresAt).getTime() > Date.now();
}

async function markIntakeOpened(token) {
  const quote = quotes.find((q) => q.intakeToken === token);
  if (!quote || !isIntakeTokenValid(quote)) return null;

  if (!quote.intakeOpenedAt) quote.intakeOpenedAt = new Date().toISOString();

  persist();
  if (sqlSourceActive()) {
    await writeQuoteToSql(quote);
  } else {
    syncQuoteToSql(quote).catch(() => {});
  }
  return withTotals(quote);
}

async function submitIntake(token, data) {
  const quote = quotes.find((q) => q.intakeToken === token);
  if (!quote || !isIntakeTokenValid(quote)) return null;

  const nc = data.newCustomer || {};
  quote.newCustomer = {
    ...quote.newCustomer,
    firstName: nc.firstName ?? quote.newCustomer.firstName,
    lastName: nc.lastName ?? quote.newCustomer.lastName,
    phone: nc.phone ?? quote.newCustomer.phone,
    phoneAlt: nc.phoneAlt ?? quote.newCustomer.phoneAlt,
    email: nc.email ?? quote.newCustomer.email,
    address: nc.address ?? quote.newCustomer.address,
    addressType: nc.addressType ?? quote.newCustomer.addressType,
    unitNumber: nc.unitNumber ?? quote.newCustomer.unitNumber,
    city: nc.city ?? quote.newCustomer.city,
    state: nc.state ?? quote.newCustomer.state,
  };
  quote.zipCode = data.zipCode ?? quote.zipCode;
  quote.vehicle = { ...quote.vehicle, ...data.vehicle };
  quote.insuranceCompanyId = data.insuranceCompanyId !== undefined ? data.insuranceCompanyId : quote.insuranceCompanyId;
  quote.policyNumber = data.policyNumber ?? quote.policyNumber;
  quote.claimNumber = data.claimNumber ?? quote.claimNumber;
  quote.glassType = data.glassType ?? quote.glassType;
  quote.damageNotes = data.damageNotes ?? quote.damageNotes;
  if (data.intakePhotos) {
    quote.intakePhotos = { ...quote.intakePhotos, ...data.intakePhotos };
  }

  // Sync a real Customer record so future quotes can reuse it (no manual re-entry).
  const customerData = {
    firstName: quote.newCustomer.firstName,
    lastName: quote.newCustomer.lastName,
    phone: quote.newCustomer.phone,
    phoneAlt: quote.newCustomer.phoneAlt,
    email: quote.newCustomer.email,
    address: quote.newCustomer.address,
    addressType: quote.newCustomer.addressType,
    unitNumber: quote.newCustomer.unitNumber,
    city: quote.newCustomer.city,
    state: quote.newCustomer.state,
    zipCode: quote.zipCode,
    vehicle: quote.vehicle,
  };
  const customer = quote.customerId
    ? await customersStore.update(quote.customerId, customerData)
    : await customersStore.create(customerData);
  quote.customerId = customer.id;
  quote.customerType = "Existing";
  quote.customerName = customer.name;

  quote.status = "Ready For Review";
  if (!quote.intakeCompletedAt) quote.intakeCompletedAt = new Date().toISOString();

  persist();
  if (sqlSourceActive()) {
    await writeQuoteToSql(quote);
  } else {
    syncQuoteToSql(quote).catch(() => {});
  }
  return withTotals(quote);
}

async function remove(id) {
  const quote = quotes.find((q) => String(q.id) === String(id) && q.active !== false);
  if (!quote) return false;
  quote.active = false;
  quote.deletedAt = new Date().toISOString();
  persist();
  if (sqlSourceActive()) {
    await pool.query("UPDATE quotes SET active = false, deleted_at = $2 WHERE id = $1", [quote.id, quote.deletedAt]);
  } else if (isDualWriteEnabled()) {
    syncToSql({
      entity: "quotes",
      id: quote.id,
      businessKey: quote.quoteNo,
      sqlFn: () => pool.query("DELETE FROM quotes WHERE id = $1", [quote.id]),
    }).catch(() => {});
  }
  return true;
}

async function markConverted(id) {
  const quote = quotes.find((q) => String(q.id) === String(id));
  if (!quote) return null;
  quote.status = "Converted";
  persist();
  if (sqlSourceActive()) {
    await writeQuoteToSql(quote);
  } else {
    syncQuoteToSql(quote).catch(() => {});
  }
  return withTotals(quote);
}

module.exports = {
  list,
  get,
  create,
  update,
  remove,
  markConverted,
  getByIntakeToken,
  sendIntake,
  markIntakeOpened,
  submitIntake,
  listFromSql,
};
