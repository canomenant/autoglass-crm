// El SMS al técnico, armado con la configuración de Settings → "Technician Message" (orden,
// etiquetas, encabezado, cierre, omitir vacíos). Lo usan el panel de asignar técnico y la vista
// previa de Settings, para que lo que se configura sea exactamente lo que sale. El valor de cada
// campo sigue la misma regla que backend/src/lib/techMessageFields.js (la vista móvil).

function money(n) {
  return `$${Number(n || 0).toFixed(2)}`;
}

export function techFieldValue(key, wo, quote, overrides = {}) {
  if (overrides[key] !== undefined) return overrides[key] || "";
  const v = wo?.vehicle || {};
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
    case "requisition":
      return [...new Set((quote?.lineItems || []).map((li) => String(li.orderNumber || "").trim()).filter(Boolean))].join(", ");
    case "specialInstructions": return wo.specialInstructions || "";
    case "techInstructions": return wo.techInstructions || "";
    case "customerNotes": return quote?.damageNotes || "";
    // En el SMS sí va póliza y claim (lo manda la oficina a su técnico); el link público no los lleva.
    case "insuranceInfo":
      return [wo.insuranceCompanyName, wo.policyNumber && `Policy ${wo.policyNumber}`, wo.claimNumber && `Claim ${wo.claimNumber}`]
        .filter(Boolean).join(" · ");
    case "customerPaymentMethod": return wo.payment?.method || "";
    case "balanceToCollect": return money(Math.max(0, Number(wo.totalSale || 0) - Number(wo.payment?.amount || 0)));
    case "salePrice": return Number(wo.totalSale || 0) > 0 ? money(wo.totalSale) : "";
    case "technicianPay": return Number(wo.laborCost || 0) > 0 ? money(wo.laborCost) : "";
    default: return "";
  }
}

// enabled: { key: true/false } — lo que va en ESTE envío (arranca con la columna SMS de Settings
// y se puede quitar algo solo para esta orden). attachmentLabels: nombres de los adjuntos marcados.
export function buildTechMessage({ config, wo, quote, mobileUrl, enabled, overrides, attachmentLabels = [] }) {
  const lines = [config.header || "AUTO GLASS WORK ORDER", "", `WO: ${wo.workOrderNo || ""}`, ""];
  let link = null;
  for (const f of config.fields) {
    if (!enabled[f.key]) continue;
    if (f.key === "mobileLink") { if (mobileUrl) link = `${f.label}:\n${mobileUrl}`; continue; }
    const valor = techFieldValue(f.key, wo, quote, overrides);
    if (!valor && f.skipEmpty) continue;
    // Las instrucciones suelen ser párrafos: van en su propio bloque.
    if (f.key === "techInstructions" || f.key === "specialInstructions" || f.key === "customerNotes") {
      lines.push("", `${f.label}:`, valor || "-");
    } else {
      lines.push(`${f.label}: ${valor || "-"}`);
    }
  }
  if (attachmentLabels.length) lines.push("", `Attachments: ${attachmentLabels.join(", ")}`);
  if (link) lines.push("", link);
  if (config.footer) lines.push("", config.footer);
  // Sin renglones en blanco repetidos (un campo de bloque al final + el link, por ejemplo).
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}
