// El valor de cada campo del mensaje al técnico, a partir de la orden y su cotización. Misma regla
// que frontend/src/lib/techMessage.js (el SMS se arma en el navegador; la vista móvil, aquí).
// Devuelve "" cuando no hay dato, para que "omitir si está vacío" funcione igual en los dos lados.
// Mismo formato que en todo el CRM: (###) ###-#### (frontend/src/lib/phone.js). El técnico ve el
// teléfono del cliente en el SMS y en la vista móvil, y ahí también va formateado.
function formatPhone(v) {
  const d = String(v || "").replace(/D/g, "").replace(/^1(?=d{10}$)/, "");
  return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : String(v || "");
}

function money(n) {
  return `$${Number(n || 0).toFixed(2)}`;
}

const VENTANAS = { AM: "9 AM – 1 PM", PM: "1 PM – 5 PM", ALL_DAY: "Any time" };

function valueOf(key, wo, quote, config) {
  const nc = quote?.newCustomer || {};
  const li = quote?.lineItems || [];
  const v = wo.vehicle || {};
  switch (key) {
    case "customerName": return wo.customerName || "";
    case "primaryPhone": return formatPhone(wo.phone) || "";
    case "altPhone": return formatPhone(wo.mobile || nc.phoneAlt) || "";
    case "unitNumber": return nc.unitNumber || "";
    case "appointmentWindow":
      if (wo.appointmentWindow === "EXACT") return wo.appointmentTime || "Exact time";
      return VENTANAS[wo.appointmentWindow] || (wo.appointmentTime ? wo.appointmentTime : "");
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
    case "workOrderType": return wo.workOrderType || "";
    case "agentName": return quote?.agentName || wo.agentName || "";
    // Cada renglón de la cotización: vidrio, moldura, sensor… con su número y descripción.
    case "partsList":
      return li.filter((x) => x.partNumber || x.jobType)
        .map((x) => `• ${[x.jobType, x.partNumber].filter(Boolean).join(": ")}${x.nagsDescription ? ` — ${x.nagsDescription}` : ""}`)
        .join("\n");
    case "calibration":
      return [...new Set([wo.calibrationType, ...li.map((x) => x.calibrationType)].map((x) => String(x || "").trim()).filter(Boolean))].join(", ");
    case "priceTier":
      return [...new Set([wo.priceTier, ...li.map((x) => x.priceTier)].map((x) => String(x || "").trim()).filter(Boolean))].join(", ");
    case "customerPhotos": {
      const n = (quote?.customerPhotos || []).length + (quote?.crmPhotos || []).length
        + Object.values(quote?.intakePhotos || {}).reduce((s, a) => s + (Array.isArray(a) ? a.length : 0), 0);
      return n ? `${n} photo${n === 1 ? "" : "s"} — open the link to see them` : "";
    }
    case "notes": return config?.notes || "";
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
    case "paymentStatus": return wo.payment?.paid ? "Paid" : "Unpaid";
    case "balanceToCollect": return money(Math.max(0, Number(wo.totalSale || 0) - Number(wo.payment?.amount || 0)));
    case "salePrice": return Number(wo.totalSale || 0) > 0 ? money(wo.totalSale) : "";
    case "technicianPay": return Number(wo.laborCost || 0) > 0 ? money(wo.laborCost) : "";
    default: return "";
  }
}

module.exports = { valueOf };
