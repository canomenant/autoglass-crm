// xlsx arrastra un prototype pollution sin parche publicado en npm (GHSA-4r6h-8v6p-xvw6).
// Congelar el prototipo hace que la escritura falle en vez de contaminar el proceso, que es lo
// que convertiria una hoja de calculo manipulada en control sobre las comprobaciones del resto
// del programa. Va en la PRIMERA linea, antes de que se cargue xlsx.
Object.freeze(Object.prototype);

// TEMPORARY TEST DATA IMPORT — imports a curated, representative subset of real historical
// work orders (from EJEMPLO DE WORK ORDER PARA LA WEB.xlsx) through the CRM's own
// Quote -> Work Order creation logic, for architecture/workflow validation only.
//
// Does NOT create or modify any catalog (job types, part numbers, calibration types, price
// tiers, payment methods, distributors, agents, technicians). Agent/technician/distributor
// references are matched against EXISTING catalog entries only; unmatched names are kept as
// free text on the record but no new catalog row is created.
//
// Run with: node scripts/test-import-excel.js

const XLSX = require("xlsx");
const customersStore = require("../src/store/customers.store");
const quotesStore = require("../src/store/quotes.store");
const workordersStore = require("../src/store/workorders.store");
const paymentsStore = require("../src/store/payments.store");
const agentsStore = require("../src/store/agents.store");
const techniciansStore = require("../src/store/technicians.store");
const distributorsStore = require("../src/store/distributors.store");

const EXCEL_PATH = "C:\\Users\\Antonio Cano\\OneDrive\\Documents\\EJEMPLO DE WORK ORDER PARA LA WEB.xlsx";
const TEST_MARKER = "TEST IMPORT (EJEMPLO XLSX)";

// Curated rows covering every category requested: Personal, Insurance, Labor Only, Chip
// Repair, Multiple Part Jobs, Window Regulator, Molding, Windshield, Door Glass, Back Glass.
const TARGET_WO_NUMBERS = ["Wo-0001", "Wo-0077", "Wo-0120", "Wo-0125", "Wo-0002", "Wo-0069", "Wo-0005", "Wo-0006"];

function loadRows() {
  const wb = XLSX.readFile(EXCEL_PATH, { cellDates: true });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: "" });
  const headers = rows[0];
  const col = (name) => headers.indexOf(name);
  const idx = {
    wo: col("Work order #"), insurance: col("Insurrance?"), apptDate: col("APPOIMENT DATE"),
    customer: col("CUSTOMER"), phone: col("PHONE NUMBER"), address: col("ADDRESS"), email: col("EMAIL"),
    year: col("YEAR"), make: col("MAKE"), model: col("MODEL"), body: col("BODY"), vin: col("VIN#"),
    paymentType: col("PAYMENT TYPE"), subtotalPart: col("SUBTOTAL PART"), taxPct: col("TAX%"),
    total: col("Total"), jobType: col("JOB TYPE"), partNumber: col("PART NUMBER"), distributor: col("DISTRIBUTOR"),
    distributorOrder: col("DISTRIBUTOR ORDER"), tier: col("TIER"), agent: col("AGENT"), tech: col("TECH "),
    labor: col("LABOR"),
  };
  return rows.slice(1).filter((r) => r.some((c) => String(c).trim() !== "")).map((r) => ({ raw: r, idx }));
}

function money(s) {
  const n = parseFloat(String(s || "").replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function pct(s) {
  const n = parseFloat(String(s || "").replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function splitList(s) {
  return String(s || "").split(",").map((v) => v.trim());
}

function findByExactOrPrefix(list, name) {
  const target = String(name || "").trim().toLowerCase();
  if (!target) return null;
  let match = list.find((x) => x.name.trim().toLowerCase() === target);
  if (match) return match;
  // Real names in Excel are often longer/fuller than the truncated seed catalog names
  // (e.g. seed "Joel Alexander" vs Excel "Joel Alexander Lopez Castillo").
  match = list.find((x) => target.startsWith(x.name.trim().toLowerCase()) || x.name.trim().toLowerCase().startsWith(target));
  return match || null;
}

function parseRow({ raw, idx }) {
  const fullName = String(raw[idx.customer] || "").trim();
  const parts = fullName.split(/\s+/);
  // Excel repeats the last name twice ("John Lukic Lukic") in many rows; collapse an exact repeat.
  let firstName = parts[0] || "";
  let lastName = parts.slice(1).join(" ");
  if (parts.length >= 3 && parts[parts.length - 1].toLowerCase() === parts[parts.length - 2].toLowerCase()) {
    lastName = parts.slice(1, -1).join(" ");
  }

  const jobTypes = splitList(raw[idx.jobType]);
  const partNumbers = splitList(raw[idx.partNumber]);
  const distributors = splitList(raw[idx.distributor]);
  const distributorOrders = splitList(raw[idx.distributorOrder]);
  const tiers = splitList(raw[idx.tier]);

  const lineItems = jobTypes.map((jt, i) => ({
    jobType: jt,
    partNumber: partNumbers[i] || "",
    nagsDescription: "",
    calibrationType: "",
    priceTier: tiers[i] || "",
    pricePart: i === 0 ? money(raw[idx.subtotalPart]) : 0,
    distributor: distributors[i] || distributors[0] || "",
    orderNumber: distributorOrders[i] || distributorOrders[0] || "",
  }));

  return {
    sourceWoNo: raw[idx.wo],
    isInsurance: String(raw[idx.insurance]).trim() === "Insurance",
    appointmentDate: excelDateToIso(raw[idx.apptDate]),
    firstName, lastName,
    phone: String(raw[idx.phone] || "").trim(),
    address: String(raw[idx.address] || "").trim(),
    email: String(raw[idx.email] || "").trim(),
    vehicle: {
      year: String(raw[idx.year] || "").trim(), make: String(raw[idx.make] || "").trim(),
      model: String(raw[idx.model] || "").trim(), bodyType: String(raw[idx.body] || "").trim(),
      vin: String(raw[idx.vin] || "").trim(), plate: "",
    },
    paymentMethod: splitList(raw[idx.paymentType])[0] || "",
    taxRate: pct(raw[idx.taxPct]),
    total: money(raw[idx.total]),
    lineItems,
    agentName: splitList(raw[idx.agent])[0] || "",
    techName: splitList(raw[idx.tech])[0] || "",
    laborCost: money(raw[idx.labor]),
    glassCost: money(raw[idx.subtotalPart]),
  };
}

function excelDateToIso(v) {
  if (!v) return "";
  const s = String(v).trim();
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? "" : d.toISOString().slice(0, 10);
}

async function main() {
  console.log(`Reading ${EXCEL_PATH}...`);
  const rows = loadRows();
  const selected = TARGET_WO_NUMBERS.map((wo) => rows.find((r) => r.raw[r.idx.wo] === wo)).filter(Boolean);
  console.log(`Selected ${selected.length} of ${TARGET_WO_NUMBERS.length} requested source rows.\n`);

  const agents = agentsStore.list();
  const technicians = techniciansStore.list();
  const distributors = distributorsStore.list();

  const created = [];

  for (const rawRow of selected) {
    const row = parseRow(rawRow);

    const customer = customersStore.create({
      firstName: row.firstName, lastName: row.lastName, phone: row.phone, email: row.email,
      address: row.address, vehicle: row.vehicle, createdBy: TEST_MARKER,
    });

    const agentMatch = findByExactOrPrefix(agents, row.agentName);
    const techMatch = findByExactOrPrefix(technicians, row.techName);
    const distMatch = row.lineItems[0] ? findByExactOrPrefix(distributors, row.lineItems[0].distributor) : null;

    const quote = quotesStore.create({
      status: "Approved",
      paymentType: row.isInsurance ? "Insurance" : "Personal",
      date: row.appointmentDate,
      customerType: "Existing",
      customerId: customer.id,
      customerName: customer.name,
      agentId: agentMatch ? agentMatch.id : null,
      agentName: row.agentName,
      appointmentDate: row.appointmentDate,
      vehicle: row.vehicle,
      lineItems: row.lineItems,
      taxRate: row.taxRate,
      payment: { method: row.paymentMethod, amount: row.total },
      createdBy: TEST_MARKER,
    });

    const workOrder = workordersStore.createFromQuote(quote, TEST_MARKER);
    quotesStore.markConverted(quote.id);

    workordersStore.update(workOrder.id, {
      distributorId: distMatch ? distMatch.id : null,
      distributor: row.lineItems[0]?.distributor || "",
      laborCost: row.laborCost,
      glassCost: row.glassCost,
      totalSale: row.total,
      status: "Paid",
      payment: { method: row.paymentMethod, amount: row.total, paid: true },
      updatedBy: TEST_MARKER,
    });
    if (techMatch) workordersStore.assignTech(workOrder.id, techMatch.id, techMatch.name);

    let payment = null;
    if (techMatch) {
      payment = paymentsStore.create(
        { type: "TECHNICIAN", workOrderId: workOrder.id, customerId: customer.id, technicianId: techMatch.id,
          vehicle: [row.vehicle.year, row.vehicle.make, row.vehicle.model].filter(Boolean).join(" "),
          baseAmount: row.laborCost },
        TEST_MARKER
      );
    }

    created.push({
      sourceRow: row.sourceWoNo, customerId: customer.id, quoteId: quote.id, quoteNo: quote.quoteNo,
      workOrderId: workOrder.id, workOrderNo: workOrder.workOrderNo, paymentId: payment?.id || null,
      agentMatched: !!agentMatch, techMatched: !!techMatch, distributorMatched: !!distMatch,
      jobTypes: row.lineItems.map((li) => li.jobType).join(" + "),
      total: row.total,
    });
  }

  console.log("Created test records:\n");
  console.table(created);

  const unmatched = created.filter((c) => !c.agentMatched || !c.techMatched || !c.distributorMatched);
  if (unmatched.length) {
    console.log("\nRecords with an unmatched agent/technician/distributor (kept as free text, no catalog row created):");
    unmatched.forEach((c) => console.log(`  ${c.sourceRow} -> WO ${c.workOrderNo}: agent=${c.agentMatched} tech=${c.techMatched} distributor=${c.distributorMatched}`));
  }

  console.log(`\nDone. ${created.length} Customers, Quotes, and Work Orders created (marked createdBy="${TEST_MARKER}").`);
}

main().catch((err) => {
  console.error("Import failed:", err);
  process.exit(1);
});
