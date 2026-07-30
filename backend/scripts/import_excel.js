// FULL PRODUCTION IMPORT — imports all 200 historical work orders from
// "EJEMPLO DE WORK ORDER PARA LA WEB.xlsx" through the CRM's own
// Customer -> Quote -> Work Order -> Payment flow (same pattern validated by
// test-import-excel.js / test-import-excel-batch2.js).
//
// Step 1: removes the 58 rows those two test scripts previously created
// (identified by createdBy === TEST_MARKER) from customers/quotes/workorders/payments.
// Step 2: imports all 200 Excel rows as real data (createdBy === IMPORT_MARKER).
//
// Does NOT create or modify any catalog (agents, technicians, distributors). Names are
// matched against EXISTING catalog entries only; unmatched names are kept as free text on
// the record (workOrder.tech / workOrder.distributor / quote.agentName) with no catalog row created.
//
// Run with: node scripts/import_excel.js

const fs = require("fs");
const path = require("path");
const XLSX = require("xlsx");

const EXCEL_PATH = "C:\\Users\\Antonio Cano\\OneDrive\\Documents\\EJEMPLO DE WORK ORDER PARA LA WEB.xlsx";
const DATA_DIR = path.join(__dirname, "..", "data");
const TEST_MARKER = "TEST IMPORT (EJEMPLO XLSX)";
const IMPORT_MARKER = "Excel Import (EJEMPLO XLSX)";

function readJson(file) {
  const p = path.join(DATA_DIR, file);
  return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, "utf-8")) : [];
}

function writeJson(file, data) {
  fs.writeFileSync(path.join(DATA_DIR, file), JSON.stringify(data, null, 2), "utf-8");
}

function removeTestImportRecords() {
  for (const file of ["customers.json", "quotes.json", "workorders.json"]) {
    const records = readJson(file);
    const kept = records.filter((r) => r.createdBy !== TEST_MARKER);
    if (kept.length !== records.length) {
      writeJson(file, kept);
      console.log(`Removed ${records.length - kept.length} test record(s) from ${file}`);
    }
  }

  // Any payment left pointing only at work orders that no longer exist post-cleanup is
  // dangling demo data (createdBy "Test"/"System"/"Demo Admin", not the XLSX test marker) —
  // left alone it would collide with new payments once work-order IDs are reused starting from 1.
  const survivingWorkOrderIds = new Set(readJson("workorders.json").map((w) => w.id));
  const payments = readJson("payments.json");
  const keptPayments = payments.filter((p) => {
    if (!Array.isArray(p.workOrderIds) || p.workOrderIds.length === 0) return true;
    return p.workOrderIds.some((id) => survivingWorkOrderIds.has(id));
  });
  if (keptPayments.length !== payments.length) {
    writeJson("payments.json", keptPayments);
    console.log(`Removed ${payments.length - keptPayments.length} dangling payment(s) referencing deleted work orders from payments.json`);
  }
}

// Must run before the store modules are required, since each store loads its JSON file
// into memory once at require-time.
removeTestImportRecords();

const customersStore = require("../src/store/customers.store");
const quotesStore = require("../src/store/quotes.store");
const workordersStore = require("../src/store/workorders.store");
const paymentsStore = require("../src/store/payments.store");
const agentsStore = require("../src/store/agents.store");
const techniciansStore = require("../src/store/technicians.store");
const distributorsStore = require("../src/store/distributors.store");

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

function excelDateToIso(v) {
  if (!v) return "";
  const s = String(v).trim();
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? "" : d.toISOString().slice(0, 10);
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

async function main() {
  console.log(`Reading ${EXCEL_PATH}...`);
  const rows = loadRows();
  console.log(`Loaded ${rows.length} rows.\n`);

  const agents = agentsStore.list();
  const technicians = techniciansStore.list();
  const distributors = distributorsStore.list();

  const created = [];

  for (const rawRow of rows) {
    const row = parseRow(rawRow);

    const customer = customersStore.create({
      firstName: row.firstName, lastName: row.lastName, phone: row.phone, email: row.email,
      address: row.address, vehicle: row.vehicle, createdBy: IMPORT_MARKER,
    });

    const agentMatch = findByExactOrPrefix(agents, row.agentName);
    const techMatch = findByExactOrPrefix(technicians, row.techName);
    const distMatch = row.lineItems[0] ? findByExactOrPrefix(distributors, row.lineItems[0].distributor) : null;

    const quote = quotesStore.create({
      status: "Approved",
      name: `Imported: ${row.sourceWoNo}`,
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
      createdBy: IMPORT_MARKER,
    });

    const workOrder = workordersStore.createFromQuote(quote, IMPORT_MARKER);
    quotesStore.markConverted(quote.id);

    workordersStore.update(workOrder.id, {
      distributorId: distMatch ? distMatch.id : null,
      distributor: row.lineItems[0]?.distributor || "",
      tech: row.techName,
      laborCost: row.laborCost,
      glassCost: row.glassCost,
      totalSale: row.total,
      status: "Paid",
      internalNotes: `Imported from source Excel row ${row.sourceWoNo}.`,
      payment: { method: row.paymentMethod, amount: row.total, paid: true },
      updatedBy: IMPORT_MARKER,
    });
    if (techMatch) workordersStore.assignTech(workOrder.id, techMatch.id, techMatch.name);

    const payment = paymentsStore.create(
      {
        type: "TECHNICIAN", workOrderIds: [workOrder.id], customerId: customer.id,
        technicianId: techMatch ? techMatch.id : null,
        vehicle: [row.vehicle.year, row.vehicle.make, row.vehicle.model].filter(Boolean).join(" "),
        notes: techMatch ? "" : `Technician "${row.techName}" has no matching catalog entry (kept as free text; catalog not modified).`,
      },
      IMPORT_MARKER
    );

    created.push({
      sourceRow: row.sourceWoNo, workOrderNo: workOrder.workOrderNo, quoteNo: quote.quoteNo,
      paymentNo: payment.paymentNumber, type: row.isInsurance ? "Insurance" : "Personal",
      total: row.total,
      agentMatched: !!agentMatch, techMatched: !!techMatch, distributorMatched: !!distMatch,
    });
  }

  console.log(`Created ${created.length} Customer -> Quote -> Work Order -> Payment chains.\n`);

  const insuranceCount = created.filter((c) => c.type === "Insurance").length;
  console.log(`Personal: ${created.length - insuranceCount}  |  Insurance: ${insuranceCount}`);

  const agentMatchRate = created.filter((c) => c.agentMatched).length;
  const techMatchRate = created.filter((c) => c.techMatched).length;
  const distMatchRate = created.filter((c) => c.distributorMatched).length;
  console.log(`Catalog match rates: Agent ${agentMatchRate}/${created.length}, Technician ${techMatchRate}/${created.length}, Distributor ${distMatchRate}/${created.length}`);

  console.log(`\nDone.`);
}

main().catch((err) => {
  console.error("Import failed:", err);
  process.exit(1);
});
