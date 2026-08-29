const crypto = require("crypto");
const customersStore = require("./customers.store");
const calibrationTypesStore = require("./calibrationTypes.store");
const priceTiersStore = require("./priceTiers.store");
const jobTypesStore = require("./jobTypes.store");
const pool = require("../config/db");
const { mapQuote } = require("../lib/sqlMappers");
const { validateInsuranceAttachments, validateIntakePhotos } = require("../lib/mediaValidation");
const listCache = require("../lib/listCache");

function pad(n) {
  return String(n).padStart(4, "0");
}

function genIntakeToken() {
  return crypto.randomBytes(16).toString("hex");
}

// Historical synthesized records (Q-0001..Q-3865) already occupy that number range —
// new quotes must continue past the highest one either side has ever used.
async function nextQuoteNumber() {
  const r = await pool.query(
    "SELECT COALESCE(MAX((regexp_replace(quote_no, '\\D', '', 'g'))::int), 0) AS max_num FROM quotes"
  );
  return (Number(r.rows[0] && r.rows[0].max_num) || 0) + 1;
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
  // Personal quotes have no dedicated labor field (that's Insurance-only, via insurance.totalLabor
  // below) — labor gets captured as an ordinary line item tagged jobType "Labor" instead. Broken
  // out here purely for display (Financial Summary shows Part Price and Labor separately); it's
  // already included in subtotalParts/subtotal, so this isn't a second addend anywhere in the math.
  const laborLineItemTotal = lineItems.reduce((sum, li) => sum + (li.jobType === "Labor" ? Number(li.pricePart || 0) : 0), 0);
  const nonLaborPartsTotal = subtotalParts - laborLineItemTotal;
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
  const isItemized = quote.invoiceMode === "itemized";
  // Itemized mode taxes only line items snapshotted is_taxable=true (Parts/Molding, typically)
  // — subtotalServices/priceTierTotal/longTripFee are labor-like and stay exempt either way.
  // The discount is not prorated into this base: it still reduces personalTotal via subtotal,
  // it just doesn't shrink what tax is computed on.
  const taxableItemBase = lineItems.reduce(
    (sum, li) => sum + (li.isTaxable !== false ? Number(li.pricePart || 0) : 0),
    0
  );
  const personalTaxAmount = (isItemized ? taxableItemBase : subtotal) * (Number(quote.taxRate || 0) / 100);
  const personalTotal = subtotal + personalTaxAmount;

  // Insurance branch: NAGS-referenced claim value, adjusted, then split between what the
  // insurer owes and what the customer owes (the deductible). Tax only applies in itemized
  // mode (lump-sum insurance claims stay untaxed, matching historical behavior) and only on
  // the Parts/Kit-like components — labor and calibration stay exempt.
  const insuranceTaxAmount = isItemized ? (pricePartInsurance + flatRateKit) * (Number(quote.taxRate || 0) / 100) : 0;
  const claimTotalBeforeAdjustment = pricePartInsurance + laborTotal + flatRateKit + subtotalServices;
  const insuranceAdjustmentAmount = Number(quote.insuranceAdjustment?.amount || 0);
  const claimTotal = claimTotalBeforeAdjustment + insuranceAdjustmentAmount + insuranceTaxAmount;
  const deductible = Number(quote.insurance?.deductible || 0);
  const customerResponsibility = deductible;
  const insuranceResponsibility = claimTotal - deductible;
  const totalClaimValue = claimTotal;

  const isInsurance = quote.paymentType === "Insurance";
  const totalAmount = isInsurance ? totalClaimValue : personalTotal;
  // Unified for display: whichever branch is active, this is "the" tax charged on this quote.
  const taxAmount = isInsurance ? insuranceTaxAmount : personalTaxAmount;

  // The Part Price is a pass-through: the customer pays it (revenue — it's already inside
  // subtotalParts above) and we owe the same figure to the distributor (cost). Our actual margin
  // on the glass is the price tier, not this. Deliberately uses subtotalParts rather than
  // nonLaborPartsTotal: the historical glass_cost column includes "Labor"-tagged line items too
  // (verified — sum over all line items reproduces glass_cost exactly across 3,272 records), and
  // matching that column is worth more than the nuance that 48 items / $243.25 of it isn't
  // literally a distributor payable.
  const partCost = subtotalParts;

  // Upsell = rounding the price up at collection time. Stored on the quote (the same column the
  // 2,897 historical records use); the UI edits it indirectly through "final sale price", which
  // is just totalAmount + upsell. It is margin with no cost attached, so it flows straight to
  // gross profit.
  const upsell = Number(quote.upsell || 0);
  const finalSalePrice = totalAmount + upsell;

  const paidAmount = Number(quote.paidAmount || 0);
  // Never negative in either direction: overpayment is either upsell (already in finalSalePrice)
  // or cash handed back, never a negative amount owed.
  const remainingBalance = Math.max(0, finalSalePrice - paidAmount);
  const changeDue = Math.max(0, paidAmount - finalSalePrice);

  // Quote-level gross profit only knows the part cost — agent commission and technician labor are
  // work-order fields and get subtracted in the Work Order's own panel. Kept separate on purpose
  // so a quote that never converts doesn't imply costs that were never incurred.
  // Agent commission is deliberately NOT derived here — it's entered by hand on the work order
  // and lives in work_orders.commission. The historical figures are flat per-job amounts ($15,
  // $15.99, $10, $20, $30) that no percentage reproduces, and a bulk import of real per-order
  // commissions is planned, so any computed suggestion would just be noise to overwrite.
  const grossProfit = finalSalePrice - partCost;
  const profitMargin = finalSalePrice ? (grossProfit / finalSalePrice) * 100 : 0;

  return {
    subtotalParts,
    laborLineItemTotal,
    nonLaborPartsTotal,
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
    partCost,
    upsell,
    finalSalePrice,
    remainingBalance,
    changeDue,
    grossProfit,
    profitMargin,
  };
}

function computePriceAnalysis(quote) {
  const ourQuote = computeTotals(quote).totalAmount;
  const competitorQuote = Number(quote.lostInfo?.competitorPrice || 0);
  const differenceAmount = ourQuote - competitorQuote;
  const differencePercent = ourQuote ? (differenceAmount / ourQuote) * 100 : 0;
  return { ourQuote, competitorQuote, differenceAmount, differencePercent };
}

// The P&L report reads its cost side off work_orders, never off the quote — so the derived part
// cost has to land on the work order or the report keeps seeing $0 for every job.
//
// This lives in the store, not in the Work Order page's save handler, on purpose: that handler
// only fires when the quote is edited from inside the work order. Editing the very same quote
// from the Quotes list ran no sync at all, leaving the work order (and every report) pinned to a
// $0 part cost forever. Doing it here covers every path — both screens, the intake flow, and any
// future API caller.
//
// Raw SQL rather than workOrdersStore.update() to avoid a circular require (workorders.store
// already requires this module), and because this deliberately writes exactly two columns.
// commission and labor_cost are untouched: those are hand-entered on the work order and the
// quote has no opinion about them.
async function syncPricingToWorkOrder(quote) {
  const totals = computeTotals(quote);
  await pool.query(
    `UPDATE work_orders SET glass_cost = $2, total_sale = $3, updated_at = now()
       WHERE quote_id = $1 AND active <> false`,
    [quote.id, totals.partCost, totals.finalSalePrice]
  );
  listCache.invalidate("workorders");
}

// Cobrar mas de lo que costaba el trabajo es un upsell: el precio se redondeo hacia arriba en el
// momento de cobrar. Eso ya estaba escrito como el modelo correcto en el panel de pagos ("recorded
// on the quote's final sale price, which raises totalSale so there's no gap at all"), pero habia que
// teclear a mano el Final Sale Price para que ocurriera. Si nadie lo hacia, la orden se quedaba con
// un saldo negativo en pantalla y el margen extra no aparecia en ningun sitio: ni en el resumen de
// la cotizacion, ni en el P&L, que lee finalSalePrice.
//
// Lo cobrado es el importe MENOS el cambio devuelto: pagar de mas y recibir vuelto no es un upsell,
// es la otra rama que el mismo comentario ya distinguia (payment.cashComeback).
//
// Solo sube, nunca baja. Un pago parcial no puede borrar un upsell puesto a mano, y un cobro que no
// llega al total no tiene por que tocar el precio. Para bajarlo esta el campo Final Sale Price.
//
// Escritura directa y no update(): update() dispara la confirmacion de "esta orden ya esta pagada"
// -que es justo el caso, siempre- y ahi no hay nadie a quien preguntar. Ademas esto no es un cambio
// de precio decidido por una persona, es el registro de lo que se cobro.
// `preloaded` evita releer la cotización cuando quien llama (workorders.update) ya la tiene.
async function recordOverpaymentAsUpsell(quoteId, collected, preloaded) {
  if (!quoteId) return null;
  const quote = preloaded || (await get(quoteId));
  if (!quote) return null;

  const totals = computeTotals(quote);
  if (toCents(collected) <= toCents(totals.finalSalePrice)) return null;

  // Una cotizacion sin precio calculado no tiene un total que superar: cobrar $500 contra ella no es
  // haber vendido por encima, es que nadie le puso las lineas. Son 258 esqueletos del import de
  // agosto, $47,566 entre todas; meterlos en la categoria "upsell" distorsionaria el analisis de
  // margen, y el ingreso que les falta se arregla poniendoles el precio, no etiquetandolo mal.
  // scripts/backfill-overpayment-upsell.js traza la misma linea con --only-priced.
  if (toCents(totals.totalAmount) <= 0) return null;

  // Contra totalAmount (el total calculado, sin upsell) y no contra finalSalePrice: sumar la
  // diferencia sobre el precio final ya subido daria un upsell distinto cada vez que se guardara.
  const upsell = toCents(collected - totals.totalAmount) / 100;
  const finalSalePrice = toCents(collected) / 100;

  await pool.query("UPDATE quotes SET upsell = $2, updated_at = now() WHERE id = $1", [quoteId, upsell]);
  await pool.query(
    `UPDATE work_orders SET total_sale = $2, updated_at = now()
       WHERE quote_id = $1 AND active <> false`,
    [quoteId, finalSalePrice]
  );
  listCache.invalidate("quotes", "workorders");

  console.log(
    `[quotes] ${quote.quoteNo}: cobrado ${finalSalePrice} sobre un total de ${totals.totalAmount}, ` +
      `upsell ${totals.upsell} -> ${upsell}`
  );
  return { previousUpsell: totals.upsell, upsell, finalSalePrice };
}

// Saving a quote is allowed to reprice its work order even after that order is Paid or Closed.
// That is deliberate: historical figures get corrected in bulk, the quote is the single place to
// correct them, and making paid orders immutable would mean editing the same number in two
// places. What is not allowed is doing it silently — this money has already been collected. So
// update() refuses the first attempt and hands back the old and the new figure for the UI to show
// (nothing is written), and a caller that comes back confirmed goes through and leaves an audit row.
const PRICE_LOCKED_STATUSES = ["Paid", "Closed"];

class PaidWorkOrderPriceChangeError extends Error {
  constructor(details) {
    super("This quote is linked to a work order that has already been paid or closed.");
    this.name = "PaidWorkOrderPriceChangeError";
    this.code = "PAID_WORK_ORDER_PRICE_CHANGE";
    this.details = details;
  }
}

function toCents(n) {
  return Math.round(Number(n || 0) * 100);
}

// Returns what the confirmation needs to say, or null when there is nothing to warn about: no
// linked order, an order that is still open, or a save that leaves the sale price alone. That last
// case matters — fixing a typo in the damage notes on a paid job must not raise a money warning.
// Compared in cents so float noise on an unchanged price can't trigger the dialog.
//
// Only the sale price is guarded. partCost also gets overwritten by the sync, but the warning is
// about money already collected from the customer, and showing "from $500 to $500" because a cost
// moved underneath would train people to click through it.
async function detectPaidWorkOrderPriceChange(quote) {
  const r = await pool.query(
    `SELECT id, work_order_no, status, total_sale FROM work_orders
       WHERE quote_id = $1 AND active <> false ORDER BY created_at LIMIT 1`,
    [quote.id]
  );
  const workOrder = r.rows[0];
  if (!workOrder || !PRICE_LOCKED_STATUSES.includes(workOrder.status)) return null;

  const oldPrice = Number(workOrder.total_sale) || 0;
  const newPrice = computeTotals(quote).finalSalePrice;
  if (toCents(oldPrice) === toCents(newPrice)) return null;

  return {
    quoteId: quote.id,
    quoteNo: quote.quoteNo || "",
    workOrderId: workOrder.id,
    workOrderNo: workOrder.work_order_no || "",
    workOrderStatus: workOrder.status,
    oldPrice,
    newPrice: toCents(newPrice) / 100,
  };
}

// Durable on purpose (a table, not just a log line): the whole point is to be able to look back in
// a few months and count how often this happens by accident. The console line is for tailing logs
// in the moment. A failed audit insert is never allowed to fail the save — by the time this runs
// the quote and the work order are both already written and consistent.
async function logPaidWorkOrderPriceChange(details, actor) {
  console.warn(
    `[quotes] Repriced ${details.workOrderStatus} work order ${details.workOrderNo} from ` +
      `${details.oldPrice} to ${details.newPrice} via quote ${details.quoteNo} — confirmed by ${actor || "Unknown"}`
  );
  try {
    await pool.query(
      `INSERT INTO paid_work_order_price_changes
         (quote_id, quote_no, work_order_id, work_order_no, work_order_status, old_price, new_price, changed_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        String(details.quoteId),
        details.quoteNo,
        String(details.workOrderId),
        details.workOrderNo,
        details.workOrderStatus,
        details.oldPrice,
        details.newPrice,
        actor || null,
      ]
    );
  } catch (err) {
    console.error("[quotes] Failed to record paid-work-order price change:", err.message);
  }
}

function withTotals(quote) {
  if (!quote) return quote;
  return { ...quote, totals: computeTotals(quote), priceAnalysis: computePriceAnalysis(quote), intakeProgress: computeIntakeProgress(quote) };
}

// Excludes crm_photos/customer_photos/intake_photos/insurance_attachments — this is the query
// behind every list-page fetch (query() filters/sorts in-memory over what list() already pulled),
// so those blob columns would otherwise ride along on every quote regardless of whether they're
// ever populated. get(id) below keeps SELECT * for the single-record detail view, where they're needed.
// Cacheada (ver lib/listCache): la piden la lista de cotizaciones, el filtro por agente de las
// órdenes y varios reportes, y la base está remota. Toda escritura de este store invalida.
function list() {
  return listCache.get("quotes", listFromSql);
}

async function listFromSql() {
  const r = await pool.query(
    `SELECT id, quote_no, status, payment_type, customer_id, agent_id, agent_name,
       vehicle_year, vehicle_make, vehicle_model, vehicle_body_type, vehicle_vin, part_number,
       nags_description, glass_cost, tax_rate, date, document_type, call_direction, name, zip_code,
       long_trip_fee, service_area, long_trip_required, distance_from_base, customer_type, customer_name,
       new_customer, insurance_company_id, policy_number, claim_number, appointment_date, start_time,
       end_time, glass_type, calibration_type, damage_notes, insurance, discount, insurance_adjustment,
       line_items, upsell, commission, paid_amount, cash_comeback,
       customer_suggested_price, payment, lost_info, intake_token, intake_token_expires_at, intake_sent_at,
       intake_opened_at, intake_completed_at, active, deleted_at, created_by, updated_by, created_at, updated_at,
       invoice_mode, state
     FROM quotes WHERE active <> false ORDER BY created_at`
  );
  return r.rows.map(mapQuote).map(withTotals);
}

async function get(id) {
  const r = await pool.query("SELECT * FROM quotes WHERE id = $1 AND active <> false", [id]);
  if (!r.rows[0]) return null;
  return withTotals(mapQuote(r.rows[0]));
}

// Un id que falta tiene que llegar a Postgres como NULL, nunca como cadena vacía.
//
// customer_id es uuid y agent_id es integer. Una cotización de cliente NUEVO no tiene customerId
// -el formulario lo deja en ""- y una sin agente deja agentId igual, así que la inserción intentaba
// convertir "" a uuid y reventaba con
//   invalid input syntax for type uuid: ""
// que sale al usuario como "Internal server error" al pulsar Guardar. Era exactamente eso: no un
// fallo de validación ni de permisos, sino un tipo que Postgres no puede leer.
//
// El 0 sí se conserva: es un id válido en integer, y solo la cadena vacía y undefined son "sin id".
function idOrNull(v) {
  return v === "" || v === undefined ? null : v;
}

async function writeQuoteToSql(quote) {
  const result = await pool.query(
    `INSERT INTO quotes (id, quote_no, status, payment_type, customer_id, agent_id, agent_name,
       vehicle_year, vehicle_make, vehicle_model, vehicle_body_type, vehicle_vin, part_number,
       nags_description, glass_cost, tax_rate, date, document_type, call_direction, name, zip_code,
       long_trip_fee, service_area, long_trip_required, distance_from_base, customer_type, customer_name,
       new_customer, insurance_company_id, policy_number, claim_number, appointment_date, start_time,
       end_time, glass_type, calibration_type, damage_notes, insurance, discount, insurance_adjustment,
       line_items, crm_photos, customer_photos, upsell, commission, paid_amount, cash_comeback,
       customer_suggested_price, payment, lost_info, intake_token, intake_token_expires_at, intake_sent_at,
       intake_opened_at, intake_completed_at, intake_photos, active, deleted_at, created_by, updated_by, updated_at,
       invoice_mode, state, insurance_attachments)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,
       $14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,
       $27,$28,$29,$30,$31,$32,$33,$34,$35,$36,$37,$38,$39,
       $40,$41,$42,$43,$44,$45,$46,$47,$48,$49,$50,$51,$52,
       $53,$54,$55,$56,$57,$58,$59,$60,$61,$62,$63,$64)
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
       updated_by = EXCLUDED.updated_by, updated_at = EXCLUDED.updated_at, invoice_mode = EXCLUDED.invoice_mode,
       state = EXCLUDED.state, insurance_attachments = EXCLUDED.insurance_attachments`,
    [
      quote.id, quote.quoteNo, quote.status, quote.paymentType, idOrNull(quote.customerId), idOrNull(quote.agentId), quote.agentName,
      quote.vehicle?.year || "", quote.vehicle?.make || "", quote.vehicle?.model || "", quote.vehicle?.bodyType || "",
      quote.vehicle?.vin || "", quote.partNumber || "", quote.nagsDescription || "", quote.glassCost || 0,
      quote.taxRate || 0, quote.date || null, quote.documentType || "WorkOrder", quote.callDirection || "In",
      quote.name || "", quote.zipCode || "", quote.longTripFee || 0, quote.serviceArea !== false,
      !!quote.longTripRequired, quote.distanceFromBase || 0, quote.customerType || "Existing", quote.customerName || "",
      JSON.stringify(quote.newCustomer || {}), idOrNull(quote.insuranceCompanyId), quote.policyNumber || "",
      quote.claimNumber || "", quote.appointmentDate || null, quote.startTime || "", quote.endTime || "",
      quote.glassType || "", quote.calibrationType || "", quote.damageNotes || "", JSON.stringify(quote.insurance || {}),
      JSON.stringify(quote.discount || {}), JSON.stringify(quote.insuranceAdjustment || {}),
      JSON.stringify(quote.lineItems || []), JSON.stringify(quote.crmPhotos || []), JSON.stringify(quote.customerPhotos || []),
      quote.upsell || 0, quote.commission || 0, quote.paidAmount || 0, quote.cashComeback || 0,
      quote.customerSuggestedPrice || 0, JSON.stringify(quote.payment || {}), JSON.stringify(quote.lostInfo || {}),
      quote.intakeToken || null, quote.intakeTokenExpiresAt || null, quote.intakeSentAt || null,
      quote.intakeOpenedAt || null, quote.intakeCompletedAt || null, JSON.stringify(quote.intakePhotos || {}),
      quote.active !== false, quote.deletedAt || null, quote.createdBy || "System", quote.updatedBy || "System",
      quote.updatedAt || null, quote.invoiceMode || "lump_sum", quote.state || "",
      JSON.stringify(quote.insuranceAttachments || []),
    ]
  );
  // La lista de órdenes deriva columnas de la cotización (agent_name, distribuidores de las
  // líneas...), así que un guardado aquí invalida las dos cachés.
  listCache.invalidate("quotes", "workorders");
  return result;
}

// La orden de trabajo que salio de esta cotizacion, si ya existe. La relacion vive en
// work_orders.quote_id, asi que la cotizacion por si sola no puede decir "ya tengo orden": la
// pantalla mostraba el enlace a la orden solo en el instante de convertir, y lo perdia al recargar.
//
// Consulta aparte y no un JOIN dentro de get() porque get() se llama en cada guardado, en el intake
// y dentro del propio convert; este dato solo lo necesita la pantalla de la cotizacion.
async function getLinkedWorkOrder(quoteId) {
  const r = await pool.query(
    `SELECT id, work_order_no, status FROM work_orders
       WHERE quote_id = $1 AND active <> false ORDER BY created_at LIMIT 1`,
    [quoteId]
  );
  const row = r.rows[0];
  if (!row) return null;
  return { id: row.id, workOrderNo: row.work_order_no || "", status: row.status };
}

async function getByIntakeToken(token) {
  const r = await pool.query("SELECT * FROM quotes WHERE intake_token = $1", [token]);
  if (!r.rows[0]) return null;
  return withTotals(mapQuote(r.rows[0]));
}

function normalizeLineItems(lineItems) {
  if (!Array.isArray(lineItems)) return [];
  return lineItems.map((li) => ({
    id: li.id ?? crypto.randomUUID(),
    jobType: li.jobType || "",
    partNumber: li.partNumber || "",
    nagsDescription: li.nagsDescription || "",
    calibrationType: li.calibrationType || "",
    priceTier: li.priceTier || "",
    pricePart: li.pricePart ?? 0,
    distributor: li.distributor || "",
    orderNumber: li.orderNumber || "",
    // Snapshotted at save time so a later edit to the Job Type catalog doesn't retroactively
    // change a past quote's tax. Falls back to a fresh catalog lookup only when the caller
    // didn't already send a snapshot (e.g. direct API calls, pre-feature data).
    isTaxable: li.isTaxable !== undefined ? !!li.isTaxable : jobTypesStore.findByName(li.jobType)?.isTaxable !== false,
    // Traídos del export de AppSheet (scripts/import-appsheet-detail.js). Se guardan y se muestran,
    // y deliberadamente NO entran en computeTotals() ni en el P&L — son datos del sistema anterior
    // que todavía no tienen una decisión de negocio detrás.
    //
    // Están acá porque esta función reconstruye cada line item desde cero: una clave que no figure
    // en esta lista se descarta en silencio la próxima vez que alguien guarde el quote. El import
    // habría escrito $847,600 de price tier que se evaporaban al primer save, sin error ni aviso.
    priceTierAmount: li.priceTierAmount ?? 0,
    laborCharged: li.laborCharged ?? 0,
    servicesAmount: li.servicesAmount ?? 0,
    servicesDescription: li.servicesDescription ?? "",
    calibrationAmount: li.calibrationAmount ?? 0,
    // De dónde salió la línea, para poder identificarla o revertirla después.
    source: li.source ?? "",
  }));
}

async function create(data) {
  validateInsuranceAttachments(data.insuranceAttachments);
  const num = await nextQuoteNumber();
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
    state: data.state || "",
    longTripFee: data.longTripFee ?? 0,
    serviceArea: data.serviceArea ?? true,
    longTripRequired: data.longTripRequired ?? false,
    distanceFromBase: data.distanceFromBase ?? 0,
    customerType: data.customerType === "New" ? "New" : "Existing",
    // Normalizado aqui, no solo al escribir: asi el objeto que se devuelve coincide con lo que
    // quedo en la base. createFromQuote recibe este objeto y volvia a toparse con la cadena vacia.
    customerId: idOrNull(data.customerId),
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
      zipCode: data.newCustomer?.zipCode || "",
      // Capturadas gratis por el autocompletado al elegir la direccion; de aqui las hereda la
      // orden de trabajo al convertir (createFromQuote) para salir en el mapa sin geocodificar.
      // NULL y no 0: (0,0) es un punto real y "sin ubicar" tiene que distinguirse.
      lat: typeof data.newCustomer?.lat === "number" ? data.newCustomer.lat : null,
      lng: typeof data.newCustomer?.lng === "number" ? data.newCustomer.lng : null,
    },
    insuranceCompanyId: idOrNull(data.insuranceCompanyId),
    agentId: idOrNull(data.agentId),
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
    insuranceAttachments: Array.isArray(data.insuranceAttachments) ? data.insuranceAttachments : [],
    taxRate: data.taxRate ?? 0,
    invoiceMode: data.invoiceMode === "itemized" ? "itemized" : "lump_sum",
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
  await writeQuoteToSql(quote);
  return withTotals(quote);
}

async function update(id, data, options = {}) {
  const quote = await get(id);
  if (!quote) return null;
  validateInsuranceAttachments(data.insuranceAttachments, quote.insuranceAttachments);

  Object.assign(quote, {
    status: data.status ?? quote.status,
    documentType: data.documentType ?? quote.documentType,
    paymentType: data.paymentType ?? quote.paymentType,
    callDirection: data.callDirection ?? quote.callDirection,
    name: data.name ?? quote.name,
    date: data.date ?? quote.date,
    zipCode: data.zipCode ?? quote.zipCode,
    state: data.state ?? quote.state,
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
    insuranceAttachments: Array.isArray(data.insuranceAttachments) ? data.insuranceAttachments : quote.insuranceAttachments,
    taxRate: data.taxRate ?? quote.taxRate,
    invoiceMode:
      data.invoiceMode === "itemized" || data.invoiceMode === "lump_sum" ? data.invoiceMode : quote.invoiceMode,
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

  // Checked before anything is written. Throwing after writeQuoteToSql would leave the quote
  // updated and its work order stale if the user then cancelled — the two records have to move
  // together or not at all.
  const priceChange = await detectPaidWorkOrderPriceChange(quote);
  if (priceChange && !options.confirmPriceChange) throw new PaidWorkOrderPriceChangeError(priceChange);

  await writeQuoteToSql(quote);
  await syncPricingToWorkOrder(quote);
  if (priceChange) await logPaidWorkOrderPriceChange(priceChange, options.actor);
  return withTotals(quote);
}

async function sendIntake(id, { expiresInDays } = {}) {
  const quote = await get(id);
  if (!quote) return null;

  const days = Number(expiresInDays) > 0 ? Number(expiresInDays) : 7;
  quote.intakeToken = genIntakeToken();
  quote.intakeTokenExpiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
  quote.intakeSentAt = new Date().toISOString();
  quote.intakeOpenedAt = null;
  quote.intakeCompletedAt = null;
  if (quote.status === "Draft") quote.status = "Waiting Customer";

  await writeQuoteToSql(quote);
  return withTotals(quote);
}

function isIntakeTokenValid(quote) {
  if (!quote || !quote.intakeToken) return false;
  if (!quote.intakeTokenExpiresAt) return true;
  return new Date(quote.intakeTokenExpiresAt).getTime() > Date.now();
}

async function markIntakeOpened(token) {
  const quote = await getByIntakeToken(token);
  if (!quote || !isIntakeTokenValid(quote)) return null;

  if (!quote.intakeOpenedAt) quote.intakeOpenedAt = new Date().toISOString();

  await writeQuoteToSql(quote);
  return withTotals(quote);
}

async function submitIntake(token, data) {
  const quote = await getByIntakeToken(token);
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
    quote.intakePhotos = { ...quote.intakePhotos, ...validateIntakePhotos(data.intakePhotos, quote.intakePhotos) };
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

  await writeQuoteToSql(quote);
  return withTotals(quote);
}

async function remove(id) {
  const quote = await get(id);
  if (!quote) return false;
  await pool.query("UPDATE quotes SET active = false, deleted_at = $2 WHERE id = $1", [id, new Date().toISOString()]);
  listCache.invalidate("quotes", "workorders");
  return true;
}

async function markConverted(id) {
  const r = await pool.query("UPDATE quotes SET status = 'Converted', updated_at = now() WHERE id = $1 RETURNING *", [id]);
  listCache.invalidate("quotes");
  if (!r.rows[0]) return null;
  return withTotals(mapQuote(r.rows[0]));
}

module.exports = {
  list,
  get,
  create,
  update,
  remove,
  markConverted,
  getLinkedWorkOrder,
  recordOverpaymentAsUpsell,
  getByIntakeToken,
  sendIntake,
  markIntakeOpened,
  submitIntake,
  PaidWorkOrderPriceChangeError,
  // Exposed so scripts/verify-calc-regression.js can assert the tax/subtotal rules against
  // hand-built quotes without writing anything to the database.
  __computeTotalsForTest: computeTotals,
};
