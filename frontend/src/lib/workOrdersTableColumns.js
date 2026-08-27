import { isCompletedWorkOrderStatus } from "./workOrderStatuses";

// Bump this whenever a key is added/removed/renamed in CATALOG_KEYS below. Anything cached
// under an older version (localStorage) gets discarded instead of rendering phantom columns
// for keys that no longer exist in the current catalog.
export const COLUMN_CATALOG_VERSION = 3;

export const CATEGORIES = [
  "workOrder",
  "customer",
  "vehicle",
  "insurance",
  "appointment",
  "glass",
  "distributor",
  "technician",
  "invoice",
  "payments",
  "financial",
  "documents",
];

const VISIBLE_BY_DEFAULT = new Set([
  "acciones",
  "woNo",
  "customerName",
  "phone",
  "year",
  "make",
  "model",
  "insuranceCompany",
  "claimNumber",
  "partNumber",
  "appointmentDate",
  "appointmentTime",
  "assignedTech",
  "status",
  "type",
  "distributorName",
  "totalSale",
  "commission",
  "balanceDue",
  "invoiceStatus",
]);

const PINNED_BY_DEFAULT = new Set(["acciones"]);

/* El catalogo solo ofrece columnas que el sistema puede llenar.
 *
 * Antes listaba 30 campos que getColumnValue devolvia como "" pase lo que pase -trim, mileage,
 * color, roNumber, trackingNumber, orderDate, materialCost, las firmas...-, asi que activarlos en
 * Configure View daba una columna vacia sin explicacion. Un campo que no se puede llenar no es una
 * opcion, es una trampa: los que no tienen origen se quitaron, y los que si lo tenian pero no
 * estaban conectados (el distribuidor y su numero de orden, el agente, la ciudad del cliente, la
 * calibracion, el nivel de precio) ahora leen del dato real.
 *
 * Si mañana aparece el origen de alguno, se vuelve a agregar aqui y se conecta en getColumnValue;
 * las dos cosas van juntas. Al cambiar esta lista hay que subir COLUMN_CATALOG_VERSION.
 */
const CATALOG_KEYS = [
  ["workOrder", ["acciones", "woNo", "quoteNo", "status", "type", "priority", "jobType", "createdDate", "lastUpdated", "completionDate", "assignedTech", "specialInstructions"]],
  ["customer", ["customerName", "firstName", "lastName", "phone", "mobile", "email", "address", "city", "state", "zipCode"]],
  ["vehicle", ["year", "make", "model", "bodyStyle", "vin", "plate"]],
  ["insurance", ["insuranceCompany", "claimNumber", "policyNumber", "deductible", "agentName", "authorizationNumber"]],
  ["appointment", ["appointmentDate", "appointmentTime", "serviceType", "serviceAddress", "serviceCity", "serviceState", "serviceZipCode"]],
  ["glass", ["partNumber", "partDescription", "glassType", "priceTier", "calibrationRequired", "calibrationCost"]],
  ["distributor", ["distributorName", "poNumber", "distributorCost"]],
  ["technician", ["technicianPhone", "technicianEmail", "assignmentDate", "notificationStatus", "lastNotificationSent"]],
  ["invoice", ["invoiceNumber", "invoiceStatus", "invoiceDate", "dueDate", "invoiceTotal", "amountPaid", "balanceDue"]],
  ["payments", ["paymentStatus", "paymentMethod", "paymentDate", "paymentAmount", "remainingBalance"]],
  ["financial", ["glassCost", "laborCost", "commission", "tax", "discount", "totalCost", "totalSale", "grossProfit"]],
  ["documents", ["photosUploaded", "invoicePdf"]],
];

export const DEFAULT_COLUMNS = CATALOG_KEYS.flatMap(([category, keys]) =>
  keys.map((key) => ({
    key,
    category,
    visible: VISIBLE_BY_DEFAULT.has(key),
    pinned: PINNED_BY_DEFAULT.has(key),
  }))
);

export const MONEY_COLUMNS = new Set([
  "invoiceTotal",
  "amountPaid",
  "balanceDue",
  "paymentAmount",
  "remainingBalance",
  "glassCost",
  "laborCost",
  "commission",
  "tax",
  "discount",
  "totalCost",
  "totalSale",
  "grossProfit",
  "distributorCost",
  "calibrationCost",
  "deductible",
]);

function fmtDate(d) {
  return d ? new Date(d).toLocaleString() : "";
}

export function getColumnValue(key, wo, ctx = {}) {
  const { companies = [], users = [], invoices = [] } = ctx;
  const invoice = invoices.find((i) => i.workOrderId === wo.id);
  const technician = users.find((u) => u.id === wo.technicianId);
  const [firstName, ...rest] = (wo.customerName || "").split(" ");

  switch (key) {
    case "woNo": return wo.workOrderNo;
    case "quoteNo": return wo.quoteNo;
    case "status": return wo.status;
    case "type": return wo.workOrderType || "Personal";
    case "priority": return wo.priority;
    case "jobType": return wo.jobType;
    case "createdDate": return wo.createdAt ? wo.createdAt.slice(0, 10) : "";
    case "lastUpdated": return fmtDate(wo.updatedAt);
    case "completionDate": return isCompletedWorkOrderStatus(wo.status) ? fmtDate(wo.updatedAt) : "";
    // Con varios tecnicos la celda muestra "Nombre +N": el nombre completo de todos no cabe en una
    // columna, pero que fueron varios si tiene que verse desde la lista.
    case "assignedTech": {
      const extra = (wo.extraTechs || []).length;
      return extra ? `${wo.tech} +${extra}` : wo.tech;
    }
    case "specialInstructions": return wo.specialInstructions;

    case "customerName": return wo.customerName;
    case "firstName": return firstName || "";
    case "lastName": return rest.join(" ");
    case "phone": return wo.phone;
    case "mobile": return wo.mobile || "";
    case "email": return wo.email;
    case "address": return wo.address;
    case "city": return wo.city || "";
    // La orden guarda su propio estado; el del cliente solo se usa si aquel falta.
    case "state": return wo.state || wo.customerState || "";
    case "zipCode": return wo.zipCode || "";

    case "year": return wo.vehicle?.year;
    case "make": return wo.vehicle?.make;
    case "model": return wo.vehicle?.model;
    case "bodyStyle": return wo.vehicle?.bodyType;
    case "vin": return wo.vehicle?.vin;
    case "plate": return wo.vehicle?.plate;

    case "insuranceCompany": return (companies || []).find((c) => c.id === wo.insuranceCompanyId)?.name || "";
    case "claimNumber": return wo.claimNumber;
    case "policyNumber": return wo.policyNumber;
    case "deductible": return wo.deductible ?? "";
    case "agentName": return wo.agentName || "";
    case "authorizationNumber": return wo.payment?.authorizationId || "";

    case "appointmentDate": return wo.appointmentDate;
    case "appointmentTime": return wo.appointmentTime;
    case "serviceType": return wo.jobType;
    // El servicio se hace donde esta el cliente: es la misma direccion, no una segunda.
    case "serviceAddress": return wo.address;
    case "serviceCity": return wo.city || "";
    case "serviceState": return wo.state || wo.customerState || "";
    case "serviceZipCode": return wo.zipCode || "";

    case "partNumber": return wo.partNumber;
    case "partDescription": return wo.nagsDescription || wo.partDescriptions || "";
    case "glassType": return wo.glassType;
    case "priceTier": return wo.priceTier || "";
    case "calibrationRequired": return wo.calibrationType ? "Yes" : "";
    case "calibrationCost": return wo.calibrationCost ?? "";

    // El distribuidor anotado en la orden manda; si esta vacio se cae al de las lineas del
    // presupuesto, que es de donde salio. Wo-3869 es justo ese caso.
    case "distributorName": return wo.distributor || wo.distributorFromLines || "";
    // El numero con el que el distribuidor factura la parte. En AppSheet era el invoice number.
    case "poNumber": return wo.orderNumber || "";
    case "distributorCost": return wo.distributorCost ?? wo.glassCost ?? "";

    case "technicianPhone": return technician?.phone || "";
    case "technicianEmail": return technician?.email || "";
    case "assignmentDate": return fmtDate(wo.techAssignedAt);
    case "notificationStatus": return wo.lastNotification?.status || "";
    case "lastNotificationSent": return wo.lastNotification?.sentAt ? fmtDate(wo.lastNotification.sentAt) : "";

    case "invoiceNumber": return invoice?.invoiceNumber || "";
    case "invoiceStatus": return invoice?.status || "";
    case "invoiceDate": return invoice?.invoiceDate || "";
    case "dueDate": return invoice?.dueDate || "";
    case "invoiceTotal": return invoice?.total ?? "";
    case "amountPaid": return invoice?.amountPaid ?? "";
    case "balanceDue": return invoice?.balance ?? "";

    case "paymentStatus": return invoice?.status || (wo.payment?.paid ? "Paid" : "Pending");
    case "paymentMethod": return wo.payment?.method;
    // Cuando se cobro. El historial es la unica huella con fecha; el ultimo asiento es el vigente.
    case "paymentDate": {
      const ultimo = wo.paymentHistory?.[wo.paymentHistory.length - 1];
      return ultimo?.timestamp ? String(ultimo.timestamp).slice(0, 10) : "";
    }
    case "paymentAmount": return wo.payment?.amount;
    case "remainingBalance":
      return invoice?.balance ?? Math.max(0, Number(wo.totalSale || 0) - Number(wo.payment?.amount || 0));

    case "glassCost": return wo.glassCost;
    case "laborCost": return wo.laborCost;
    // La comision del agente que ya trae la orden: el mismo numero que grossProfit descuenta abajo.
    case "commission": return wo.commission ?? "";
    case "tax": return Number(wo.totalSale || 0) * (Number(wo.taxRate || 0) / 100);
    // El descuento se guarda como tipo + valor, no como importe: un 10% no es $10.
    case "discount": {
      const v = Number(wo.discountValue || 0);
      if (!v) return "";
      return wo.discountType === "Percentage" ? (Number(wo.totalSale || 0) * v) / 100 : v;
    }
    case "totalCost": return Number(wo.glassCost || 0) + Number(wo.laborCost || 0);
    case "totalSale": return wo.totalSale;
    case "grossProfit":
      // Las tres columnas de costo, igual que en el panel de admin y en el reporte de P&L.
      return Number(wo.totalSale || 0) - Number(wo.glassCost || 0) - Number(wo.laborCost || 0) - Number(wo.commission || 0);

    case "photosUploaded": return wo.techPhotos?.length || 0;
    case "invoicePdf": return invoice ? "PDF" : "";

    default: return "";
  }
}
