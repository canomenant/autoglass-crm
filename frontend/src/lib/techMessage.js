// El SMS al técnico, armado con la configuración de Settings → "Technician Message" (orden,
// etiquetas, encabezado, cierre, omitir vacíos). Lo usan el panel de asignar técnico y la vista
// previa de Settings, para que lo que se configura sea exactamente lo que sale. El valor de cada
// campo sigue la misma regla que backend/src/lib/techMessageFields.js (la vista móvil).

function money(n) {
  return `$${Number(n || 0).toFixed(2)}`;
}

const VENTANAS = { AM: "9 AM – 1 PM", PM: "1 PM – 5 PM", ALL_DAY: "Any time" };

export function techFieldValue(key, wo, quote, overrides = {}, config = null) {
  if (overrides[key] !== undefined) return overrides[key] || "";
  const v = wo?.vehicle || {};
  const nc = quote?.newCustomer || {};
  const li = quote?.lineItems || [];
  switch (key) {
    case "customerName": return wo.customerName || "";
    case "primaryPhone": return wo.phone || "";
    case "altPhone": return wo.mobile || nc.phoneAlt || "";
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
    case "paymentStatus": return wo.payment?.paid ? "Paid" : "Unpaid";
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
    const valor = techFieldValue(f.key, wo, quote, overrides, config);
    if (!valor && f.skipEmpty) continue;
    // Las instrucciones suelen ser párrafos: van en su propio bloque.
    if (["techInstructions", "specialInstructions", "customerNotes", "partsList", "notes"].includes(f.key)) {
      lines.push("", `${f.label}:`, valor || "-", "");
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

// Los renglones del mensaje, uno por campo, para dibujarlos con su casilla (panel de la orden):
// [{ key, label, value, block }]. Mismo orden y mismos valores que buildTechMessage.
export function techMessageLines({ config, wo, quote, mobileUrl, overrides = {} }) {
  const out = [];
  for (const f of config.fields) {
    if (f.key === "mobileLink") { if (mobileUrl) out.push({ key: f.key, label: f.label, value: mobileUrl, block: true }); continue; }
    const valor = techFieldValue(f.key, wo, quote, overrides, config);
    if (!valor && f.skipEmpty) continue;
    out.push({ key: f.key, label: f.label, value: valor || "-", block: ["techInstructions", "specialInstructions", "customerNotes", "partsList", "notes"].includes(f.key) });
  }
  return out;
}
