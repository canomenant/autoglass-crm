import { isCompletedWorkOrderStatus } from "./workOrderStatuses";

// Catálogo del Reporte Detallado.
//
// Es un catálogo propio y no el de la lista de Work Orders (workOrdersTableColumns.js) porque son
// dos cosas distintas:
//
//   - Aquello alimenta una tabla en pantalla y devuelve TEXTO ya formateado. Aquí el destino es una
//     hoja de cálculo: cada campo declara su tipo y devuelve el valor CRUDO, para que un importe
//     llegue a Excel como número con el que se puede sumar y no como la cadena "$543.38". Quien
//     pinta decide cómo se ve; quien exporta, no tiene que deshacer nada.
//   - Aquello sólo mira la orden de trabajo. Aquí hace falta la cotización: el upsell y el precio
//     final viven ahí, y son justo las cifras que se quieren revisar.
//   - Aquello ofrece columnas que en un export no significan nada (el enlace "Ver/Editar", las
//     fotos, el PDF de la factura).
//
// Cada columna: key, category (para agrupar en el selector), type ("text" | "money" | "number" |
// "date") y get(row). `row` es { wo, quote } — la orden y su cotización, si la tiene.

export const REPORT_CATEGORIES = ["workOrder", "customer", "vehicle", "technician", "financial"];

// El precio final de la COTIZACIÓN, no work_orders.total_sale.
//
// Las dos deberían coincidir -total_sale es una copia que sincroniza quotes.store- pero en 3.555 de
// las 3.664 órdenes con pago no coinciden: vienen del import y esa copia se quedó con el total sin
// el upsell que la cotización sí tiene anotado. Un reporte financiero que lea la copia vieja
// entrega cifras que no cuadran con la pantalla de la cotización ni con el P&L.
function finalPrice(wo, quote) {
  if (quote?.totals) return Number(quote.totals.finalSalePrice || 0);
  return Number(wo.totalSale || 0);
}

function collected(wo) {
  return Number(wo.payment?.amount || 0);
}

const COLUMNS = [
  // --- Orden de trabajo ---
  { key: "woNo", category: "workOrder", type: "text", get: ({ wo }) => wo.workOrderNo || "" },
  { key: "quoteNo", category: "workOrder", type: "text", get: ({ wo }) => wo.quoteNo || "" },
  { key: "status", category: "workOrder", type: "text", get: ({ wo }) => wo.status || "" },
  { key: "type", category: "workOrder", type: "text", get: ({ wo }) => wo.workOrderType || "Personal" },
  { key: "jobType", category: "workOrder", type: "text", get: ({ wo }) => wo.jobType || "" },
  { key: "appointmentDate", category: "workOrder", type: "date", get: ({ wo }) => wo.appointmentDate || "" },
  { key: "createdDate", category: "workOrder", type: "date", get: ({ wo }) => (wo.createdAt ? String(wo.createdAt).slice(0, 10) : "") },
  { key: "completionDate", category: "workOrder", type: "date", get: ({ wo }) => (isCompletedWorkOrderStatus(wo.status) && wo.updatedAt ? String(wo.updatedAt).slice(0, 10) : "") },

  // --- Cliente ---
  { key: "customerName", category: "customer", type: "text", get: ({ wo }) => wo.customerName || "" },
  { key: "phone", category: "customer", type: "text", get: ({ wo }) => wo.phone || "" },
  { key: "email", category: "customer", type: "text", get: ({ wo }) => wo.email || "" },
  { key: "address", category: "customer", type: "text", get: ({ wo }) => wo.address || "" },
  { key: "zipCode", category: "customer", type: "text", get: ({ wo, quote }) => wo.zipCode || quote?.zipCode || "" },

  // --- Vehículo ---
  // Una sola columna con año/marca/modelo: es como se lee un vehículo, y en una hoja de cálculo
  // tres columnas para eso obligan a concatenar a mano. Las sueltas siguen disponibles debajo.
  {
    key: "vehicle",
    category: "vehicle",
    type: "text",
    get: ({ wo }) => [wo.vehicle?.year, wo.vehicle?.make, wo.vehicle?.model].filter(Boolean).join(" "),
  },
  { key: "year", category: "vehicle", type: "text", get: ({ wo }) => wo.vehicle?.year || "" },
  { key: "make", category: "vehicle", type: "text", get: ({ wo }) => wo.vehicle?.make || "" },
  { key: "model", category: "vehicle", type: "text", get: ({ wo }) => wo.vehicle?.model || "" },
  { key: "vin", category: "vehicle", type: "text", get: ({ wo }) => wo.vehicle?.vin || "" },
  { key: "partNumber", category: "vehicle", type: "text", get: ({ wo, quote }) => wo.partNumber || quote?.partNumber || "" },

  // --- Técnico / agente ---
  {
    key: "assignedTech",
    category: "technician",
    type: "text",
    // Con varios técnicos se listan todos separados por coma. En pantalla la lista de órdenes
    // muestra "Nombre +N" porque no cabe, pero en una hoja de cálculo el nombre completo de cada
    // uno es justo lo que se quiere poder filtrar.
    get: ({ wo }) => [wo.tech, ...(wo.extraTechs || []).map((t) => t.name)].filter(Boolean).join(", "),
  },
  { key: "agentName", category: "technician", type: "text", get: ({ quote }) => quote?.agentName || "" },
  { key: "distributorName", category: "technician", type: "text", get: ({ wo }) => wo.distributor || "" },

  // --- Financiero ---
  { key: "finalSalePrice", category: "financial", type: "money", get: ({ wo, quote }) => finalPrice(wo, quote) },
  { key: "upsell", category: "financial", type: "money", get: ({ quote }) => Number(quote?.totals?.upsell ?? quote?.upsell ?? 0) },
  { key: "amountPaid", category: "financial", type: "money", get: ({ wo }) => collected(wo) },
  { key: "cashComeback", category: "financial", type: "money", get: ({ wo }) => Number(wo.payment?.cashComeback || 0) },
  // Nunca negativo: cobrar de más es upsell o vuelto, no un saldo en contra. Es la misma regla que
  // el panel de pagos y el de operaciones.
  { key: "balanceDue", category: "financial", type: "money", get: ({ wo, quote }) => Math.max(0, finalPrice(wo, quote) - collected(wo)) },
  { key: "paymentMethod", category: "financial", type: "text", get: ({ wo }) => wo.payment?.method || "" },
  { key: "paid", category: "financial", type: "text", get: ({ wo }) => (wo.payment?.paid ? "Yes" : "No") },
  { key: "glassCost", category: "financial", type: "money", get: ({ wo }) => Number(wo.glassCost || 0) },
  { key: "laborCost", category: "financial", type: "money", get: ({ wo }) => Number(wo.laborCost || 0) },
  { key: "commission", category: "financial", type: "money", get: ({ wo }) => Number(wo.commission || 0) },
  {
    key: "grossProfit",
    category: "financial",
    type: "money",
    get: ({ wo, quote }) => finalPrice(wo, quote) - Number(wo.glassCost || 0) - Number(wo.laborCost || 0) - Number(wo.commission || 0),
  },
];

export const REPORT_COLUMNS = COLUMNS;

const BY_KEY = new Map(COLUMNS.map((c) => [c.key, c]));

export function getReportColumn(key) {
  return BY_KEY.get(key);
}

export function getReportValue(key, row) {
  const col = BY_KEY.get(key);
  return col ? col.get(row) : "";
}

// Lo que se ofrece la primera vez: exactamente las columnas que se pidieron para revisar un
// reporte, en el orden en que se leen. El resto del catálogo está a un clic en el selector.
export const DEFAULT_SELECTED = [
  "appointmentDate",
  "woNo",
  "customerName",
  "vehicle",
  "type",
  "assignedTech",
  "status",
  "finalSalePrice",
  "upsell",
  "amountPaid",
  "balanceDue",
];
