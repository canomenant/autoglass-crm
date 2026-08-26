// xlsx arrastra un prototype pollution sin parche publicado en npm (GHSA-4r6h-8v6p-xvw6).
// Congelar el prototipo hace que la escritura falle en vez de contaminar el proceso, que es lo
// que convertiria una hoja de calculo manipulada en control sobre las comprobaciones del resto
// del programa. Va en la PRIMERA linea, antes de que se cargue xlsx.
Object.freeze(Object.prototype);

// TEMPORARY TEST DATA IMPORT (batch 2) — imports 50 additional real historical work orders
// through the CRM's own Customer -> Quote -> Work Order -> Payment flow, for a more
// realistic-volume validation pass. Excludes the 8 rows already imported by
// test-import-excel.js. Does NOT create or modify any catalog.
//
// Run with: node scripts/test-import-excel-batch2.js

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
const ALREADY_USED = new Set(["Wo-0001", "Wo-0077", "Wo-0120", "Wo-0125", "Wo-0002", "Wo-0069", "Wo-0005", "Wo-0006"]);
const TARGET_COUNT = 50;

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

function jobTypesOf(r) { return String(r.raw[r.idx.jobType]).split(",").map((s) => s.trim()); }
function isMulti(r) { return jobTypesOf(r).length > 1; }
function isInsurance(r) { return String(r.raw[r.idx.insurance]).trim() === "Insurance"; }
function hasToken(r, re) { return jobTypesOf(r).some((t) => re.test(t)); }
function woNo(r) { return r.raw[r.idx.wo]; }

function selectFifty(rows) {
  const available = rows.filter((r) => !ALREADY_USED.has(woNo(r)));
  const picked = [];
  const pickedSet = new Set();
  function take(list, n) {
    let count = 0;
    for (const r of list) {
      if (count >= n) break;
      if (pickedSet.has(woNo(r))) continue;
      picked.push(r);
      pickedSet.add(woNo(r));
      count++;
    }
  }
  take(available.filter(isInsurance), 5);
  take(available.filter((r) => !isMulti(r) && jobTypesOf(r)[0] === "Chip Repair"), 2);
  take(available.filter((r) => !isMulti(r) && jobTypesOf(r)[0] === "Labor"), 3);
  take(available.filter((r) => hasToken(r, /Window Regulator/i)), 3);
  take(available.filter((r) => hasToken(r, /Vent Glass/i)), 2);
  take(available.filter((r) => hasToken(r, /Quarter Glass/i)), 4);
  take(available.filter(isMulti), 10); // covers Multiple Part Jobs + most Molding combinations
  take(available.filter((r) => !isMulti(r) && jobTypesOf(r)[0] === "Back Glass"), 8);
  take(available.filter((r) => !isMulti(r) && /Door Glass/i.test(jobTypesOf(r)[0])), 8);
  take(available.filter((r) => !isMulti(r) && jobTypesOf(r)[0] === "Windshield Replacement"), TARGET_COUNT - picked.length);
  return picked;
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
  match = list.find((x) => target.startsWith(x.name.trim().toLowerCase()) || x.name.trim().toLowerCase().startsWith(target));
  return match || null;
}

function parseRow({ raw, idx }) {
  const fullName = String(raw[idx.customer] || "").trim();
  const parts = fullName.split(/\s+/);
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
    jobType: jt, partNumber: partNumbers[i] || "", nagsDescription: "", calibrationType: "",
    priceTier: tiers[i] || "", pricePart: i === 0 ? money(raw[idx.subtotalPart]) : 0,
    distributor: distributors[i] || distributors[0] || "", orderNumber: distributorOrders[i] || distributorOrders[0] || "",
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
  const allRows = loadRows();
  const selected = selectFifty(allRows);
  console.log(`Selected ${selected.length} rows for batch 2.\n`);

  const agents = agentsStore.list();
  const technicians = techniciansStore.list();
  const distributors = distributorsStore.list();

  const created = [];
  const categoryCounts = {};

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
      tech: row.techName,
      laborCost: row.laborCost,
      glassCost: row.glassCost,
      totalSale: row.total,
      status: "Paid",
      payment: { method: row.paymentMethod, amount: row.total, paid: true },
      updatedBy: TEST_MARKER,
    });
    if (techMatch) workordersStore.assignTech(workOrder.id, techMatch.id, techMatch.name);

    const payment = paymentsStore.create(
      {
        type: "TECHNICIAN", workOrderId: workOrder.id, customerId: customer.id,
        technicianId: techMatch ? techMatch.id : null,
        vehicle: [row.vehicle.year, row.vehicle.make, row.vehicle.model].filter(Boolean).join(" "),
        baseAmount: row.laborCost,
        notes: techMatch ? "" : `Technician "${row.techName}" has no matching catalog entry (kept as free text; catalog not modified).`,
      },
      TEST_MARKER
    );

    const cat = row.lineItems.map((li) => li.jobType).join(" + ");
    categoryCounts[cat] = (categoryCounts[cat] || 0) + 1;

    created.push({
      sourceRow: row.sourceWoNo, workOrderNo: workOrder.workOrderNo, quoteNo: quote.quoteNo,
      paymentNo: payment.paymentNumber, type: row.isInsurance ? "Insurance" : "Personal",
      jobTypes: cat, total: row.total,
      agentMatched: !!agentMatch, techMatched: !!techMatch, distributorMatched: !!distMatch,
    });
  }

  console.log(`Created ${created.length} Customer -> Quote -> Work Order -> Payment chains.\n`);
  console.log("By category:");
  Object.entries(categoryCounts).sort((a, b) => b[1] - a[1]).forEach(([k, v]) => console.log(`  ${v.toString().padStart(3)}  ${k}`));

  const insuranceCount = created.filter((c) => c.type === "Insurance").length;
  console.log(`\nPersonal: ${created.length - insuranceCount}  |  Insurance: ${insuranceCount}`);

  const agentMatchRate = created.filter((c) => c.agentMatched).length;
  const techMatchRate = created.filter((c) => c.techMatched).length;
  const distMatchRate = created.filter((c) => c.distributorMatched).length;
  console.log(`\nCatalog match rates: Agent ${agentMatchRate}/${created.length}, Technician ${techMatchRate}/${created.length}, Distributor ${distMatchRate}/${created.length}`);

  console.log(`\nDone.`);
}

main().catch((err) => {
  console.error("Import failed:", err);
  process.exit(1);
});
