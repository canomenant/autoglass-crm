// El valor de cada campo del mensaje al técnico, a partir de la orden y su cotización. Misma regla
// que frontend/src/lib/techMessage.js (el SMS se arma en el navegador; la vista móvil, aquí).
// Devuelve "" cuando no hay dato, para que "omitir si está vacío" funcione igual en los dos lados.
function money(n) {
  return `$${Number(n || 0).toFixed(2)}`;
}

function valueOf(key, wo, quote) {
  const v = wo.vehicle || {};
  switch (key) {
    case "customerName": return wo.customerName || "";
    case "primaryPhone": return wo.phone || "";
    case "customerEmail": return wo.email || "";
    case "address": return wo.address || "";
    case "appointmentDate": return wo.appointmentDate || "";
    case "appointmentTime": return wo.appointmentTime || "";
    case "vehicleInfo": return [v.year, v.make, v.model].filter(Boolean).join(" ");
    case "bodyType": return v.bodyType || "";
    case "vin": return v.vin || "";
    case "licensePlate": return v.plate || "";
    case "partNumber": return wo.partNumber || "";
    case "nagsDescription": return wo.nagsDescription || "";
    case "jobType": return wo.jobType || "";
    case "distributor": return wo.distributor || "";
    // La requisición de Mygrant con que se pidió el vidrio: la guarda cada renglón de la cotización.
    case "requisition":
      return [...new Set((quote?.lineItems || []).map((li) => String(li.orderNumber || "").trim()).filter(Boolean))].join(", ");
    case "specialInstructions": return wo.specialInstructions || "";
    case "techInstructions": return wo.techInstructions || "";
    case "customerNotes": return quote?.damageNotes || "";
    // Solo la aseguradora: póliza y claim no salen por el link público (ver projectForMobileLink).
    case "insuranceInfo": return wo.insuranceCompanyName || "";
    case "customerPaymentMethod": return wo.payment?.method || "";
    case "balanceToCollect": return money(Math.max(0, Number(wo.totalSale || 0) - Number(wo.payment?.amount || 0)));
    case "salePrice": return Number(wo.totalSale || 0) > 0 ? money(wo.totalSale) : "";
    case "technicianPay": return Number(wo.laborCost || 0) > 0 ? money(wo.laborCost) : "";
    default: return "";
  }
}

module.exports = { valueOf };
