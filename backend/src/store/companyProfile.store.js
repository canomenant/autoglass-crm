const { loadOrSeed, save } = require("../lib/persistence");

// Perfil de la empresa: lo que va impreso en todo papel que sale al cliente (factura, statement):
// nombre, dirección, teléfono, licencia, garantía y términos. Antonio (19-sep-2026) lo pidió al ver
// la factura pública sin datos de la empresa ni link de garantía, y la tarjeta "Company Profile"
// de Settings vacía. Objeto único, como partnerDistributionSettings. No guarda nada secreto: todo
// lo que hay aquí se imprime en la factura, por eso la lectura pública no filtra campos.
//
// OJO: un store nuevo necesita su fila sembrada en app_data (scripts/_sembrar-company-profile.js);
// si no, save() solo escribe el archivo local y Railway lo pierde al redesplegar.

const FILE = "companyProfile.json";

const CAMPOS = {
  name: 80, legalName: 120, tagline: 120,
  address: 120, city: 60, state: 20, zip: 12,
  phone: 30, altPhone: 30, email: 80, website: 120,
  licenseLabel: 40, licenseNumber: 40, taxIdLabel: 40,
  warrantyUrl: 200, warrantyTitle: 80, warrantyText: 4000,
  invoiceTerms: 1500, invoiceFooter: 300, paymentInstructions: 600,
};

function porDefecto() {
  return {
    name: "Reyes Auto Glass Group",
    legalName: "", tagline: "Mobile auto glass replacement & ADAS calibration",
    address: "", city: "", state: "CA", zip: "",
    phone: "", altPhone: "", email: "info@reyesautoglassgroup.com", website: "reyesautoglassgroup.com",
    licenseLabel: "BAR ARD #", licenseNumber: "", taxIdLabel: "",
    warrantyUrl: "", warrantyTitle: "Lifetime warranty",
    warrantyText: "",
    invoiceTerms: "Payment is due upon receipt unless otherwise agreed. Please contact us with any questions regarding this invoice.",
    invoiceFooter: "Thank you for your business!",
    paymentInstructions: "",
  };
}

function normalizar(c) {
  const base = porDefecto();
  const out = {};
  for (const [k, max] of Object.entries(CAMPOS)) out[k] = String(c?.[k] ?? base[k] ?? "").trim().slice(0, max);
  out.updatedAt = c?.updatedAt || null;
  out.updatedBy = c?.updatedBy || null;
  return out;
}

let profile = normalizar(loadOrSeed(FILE, porDefecto));

function get() {
  return { ...profile };
}

// Dirección en una línea, para pies de página y encabezados.
function addressLine(p = profile) {
  const ciudad = [p.city, [p.state, p.zip].filter(Boolean).join(" ")].filter(Boolean).join(", ");
  return [p.address, ciudad].filter(Boolean).join(", ");
}

function update(data, usuario) {
  profile = normalizar({ ...profile, ...data, updatedAt: new Date().toISOString(), updatedBy: usuario || null });
  save(FILE, profile);
  return get();
}

module.exports = { get, update, addressLine, FIELDS: Object.keys(CAMPOS) };
