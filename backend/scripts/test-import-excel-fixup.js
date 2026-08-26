// xlsx arrastra un prototype pollution sin parche publicado en npm (GHSA-4r6h-8v6p-xvw6).
// Congelar el prototipo hace que la escritura falle en vez de contaminar el proceso, que es lo
// que convertiria una hoja de calculo manipulada en control sobre las comprobaciones del resto
// del programa. Va en la PRIMERA linea, antes de que se cargue xlsx.
Object.freeze(Object.prototype);

// Follow-up to test-import-excel.js: preserves the real (unmatched) technician name as free
// text on each imported test Work Order, and creates a TECHNICIAN payment for each — with
// technicianId left null where no catalog match exists, per "do not modify catalogs".

const XLSX = require("xlsx");
const workordersStore = require("../src/store/workorders.store");
const paymentsStore = require("../src/store/payments.store");

const EXCEL_PATH = "C:\\Users\\Antonio Cano\\OneDrive\\Documents\\EJEMPLO DE WORK ORDER PARA LA WEB.xlsx";
const TEST_MARKER = "TEST IMPORT (EJEMPLO XLSX)";
const WO_TO_TECH_NAME = {
  "WO-0001": "Jesus Octavio Garcia",
  "WO-0002": "Jesus Octavio Garcia",
  "WO-0003": "Pedro Eloy Perez",
  "WO-0004": "Enrique F Orellana",
  "WO-0005": "Enrique F Orellana",
  "WO-0006": "Ricardo Santos",
  "WO-0007": "Enrique F Orellana",
  "WO-0008": "Antonio Cano",
};

async function main() {
  const workOrders = workordersStore.list().filter((w) => w.createdBy === TEST_MARKER);
  for (const wo of workOrders) {
    const techName = WO_TO_TECH_NAME[wo.workOrderNo];
    if (!techName) continue;

    workordersStore.update(wo.id, { tech: techName, updatedBy: TEST_MARKER });

    const payment = paymentsStore.create(
      {
        type: "TECHNICIAN", workOrderId: wo.id, customerId: wo.customerId,
        vehicle: [wo.vehicle.year, wo.vehicle.make, wo.vehicle.model].filter(Boolean).join(" "),
        baseAmount: wo.laborCost,
        notes: `Technician "${techName}" from source Excel row has no matching catalog entry (kept as free text; catalog not modified).`,
      },
      TEST_MARKER
    );
    console.log(`${wo.workOrderNo}: tech="${techName}" (no catalog match) -> payment ${payment.paymentNumber} $${payment.netAmount}`);
  }
  console.log("\nFixup complete.");
}

main().catch((err) => {
  console.error("Fixup failed:", err);
  process.exit(1);
});
