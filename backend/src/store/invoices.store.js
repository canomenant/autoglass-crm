const crypto = require("crypto");
const { loadOrSeed, save, nextIdFrom } = require("../lib/persistence");
const quotesStore = require("./quotes.store");
const insuranceStore = require("./insurance.store");
const calibrationTypesStore = require("./calibrationTypes.store");
const priceTiersStore = require("./priceTiers.store");

const FILE = "invoices.json";
let invoices = loadOrSeed(FILE, () => []);
let nextId = nextIdFrom(invoices);

function persist() {
  save(FILE, invoices);
}

const STATUSES = ["Draft", "Sent", "Viewed", "Partially_Paid", "Paid", "Overdue", "Void"];
const BILL_TO = ["Customer", "Insurance", "Split"];
const TEMPLATES = ["Personal", "Insurance", "Custom"];

const SECTION_KEYS = [
  "customer", "vehicle", "workOrder",
  "insuranceCompany", "policyNumber", "claimNumber",
  "parts", "labor", "calibration", "longTrip", "tax",
  "flatRateKit", "claimTotal", "deductible", "insuranceResponsibility", "customerResponsibility", "totalClaimValue",
  "total", "paid", "balance",
  "customerNotes",
];

function defaultSections(allOn) {
  return Object.fromEntries(SECTION_KEYS.map((k) => [k, allOn]));
}

// Backfill the template system added for the three-invoice-type redesign.
(function migrateTemplateShape() {
  let changed = false;
  for (const invoice of invoices) {
    if (!TEMPLATES.includes(invoice.template)) {
      invoice.template = "Personal";
      changed = true;
    }
    if (!invoice.customSections) {
      invoice.customSections = defaultSections(true);
      changed = true;
    }
    if (invoice.internalNotes === undefined) {
      invoice.internalNotes = "";
      changed = true;
    }
  }
  if (changed) persist();
})();

function pad(n) {
  return String(n).padStart(4, "0");
}

function genToken() {
  return crypto.randomBytes(12).toString("hex");
}

function pushAudit(invoice, user, action, oldValue, newValue) {
  invoice.auditLog.push({
    user: user || "System",
    timestamp: new Date().toISOString(),
    action,
    oldValue: oldValue ?? null,
    newValue: newValue ?? null,
  });
}

function computeTotals(invoice) {
  const subtotal = invoice.items.reduce((sum, it) => sum + Number(it.quantity || 0) * Number(it.unitPrice || 0), 0);
  const total = Math.max(0, subtotal + Number(invoice.tax || 0) - Number(invoice.discount || 0));
  const amountPaid = invoice.payments.reduce((sum, p) => sum + Number(p.amount || 0), 0);
  const balance = total - amountPaid;
  return { subtotal, total, amountPaid, balance };
}

function computeStatus(invoice, totals) {
  if (invoice.status === "Draft" || invoice.status === "Void") return invoice.status;
  if (totals.total > 0 && totals.balance <= 0) return "Paid";
  if (totals.amountPaid > 0 && totals.balance > 0) return "Partially_Paid";
  const today = new Date(new Date().toDateString());
  if (invoice.dueDate && new Date(invoice.dueDate) < today && totals.balance > 0) return "Overdue";
  return invoice.status;
}

// Customer-safe breakdown pulled from the linked Quote's own totals, computed server-side so
// neither the internal editor nor the public invoice view need direct Quote API access (the
// public view has no auth token). Deliberately excludes any cost/profit/commission field.
async function buildBreakdown(invoice) {
  const quote = invoice.quoteId ? await quotesStore.get(invoice.quoteId) : null;
  const company = invoice.insuranceCompanyId ? insuranceStore.get(invoice.insuranceCompanyId) : null;
  const totals = quote?.totals || {};
  const isInsuranceQuote = quote?.paymentType === "Insurance";

  return {
    insuranceCompanyName: company?.name || "",
    policyNumber: quote?.policyNumber || "",
    partsAmount: isInsuranceQuote ? totals.pricePartInsurance || 0 : totals.subtotalParts || 0,
    laborAmount: isInsuranceQuote ? totals.laborTotal || 0 : totals.priceTierTotal || 0,
    calibration: totals.subtotalServices || 0,
    longTripFee: totals.longTripFee || 0,
    taxAmount: totals.taxAmount || 0,
    flatRateKit: totals.flatRateKit || 0,
    claimTotal: totals.claimTotalBeforeAdjustment || 0,
    insuranceAdjustmentAmount: totals.insuranceAdjustmentAmount || 0,
    deductible: totals.deductible || 0,
    insuranceResponsibility: totals.insuranceResponsibility || 0,
    customerResponsibility: totals.customerResponsibility || 0,
    totalClaimValue: totals.totalClaimValue || 0,
  };
}

async function withComputed(invoice) {
  if (!invoice) return invoice;
  const totals = computeTotals(invoice);
  return { ...invoice, ...totals, status: computeStatus(invoice, totals), breakdown: await buildBreakdown(invoice) };
}

function stripInternal(invoice) {
  if (!invoice) return invoice;
  const { internalNotes, ...rest } = invoice;
  return rest;
}

async function list(filters = {}) {
  let result = await Promise.all(invoices.map(withComputed));
  if (filters.workOrderId) result = result.filter((i) => i.workOrderId === Number(filters.workOrderId));
  if (filters.status) result = result.filter((i) => i.status === filters.status);
  return result.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

function get(id) {
  return withComputed(invoices.find((i) => i.id === Number(id)));
}

function getByToken(token) {
  return withComputed(invoices.find((i) => i.publicToken === token));
}

async function getPublicByToken(token) {
  return stripInternal(await getByToken(token));
}

// Los renglones de la factura = lo que se le COBRA al cliente, con los precios de la cotización:
// cada parte a su precio de venta, la instalación al precio del tier, calibración, viaje largo y el
// ajuste al cobrar (upsell). NUNCA glassCost ni laborCost: esos son lo que cuesta el vidrio y lo
// que se le paga al técnico (Antonio, 19-sep-2026: las 7 facturas Draft traían el vidrio dos
// veces y "Labor $120" que era la paga del técnico, no los $250 cobrados). El impuesto es el que
// la orden calculó; los pagos del cliente ya registrados en la orden entran como pagos.
// Nivel de detalle (Antonio, 19-sep-2026: el cliente NO debe ver el costo real de la parte ni poder
// deducirlo). El precio de la parte en la cotización es lo que se le paga al distribuidor, así que
// desglosarlo delata el margen. Como hacen Safelite y los demás:
//   lump_sum → UN renglón por vidrio, todo incluido (parte + instalación + calibración); el redondeo
//              al cobrar queda dentro del renglón. Es el modo por defecto para particulares.
//   itemized → "Parts & materials" y "Labor" como TOTALES (nunca precio por pieza), para cuando el
//              cliente pide desglose. Aseguranza siempre desglosa (Parts NAGS / Labor / Kit): la
//              aseguradora lo exige y ese precio es de lista, no el costo.
const DETAIL_MODES = ["lump_sum", "itemized"];

function buildItemsFromQuote(workOrder, quote, mode) {
  const detail = DETAIL_MODES.includes(mode) ? mode : (quote?.invoiceMode === "itemized" ? "itemized" : "lump_sum");
  const items = [];
  const add = (description, unitPrice, quantity = 1) => {
    if (!(Number(unitPrice) > 0)) return;
    items.push({ id: items.length + 1, description, quantity, unitPrice: Math.round(Number(unitPrice) * 100) / 100 });
  };
  const totals = quote?.totals || {};
  const isInsurance = quote?.paymentType === "Insurance";
  const calibrationTypes = calibrationTypesStore.list();
  const priceTiers = priceTiersStore.list();

  if (isInsurance) {
    add("Parts (NAGS)", totals.pricePartInsurance);
    add("Labor", totals.laborTotal);
    add("Flat rate kit", totals.flatRateKit);
    add("Calibration", totals.subtotalServices);
    if (Number(totals.insuranceAdjustmentAmount || 0) !== 0) {
      items.push({ id: items.length + 1, description: "Insurance adjustment", quantity: 1, unitPrice: Math.round(Number(totals.insuranceAdjustmentAmount) * 100) / 100 });
    }
  } else if (detail === "itemized") {
    let partes = 0, labor = 0, calib = 0;
    for (const li of quote?.lineItems || []) {
      partes += Number(li.pricePart || 0);
      labor += Number(priceTiers.find((p) => p.name === li.priceTier)?.amount || 0);
      calib += Number(calibrationTypes.find((c) => c.name === li.calibrationType)?.amount || 0);
    }
    const vehiculo = [workOrder.vehicle?.year, workOrder.vehicle?.make, workOrder.vehicle?.model].filter(Boolean).join(" ");
    add(`Parts & materials${vehiculo ? ` — ${vehiculo}` : ""}`, partes);
    add("Labor / installation", labor);
    add("Calibration", calib);
    add("Long trip fee", totals.longTripFee);
  } else {
    // UN renglón por trabajo: el vidrio principal con TODO (piezas extra, instalación, calibración)
    // y las piezas extra solo mencionadas, sin precio — el precio de una moldura también es costo.
    const vehiculo = [workOrder.vehicle?.year, workOrder.vehicle?.make, workOrder.vehicle?.model].filter(Boolean).join(" ");
    const lis = (quote?.lineItems || []).filter((li) => Number(li.pricePart || 0) > 0 || li.priceTier || li.calibrationType);
    const principal = lis.find((li) => li.priceTier) || lis[0];
    if (principal) {
      let monto = 0; let calib = false; const extras = [];
      for (const li of lis) {
        monto += Number(li.pricePart || 0) + Number(priceTiers.find((p) => p.name === li.priceTier)?.amount || 0) + Number(calibrationTypes.find((c) => c.name === li.calibrationType)?.amount || 0);
        if (li.calibrationType) calib = true;
        if (li !== principal && li.jobType) extras.push(String(li.jobType).toLowerCase());
      }
      const partes = [principal.partNumber, ...lis.filter((li) => li !== principal).map((li) => li.partNumber)].filter(Boolean);
      const nombre = [principal.jobType || "Service", vehiculo].filter(Boolean).join(" — ") + (partes.length ? ` (${partes.join(", ")})` : "");
      const incl = [...(extras.length ? [`incl. ${[...new Set(extras)].join(", ")}`] : []), ...(calib ? ["calibration"] : [])];
      add(incl.length ? `${nombre} — ${incl.join(" & ")}` : nombre, monto);
    }
    add("Long trip fee", totals.longTripFee);
  }
  // Lo que se redondeó al cobrar (o, en órdenes viejas, lo que la cotización no explica): un renglón
  // aparte, para que la factura sume EXACTAMENTE lo vendido.
  // El impuesto es el de PARTES (lo que se reporta al estado; Antonio con el socio, 8-sep-2026),
  // aunque una cotización vieja haya gravado también la mano de obra: esa diferencia queda en el ajuste.
  const tax = Math.round(Number(totals.taxOnParts ?? workOrder.salesTax ?? 0) * 100) / 100;
  let discount = Math.round(Number(totals.discountAmount || 0) * 100) / 100;
  const suma = items.reduce((a, it) => a + it.quantity * it.unitPrice, 0);
  const venta = Number(workOrder.totalSale || 0);
  const ajuste = Math.round((venta - (suma + tax - discount)) * 100) / 100;
  if (venta > 0 && ajuste >= 0.01) {
    // Todo incluido: el redondeo se queda dentro del primer renglón. Desglosado: renglón aparte.
    if (detail === "lump_sum" && items.length && !isInsurance) items[0].unitPrice = Math.round((items[0].unitPrice + ajuste) * 100) / 100;
    else items.push({ id: items.length + 1, description: items.length ? "Price adjustment" : "Service", quantity: 1, unitPrice: ajuste });
  } else if (venta > 0 && ajuste <= -0.01) {
    discount = Math.round((discount - ajuste) * 100) / 100; // se cobró menos de lo calculado: descuento
  }
  // Todo incluido: el impuesto va DENTRO del renglón y la factura dice "price includes sales tax".
  // Mostrarlo aparte ($12.60 al 7.75%) le daba al cliente el costo exacto del vidrio (Antonio,
  // 19-sep-2026). El impuesto real sigue en la orden (work_orders.sales_tax) para el estado y el P&L.
  let taxIncluded = false;
  if (detail === "lump_sum" && !isInsurance && items.length && tax > 0) {
    items[0].unitPrice = Math.round((items[0].unitPrice + tax) * 100) / 100;
    taxIncluded = true;
  }
  const taxShown = taxIncluded ? 0 : tax;
  // Orden sin precio calculado (cotización sin renglones) pero con cobro: se factura lo cobrado.
  if (!items.length && !(venta > 0) && Number(workOrder.payment?.amount) > 0) {
    items.push({ id: 1, description: "Service", quantity: 1, unitPrice: Math.round(Number(workOrder.payment.amount) * 100) / 100 });
  }
  return { items, tax: taxShown, discount, detail, taxIncluded };
}

// Lo cobrado al cliente, tal como está en la orden: un pago único o el desglose (splits).
function paymentsFromWorkOrder(workOrder) {
  const p = workOrder.payment || {};
  const fecha = (workOrder.paymentHistory || []).filter((h) => h.paid).map((h) => String(h.timestamp || "").slice(0, 10)).filter(Boolean).pop()
    || new Date().toISOString().slice(0, 10);
  const splits = Array.isArray(p.splits) && p.splits.length ? p.splits : (Number(p.amount) > 0 ? [{ method: p.method, amount: p.amount }] : []);
  return splits.filter((x) => Number(x.amount) > 0).map((x, i) => ({
    id: i + 1, paymentDate: fecha, paymentMethod: x.method || "", referenceNumber: p.authorizationId || "",
    amount: Math.round(Number(x.amount) * 100) / 100, notes: "From work order",
  }));
}

async function createFromWorkOrder(workOrder, quote, user) {
  // Una factura por orden: si ya hay una que no esté anulada, es esa (antes cada clic creaba otra).
  const existente = invoices.find((i) => i.workOrderId === workOrder.id && i.status !== "Void");
  if (existente) return withComputed(existente);

  const { items, tax, discount, detail, taxIncluded } = buildItemsFromQuote(workOrder, quote);
  const payments = paymentsFromWorkOrder(workOrder);

  const invoice = {
    id: nextId,
    invoiceNumber: `INV-${pad(nextId)}`,
    workOrderId: workOrder.id,
    workOrderNo: workOrder.workOrderNo,
    quoteId: workOrder.quoteId || null,
    customerId: workOrder.customerId,
    customerName: workOrder.customerName || "",
    customerPhone: workOrder.phone || "",
    customerEmail: workOrder.email || "",
    vehicle: workOrder.vehicle || {},
    insuranceCompanyId: workOrder.insuranceCompanyId ?? null,
    claimNumber: workOrder.claimNumber || "",
    technician: workOrder.tech || "",
    billTo: quote?.paymentType === "Insurance" ? "Insurance" : "Customer",
    splitBilling: { customerAmount: 0, insuranceAmount: 0, deductible: Number(quote?.totals?.deductible || 0) },
    items,
    tax,
    discount,
    detail,
    taxIncluded,
    invoiceDate: workOrder.appointmentDate || new Date().toISOString().slice(0, 10),
    dueDate: "",
    status: "Draft",
    publicToken: genToken(),
    template: quote?.paymentType === "Insurance" ? "Insurance" : "Personal",
    customSections: defaultSections(true),
    notes: "",
    internalNotes: "",
    payments,
    auditLog: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  pushAudit(invoice, user, "Created", null, { items: items.length, payments: payments.length });
  invoices.push(invoice);
  nextId += 1;
  persist();
  return withComputed(invoice);
}

// Vuelve a armar renglones, impuesto, descuento y pagos desde la orden. Solo para borradores: una
// factura enviada ya la vio el cliente y no se reescribe sola.
function rebuildFromWorkOrder(id, workOrder, quote, user, mode) {
  const invoice = invoices.find((i) => i.id === Number(id));
  if (!invoice) return null;
  if (invoice.status !== "Draft") throw new Error("Only Draft invoices can be rebuilt from the work order");
  const { items, tax, discount, detail, taxIncluded } = buildItemsFromQuote(workOrder, quote, mode || invoice.detail);
  Object.assign(invoice, { items, tax, discount, detail, taxIncluded, payments: paymentsFromWorkOrder(workOrder), updatedAt: new Date().toISOString() });
  pushAudit(invoice, user, "Rebuilt from work order", null, { items: items.length, detail });
  persist();
  return withComputed(invoice);
}
function update(id, data, user) {
  const invoice = invoices.find((i) => i.id === Number(id));
  if (!invoice) return null;

  Object.assign(invoice, {
    customerName: data.customerName ?? invoice.customerName,
    customerPhone: data.customerPhone ?? invoice.customerPhone,
    customerEmail: data.customerEmail ?? invoice.customerEmail,
    insuranceCompanyId: data.insuranceCompanyId !== undefined ? data.insuranceCompanyId : invoice.insuranceCompanyId,
    claimNumber: data.claimNumber ?? invoice.claimNumber,
    billTo: data.billTo && BILL_TO.includes(data.billTo) ? data.billTo : invoice.billTo,
    splitBilling: { ...invoice.splitBilling, ...data.splitBilling },
    items: Array.isArray(data.items) ? data.items.map((it, i) => ({ id: it.id ?? i + 1, description: it.description || "", quantity: it.quantity ?? 1, unitPrice: it.unitPrice ?? 0 })) : invoice.items,
    tax: data.tax ?? invoice.tax,
    discount: data.discount ?? invoice.discount,
    invoiceDate: data.invoiceDate ?? invoice.invoiceDate,
    dueDate: data.dueDate ?? invoice.dueDate,
    template: data.template && TEMPLATES.includes(data.template) ? data.template : invoice.template,
    customSections: data.customSections ? { ...invoice.customSections, ...data.customSections } : invoice.customSections,
    notes: data.notes ?? invoice.notes,
    internalNotes: data.internalNotes ?? invoice.internalNotes,
    updatedAt: new Date().toISOString(),
  });

  pushAudit(invoice, user, "Updated", null, null);
  persist();
  return withComputed(invoice);
}

function markSent(id, user) {
  const invoice = invoices.find((i) => i.id === Number(id));
  if (!invoice) return null;
  const oldStatus = invoice.status;
  invoice.status = "Sent";
  invoice.updatedAt = new Date().toISOString();
  pushAudit(invoice, user, "Sent", { status: oldStatus }, { status: "Sent" });
  persist();
  return withComputed(invoice);
}

function markViewed(token) {
  const invoice = invoices.find((i) => i.publicToken === token);
  if (!invoice) return null;
  if (invoice.status === "Sent") {
    invoice.status = "Viewed";
    invoice.updatedAt = new Date().toISOString();
    pushAudit(invoice, "Customer", "Viewed", null, null);
    persist();
  }
  return withComputed(invoice);
}

function addPayment(id, data, user) {
  const invoice = invoices.find((i) => i.id === Number(id));
  if (!invoice) return null;
  invoice.payments.push({
    id: invoice.payments.length + 1,
    paymentDate: data.paymentDate || new Date().toISOString().slice(0, 10),
    paymentMethod: data.paymentMethod || "",
    referenceNumber: data.referenceNumber || "",
    amount: Number(data.amount || 0),
    notes: data.notes || "",
  });
  invoice.updatedAt = new Date().toISOString();
  pushAudit(invoice, user, "Payment Recorded", null, { amount: data.amount });
  persist();
  return withComputed(invoice);
}

function voidInvoice(id, user, reason) {
  const invoice = invoices.find((i) => i.id === Number(id));
  if (!invoice) return null;
  const oldStatus = invoice.status;
  invoice.status = "Void";
  if (reason) invoice.notes = `${invoice.notes ? invoice.notes + " | " : ""}Void: ${reason}`;
  invoice.updatedAt = new Date().toISOString();
  pushAudit(invoice, user, "Voided", { status: oldStatus }, { status: "Void" });
  persist();
  return withComputed(invoice);
}

function remove(id) {
  const index = invoices.findIndex((i) => i.id === Number(id));
  if (index === -1) return false;
  invoices.splice(index, 1);
  persist();
  return true;
}

module.exports = {
  STATUSES,
  BILL_TO,
  TEMPLATES,
  SECTION_KEYS,
  list,
  get,
  getByToken,
  getPublicByToken,
  createFromWorkOrder,
  rebuildFromWorkOrder,
  buildItemsFromQuote,
  DETAIL_MODES,
  update,
  markSent,
  markViewed,
  addPayment,
  void: voidInvoice,
  remove,
};
