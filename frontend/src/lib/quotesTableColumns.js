// Subir esto al agregar, quitar o renombrar una clave de RAW_COLUMNS. Lo que este guardado en
// localStorage con una version anterior se descarta, en vez de pintar columnas que ya no existen.
// Mismo mecanismo que el catalogo de Work Orders.
export const COLUMN_CATALOG_VERSION = 1;

const RAW_COLUMNS = [
  { key: "acciones", category: "general", visible: true },
  { key: "correlativo", category: "general", visible: true },
  { key: "id", category: "general", visible: true },
  { key: "estado", category: "general", visible: true },
  { key: "docType", category: "general", visible: false },
  { key: "tipoPago", category: "general", visible: false },
  { key: "cliente", category: "customer", visible: true },
  { key: "telefono", category: "customer", visible: false },
  { key: "email", category: "customer", visible: false },
  { key: "direccion", category: "customer", visible: false },
  { key: "zipCode", category: "customer", visible: false },
  { key: "referral", category: "customer", visible: false },
  { key: "agente", category: "customer", visible: false },
  { key: "vehiculo", category: "vehicle", visible: true },
  { key: "vin", category: "vehicle", visible: false },
  { key: "plate", category: "vehicle", visible: false },
  { key: "insCarrier", category: "insurance", visible: true },
  { key: "poliza", category: "insurance", visible: false },
  { key: "fecha", category: "appointment", visible: true },
  { key: "fechaCita", category: "appointment", visible: false },
  { key: "horaInicio", category: "appointment", visible: false },
  { key: "callInOut", category: "appointment", visible: false },
  { key: "total", category: "financial", visible: true },
  { key: "subParts", category: "financial", visible: false },
  { key: "subServices", category: "financial", visible: false },
  { key: "totLabor", category: "financial", visible: false },
  { key: "taxAmount", category: "financial", visible: false },
  { key: "paid", category: "financial", visible: false },
  { key: "balance", category: "financial", visible: false },
];

export const CATEGORIES = ["general", "customer", "vehicle", "insurance", "appointment", "financial"];

export const DEFAULT_COLUMNS = RAW_COLUMNS.map((c) => ({ ...c, pinned: c.key === "acciones" }));

function customerField(quote, customers, field) {
  if (quote.customerType === "New") return quote.newCustomer?.[field] || "";
  const customer = customers.find((c) => c.id === quote.customerId);
  return customer?.[field] || "";
}

function companyName(companies, id) {
  return companies.find((c) => c.id === id)?.name || "";
}

export function getColumnValue(key, quote, ctx) {
  const { customers, companies } = ctx;
  switch (key) {
    case "correlativo":
      return quote.quoteNo;
    case "id":
      return quote.id;
    case "cliente":
      return quote.customerName;
    case "vehiculo":
      return [quote.vehicle?.year, quote.vehicle?.make, quote.vehicle?.model].filter(Boolean).join(" ");
    case "fecha":
      return quote.date;
    case "estado":
      return quote.status;
    case "total":
      return quote.totals?.totalAmount;
    case "docType":
      return quote.documentType;
    case "tipoPago":
      return quote.paymentType;
    case "agente":
      return quote.agentName || "—";
    case "telefono":
      return customerField(quote, customers, "phone");
    case "email":
      return customerField(quote, customers, "email");
    case "vin":
      return quote.vehicle?.vin;
    case "plate":
      return quote.vehicle?.plate;
    case "insCarrier":
      return companyName(companies, quote.insuranceCompanyId);
    case "poliza":
      return quote.policyNumber;
    case "referral":
      return "—";
    case "fechaCita":
      return quote.appointmentDate;
    case "horaInicio":
      return quote.startTime;
    case "callInOut":
      return quote.callDirection;
    case "zipCode":
      return quote.zipCode;
    case "direccion":
      return customerField(quote, customers, "address");
    case "subParts":
      return quote.totals?.subtotalParts;
    case "subServices":
      return quote.totals?.subtotalServices;
    case "totLabor":
      return quote.totals?.laborTotal;
    case "taxAmount":
      return quote.totals?.taxAmount;
    case "paid":
      return quote.paidAmount;
    case "balance":
      return quote.totals?.remainingBalance;
    default:
      return "";
  }
}

export const MONEY_COLUMNS = new Set(["total", "subParts", "subServices", "totLabor", "taxAmount", "paid", "balance"]);
