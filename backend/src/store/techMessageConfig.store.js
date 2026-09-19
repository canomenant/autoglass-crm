const { loadOrSeed, save } = require("../lib/persistence");

// Qué se le manda al técnico al asignarle una orden: el SMS y la vista móvil del link.
//
// Antes eran 19 casillas fijas en el panel de la orden, todas marcadas cada vez, y la vista móvil
// mostraba su propia lista fija. Antonio (18-sep-2026) pidió configurarlo UNA vez en Settings, con
// el mismo estilo que "Configure Table View": qué campos, en qué orden, con qué etiqueta, y por
// separado qué va en el SMS (corto) y qué en la vista móvil (el detalle para trabajar).
//
// Un objeto único (no una lista de catálogo), igual que partnerDistributionSettings.

const FILE = "techMessageConfig.json";

// Catálogo de campos. `sms`/`mobile` son los valores por defecto; `mobileAlways` son los que la
// vista móvil necesita para funcionar (llamar, mapa) y no se pueden apagar ahí; `smsOnly` son los
// que solo tienen sentido en el mensaje; `sensitive` avisa en la pantalla de configuración.
const CATALOG = [
  { key: "customerName", label: "Customer", group: "customer", sms: true, mobile: true, mobileAlways: true },
  { key: "primaryPhone", label: "Phone", group: "customer", sms: true, mobile: true, mobileAlways: true },
  { key: "customerEmail", label: "Customer email", group: "customer", sms: false, mobile: false },
  { key: "address", label: "Address", group: "customer", sms: true, mobile: true, mobileAlways: true },
  { key: "appointmentDate", label: "Appointment", group: "customer", sms: true, mobile: true },
  { key: "appointmentTime", label: "Time", group: "customer", sms: true, mobile: true },
  { key: "vehicleInfo", label: "Vehicle", group: "vehicle", sms: true, mobile: true },
  { key: "bodyType", label: "Body type", group: "vehicle", sms: false, mobile: true },
  { key: "vin", label: "VIN", group: "vehicle", sms: false, mobile: true },
  { key: "licensePlate", label: "License plate", group: "vehicle", sms: false, mobile: true },
  { key: "partNumber", label: "Part", group: "job", sms: true, mobile: true },
  { key: "nagsDescription", label: "Part description", group: "job", sms: false, mobile: true },
  { key: "jobType", label: "Job type", group: "job", sms: true, mobile: true },
  { key: "distributor", label: "Pick up at", group: "job", sms: true, mobile: true },
  { key: "requisition", label: "Requisition #", group: "job", sms: false, mobile: true },
  { key: "specialInstructions", label: "Special instructions", group: "job", sms: true, mobile: true },
  { key: "techInstructions", label: "Technician instructions", group: "job", sms: true, mobile: true },
  { key: "customerNotes", label: "Customer notes", group: "job", sms: false, mobile: true },
  { key: "insuranceInfo", label: "Insurance", group: "job", sms: false, mobile: true, sensitive: true },
  { key: "customerPaymentMethod", label: "Customer pays with", group: "money", sms: false, mobile: false },
  { key: "balanceToCollect", label: "Balance to collect", group: "money", sms: true, mobile: true },
  { key: "salePrice", label: "Sale price", group: "money", sms: false, mobile: false, sensitive: true },
  { key: "technicianPay", label: "Your pay", group: "money", sms: true, mobile: false, sensitive: true },
  { key: "mobileLink", label: "View details", group: "access", sms: true, mobile: false, smsOnly: true },
];
const KEYS = new Set(CATALOG.map((c) => c.key));
const ATTACHMENTS = ["damagePhotos", "customerPhotos", "insuranceCard", "workOrderPdf", "quotePdf"];

function porDefecto() {
  return {
    header: "AUTO GLASS WORK ORDER",
    footer: "",
    fields: CATALOG.map((c) => ({ key: c.key, label: c.label, sms: c.sms, mobile: c.mobile, skipEmpty: true })),
    attachments: Object.fromEntries(ATTACHMENTS.map((a) => [a, true])),
    updatedAt: null,
    updatedBy: null,
  };
}

let config = loadOrSeed(FILE, porDefecto);

// Lo guardado + lo que el catálogo tenga nuevo (al final), sin campos que ya no existan. Las reglas
// fijas (mobileAlways, smsOnly) se imponen siempre, aunque el archivo diga otra cosa.
function normalizar(c) {
  const base = porDefecto();
  const vistos = new Set();
  const fields = [];
  for (const f of Array.isArray(c?.fields) ? c.fields : []) {
    if (!KEYS.has(f?.key) || vistos.has(f.key)) continue;
    vistos.add(f.key);
    const cat = CATALOG.find((x) => x.key === f.key);
    fields.push({
      key: f.key,
      label: String(f.label ?? "").trim().slice(0, 60) || cat.label,
      sms: !!f.sms,
      mobile: cat.smsOnly ? false : cat.mobileAlways ? true : !!f.mobile,
      skipEmpty: f.skipEmpty !== false,
    });
  }
  for (const f of base.fields) if (!vistos.has(f.key)) fields.push(f);
  const att = {};
  for (const a of ATTACHMENTS) att[a] = c?.attachments?.[a] !== undefined ? !!c.attachments[a] : true;
  return {
    header: String(c?.header ?? base.header).slice(0, 80),
    footer: String(c?.footer ?? "").slice(0, 300),
    fields,
    attachments: att,
    updatedAt: c?.updatedAt || null,
    updatedBy: c?.updatedBy || null,
  };
}

function get() {
  return { ...normalizar(config), catalog: CATALOG, attachmentKeys: ATTACHMENTS };
}

function update(data, usuario) {
  config = normalizar({ ...data, updatedAt: new Date().toISOString(), updatedBy: usuario || null });
  save(FILE, config);
  return get();
}

function reset(usuario) {
  config = { ...porDefecto(), updatedAt: new Date().toISOString(), updatedBy: usuario || null };
  save(FILE, config);
  return get();
}

module.exports = { get, update, reset, CATALOG };
