const { loadOrSeed, save, nextIdFrom } = require("../lib/persistence");

// Venta de leads (Antonio, 19-sep-2026): los trabajos que no le convienen a Reyes se venden como
// dato a técnicos/talleres terceros por un precio fijo (escalera por valor del trabajo), exclusivo
// (se lo queda el primero que paga) y "pay to unlock" por Stripe. Reyes se desliga del trabajo.
//
// Dos objetos en app_data (OJO: claves nuevas → sembrar con scripts/_sembrar-leads-app-data.js):
//   leadBuyers.json   — catálogo de compradores
//   leadSettings.json — escalera de precios, vencimiento y textos

const BUYERS_FILE = "leadBuyers.json";
const SETTINGS_FILE = "leadSettings.json";

let buyers = loadOrSeed(BUYERS_FILE, () => []);
let nextId = nextIdFrom(buyers);

function defaultSettings() {
  return {
    // Escalera: el precio del lead según lo que el cliente paga (se usa totalSale o el precio
    // sugerido del cliente). `upTo` null = sin tope. Chip repair tiene su propio precio.
    ladder: [
      { upTo: 300, price: 30 },
      { upTo: 450, price: 40 },
      { upTo: 700, price: 60 },
      { upTo: null, price: 80 },
    ],
    chipRepairPrice: 30,
    expiresHours: 24,
    // Incluir en la oferta el costo aprox. de la parte y lo que le quedaría al tech. Vende más,
    // pero enseña el costo de parte de Reyes: apagado hasta que Antonio decida.
    showTakeInOffer: false,
    // Adelanto al comprador (sin contacto). Variables: {area} {vehicle} {job} {when} {price} {url} {yourTake}
    teaserSms: "Reyes Auto Glass lead in {area}: {vehicle}, {job}. {when} ${price} — pay to get the customer's name and phone: {url} First to pay gets it.",
    // Aviso al cliente cuando el lead se vende.
    customerNoticeSms: "Reyes Auto Glass Group: we are not able to take your job, but we passed your request to a trusted partner shop who will contact you shortly. Thank you!",
    // Contrato que el comprador acepta con un clic la primera vez.
    buyerTerms: [
      "Lead purchase terms — Reyes Auto Glass Group",
      "1. You are buying customer contact information (a \"lead\"), not a job. Leads are sold as is, with no guarantee that the customer will book, answer, or pay.",
      "2. Once you pay, the lead is exclusive to you and is not resold.",
      "3. You are solely responsible for contacting the customer, quoting, sourcing parts, performing the work, collecting payment, warranty and any complaint. Reyes Auto Glass Group is not a party to your transaction with the customer and has no liability for it.",
      "4. Refund (as credit) only if the phone number is invalid or the customer was already served, reported within 24 hours of purchase.",
      "5. You agree to contact customers in a lawful manner and not to present yourself as Reyes Auto Glass Group.",
    ].join("\n"),
    updatedAt: null,
    updatedBy: null,
  };
}
let settings = loadOrSeed(SETTINGS_FILE, defaultSettings);

function normalizeBuyer(b, prev = {}) {
  const num = (v, d = 0) => (v === "" || v === undefined || v === null ? d : Number(v));
  return {
    id: prev.id,
    name: String(b.name ?? prev.name ?? "").trim().slice(0, 80),
    company: String(b.company ?? prev.company ?? "").trim().slice(0, 80),
    phone: String(b.phone ?? prev.phone ?? "").trim().slice(0, 30),
    email: String(b.email ?? prev.email ?? "").trim().slice(0, 120),
    zones: String(b.zones ?? prev.zones ?? "").trim().slice(0, 300), // texto libre: ciudades, condados, ZIPs
    jobTypes: String(b.jobTypes ?? prev.jobTypes ?? "").trim().slice(0, 200),
    notes: String(b.notes ?? prev.notes ?? "").trim().slice(0, 500),
    // Lo mínimo que quiere ganar de labor: solo para mostrarle "your take" en el adelanto.
    laborMin: num(b.laborMin ?? prev.laborMin, 0),
    active: b.active === undefined ? (prev.active ?? true) : Boolean(b.active),
    termsAcceptedAt: prev.termsAcceptedAt || null,
    createdAt: prev.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

function listBuyers() {
  return [...buyers].sort((a, b) => a.name.localeCompare(b.name));
}
function getBuyer(id) {
  return buyers.find((b) => b.id === Number(id)) || null;
}
function createBuyer(data) {
  const b = normalizeBuyer(data, { id: nextId });
  if (!b.name) throw new Error("Name is required");
  buyers.push(b);
  nextId += 1;
  save(BUYERS_FILE, buyers);
  return b;
}
function updateBuyer(id, data) {
  const i = buyers.findIndex((b) => b.id === Number(id));
  if (i < 0) return null;
  buyers[i] = normalizeBuyer(data, buyers[i]);
  save(BUYERS_FILE, buyers);
  return buyers[i];
}
function acceptTerms(id) {
  const b = getBuyer(id);
  if (!b) return null;
  if (!b.termsAcceptedAt) { b.termsAcceptedAt = new Date().toISOString(); save(BUYERS_FILE, buyers); }
  return b;
}
function removeBuyer(id) {
  const i = buyers.findIndex((b) => b.id === Number(id));
  if (i < 0) return false;
  buyers.splice(i, 1);
  save(BUYERS_FILE, buyers);
  return true;
}

function getSettings() {
  return { ...defaultSettings(), ...settings };
}
function updateSettings(data, user) {
  const base = getSettings();
  const ladder = Array.isArray(data.ladder)
    ? data.ladder.map((r) => ({ upTo: r.upTo === null || r.upTo === "" || r.upTo === undefined ? null : Number(r.upTo), price: Number(r.price) || 0 }))
        .filter((r) => r.price > 0).sort((a, b) => (a.upTo === null ? 1 : b.upTo === null ? -1 : a.upTo - b.upTo))
    : base.ladder;
  settings = {
    ...base,
    ladder,
    chipRepairPrice: Number(data.chipRepairPrice ?? base.chipRepairPrice) || 0,
    expiresHours: Math.max(1, Number(data.expiresHours ?? base.expiresHours) || 24),
    showTakeInOffer: data.showTakeInOffer === undefined ? base.showTakeInOffer : (data.showTakeInOffer === true || data.showTakeInOffer === "true"),
    teaserSms: String(data.teaserSms ?? base.teaserSms).slice(0, 600),
    customerNoticeSms: String(data.customerNoticeSms ?? base.customerNoticeSms).slice(0, 400),
    buyerTerms: String(data.buyerTerms ?? base.buyerTerms).slice(0, 5000),
    updatedAt: new Date().toISOString(),
    updatedBy: user || null,
  };
  save(SETTINGS_FILE, settings);
  return getSettings();
}

// Precio sugerido del lead: chip repair fijo; si no, escalera por lo que paga el cliente.
function suggestedPrice({ customerPrice, isChipRepair }) {
  const s = getSettings();
  if (isChipRepair) return s.chipRepairPrice;
  const v = Number(customerPrice || 0);
  for (const r of s.ladder) if (r.upTo === null || v <= r.upTo) return r.price;
  return s.ladder[s.ladder.length - 1]?.price || 0;
}

module.exports = { listBuyers, getBuyer, createBuyer, updateBuyer, acceptTerms, removeBuyer, getSettings, updateSettings, suggestedPrice };
