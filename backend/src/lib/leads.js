// Venta de leads: armar el paquete y el adelanto desde la orden, mandar el adelanto a los
// compradores, entregar el paquete al que pagó y avisar al cliente. Antonio, 19-sep-2026.
// Sin Twilio el SMS no sale (queda registrado como no enviado); sin Resend, el correo tampoco.

const sms = require("./sms");
const mailer = require("./mailer");
const leadBuyers = require("../store/leadBuyers.store");
const leadSales = require("../store/leadSales.store");
const customerMessages = require("../store/customerMessages.store");

const frontendUrl = () => String(process.env.FRONTEND_URL || "").replace(/[/]$/, "");
const money = (n) => `$${Number(n || 0).toFixed(2)}`;
const firstName = (s) => String(s || "").trim().split(/\s+/)[0] || "";

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// Zona pública: ciudad + ZIP (o lo que haya en la dirección), sin la calle.
function areaOf(wo) {
  const zip = String(wo.zipCode || "").trim() || (String(wo.address || "").match(/\b\d{5}\b/) || [])[0] || "";
  let city = String(wo.city || "").trim();
  if (!city) {
    // "747 S Avenue 60, Los Angeles, CA 90042, EE. UU." → "Los Angeles"
    const partes = String(wo.address || "").split(",").map((s) => s.trim()).filter(Boolean);
    if (partes.length >= 3) city = partes[partes.length - 3];
    else if (partes.length === 2) city = partes[0];
  }
  return [city, zip].filter(Boolean).join(" ") || String(wo.state || "").trim() || "your area";
}

function jobOf(wo, quote) {
  const items = quote?.lineItems || [];
  const tipos = [...new Set(items.map((li) => li.jobType).filter(Boolean))];
  const job = tipos.length ? tipos.join(", ") : (wo.glassType || "auto glass job");
  const calib = items.some((li) => li.calibrationType) || Boolean(wo.calibrationType);
  return { job: calib ? `${job} + ADAS calibration` : job, calibration: calib, types: tipos };
}

function whenOf(wo) {
  if (!wo.appointmentDate) return "Customer is flexible on date.";
  const w = wo.appointmentWindow === "AM" ? "morning" : wo.appointmentWindow === "PM" ? "afternoon" : (wo.startTime ? `at ${wo.startTime}` : "");
  return `Customer wants it ${wo.appointmentDate}${w ? ` (${w})` : ""}.`;
}

// Lo que se guarda y se entrega. NUNCA precios ni costos de Reyes.
// Costo de la parte según la cotización (pricePart de los renglones que se deben al distribuidor,
// ya sumado en totals.partCost) o, si no hay cotización, lo que la orden guardó.
function partCostOf(wo, quote) {
  const c = Number(quote?.totals?.partCost ?? wo.glassCost ?? 0);
  return c > 0 ? Math.round(c * 100) / 100 : 0;
}

function buildPackage(wo, quote) {
  const items = quote?.lineItems || [];
  const v = wo.vehicle || {};
  const { job, calibration, types } = jobOf(wo, quote);
  return {
    workOrderNo: wo.workOrderNo,
    customerName: wo.customerName || "",
    phone: wo.phone || "",
    altPhone: wo.mobile || "",
    email: wo.email || "",
    address: wo.address || "",
    city: wo.city || "",
    state: wo.state || "",
    zip: wo.zipCode || "",
    vehicle: [v.year, v.make, v.model].filter(Boolean).join(" "),
    bodyType: v.bodyType || "",
    vin: v.vin || "",
    plate: v.plate || "",
    job,
    jobTypes: types,
    calibration,
    parts: dedupe(items.map((li) => ({ jobType: li.jobType || "", partNumber: li.partNumber || "", description: li.nagsDescription || "", calibrationType: li.calibrationType || "" })).filter((p) => p.partNumber || p.description)),
    appointmentDate: wo.appointmentDate || "",
    appointmentWindow: wo.appointmentWindow || "",
    startTime: wo.startTime || "",
    customerBudget: Number(quote?.customerSuggestedPrice || 0) || null, // lo que el cliente dijo que paga (si lo dijo)
    notes: [quote?.damageNotes, wo.specialInstructions].filter(Boolean).join(" · "),
    paymentType: quote?.paymentType || "",
    insuranceCompany: wo.insuranceCompanyName || "",
    customerPrice: Number(wo.totalSale || 0) || null,
    partCost: partCostOf(wo, quote) || null,
  };
}

// Lo que ve antes de pagar: sin nombre, teléfono, correo ni calle.
function buildTeaser(wo, quote, pkg) {
  const settings = leadBuyers.getSettings();
  return {
    // Solo si Antonio lo enciende: precio al cliente y costo aprox. de parte, para calcular "your take".
    ...(settings.showTakeInOffer ? { customerPrice: pkg.customerPrice, partCost: pkg.partCost } : {}),
    area: areaOf(wo),
    vehicle: pkg.vehicle || "vehicle",
    job: pkg.job,
    calibration: pkg.calibration,
    when: whenOf(wo),
    parts: [...new Set(pkg.parts.map((p) => p.partNumber).filter(Boolean))],
    customerBudget: pkg.customerBudget,
    paymentType: pkg.paymentType,
  };
}

// Quita renglones repetidos (misma parte/descripción).
function dedupe(list) {
  const seen = new Set();
  return list.filter((p) => { const k = [p.jobType, p.partNumber, p.description].join("|"); if (seen.has(k)) return false; seen.add(k); return true; });
}

function fill(template, vars) {
  return String(template || "").replace(/\{(\w+)\}/g, (_, k) => (vars[k] === undefined || vars[k] === null ? "" : String(vars[k])));
}

function teaserText(sale, offer, settings) {
  const url = `${frontendUrl()}/lead/${offer.token}`;
  const t = sale.teaser;
  const budget = t.customerBudget ? ` Customer budget ≈ ${money(t.customerBudget)}.` : "";
  const take = t.customerPrice ? ` Customer pays ${money(t.customerPrice)}${t.partCost ? `, part ≈ ${money(t.partCost)}` : ""}; your take after part & lead ≈ ${money(t.customerPrice - (t.partCost || 0) - Number(sale.price))}.` : "";
  return fill(settings.teaserSms, { area: t.area, vehicle: t.vehicle, job: t.job, when: `${t.when}${budget}${take}`, price: Number(sale.price).toFixed(0), url });
}

function teaserHtml(sale, offer, settings) {
  const url = `${frontendUrl()}/lead/${offer.token}`;
  const t = sale.teaser;
  return `<div style="font-family:Segoe UI,Arial,sans-serif;font-size:15px;color:#111;max-width:520px">
<p><b>New lead available — ${esc(t.area)}</b></p>
<ul>
<li>Vehicle: ${esc(t.vehicle)}</li>
<li>Job: ${esc(t.job)}${t.parts?.length ? ` (${esc(t.parts.join(", "))})` : ""}</li>
<li>${esc(t.when)}${t.customerBudget ? ` Customer budget ≈ ${money(t.customerBudget)}.` : ""}</li>
${t.customerPrice ? `<li>Customer pays ${money(t.customerPrice)}${t.partCost ? ` · part ≈ ${money(t.partCost)}` : ""} · <b>your take after part &amp; lead ≈ ${money(t.customerPrice - (t.partCost || 0) - Number(sale.price))}</b></li>` : ""}
<li>Payment: ${esc(t.paymentType || "customer pays")}</li>
</ul>
<p>Lead price: <b>${money(sale.price)}</b> — exclusive, first to pay gets it.</p>
<p><a href="${url}" style="display:inline-block;background:#111;color:#fff;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:600">View lead &amp; pay to unlock</a></p>
<p style="color:#666;font-size:12px">Reyes Auto Glass Group · lead sales</p></div>`;
}

function packageText(sale) {
  const p = sale.package;
  const when = [p.appointmentDate, p.appointmentWindow === "AM" ? "morning" : p.appointmentWindow === "PM" ? "afternoon" : p.startTime].filter(Boolean).join(" ");
  return [
    `Reyes Auto Glass lead — PAID. Customer details:`,
    `${p.customerName} — ${p.phone}${p.altPhone ? ` / ${p.altPhone}` : ""}${p.email ? ` — ${p.email}` : ""}`,
    `${p.address}${p.city && !String(p.address).includes(p.city) ? `, ${p.city}` : ""}${p.zip && !String(p.address).includes(p.zip) ? ` ${p.zip}` : ""}`,
    `${p.vehicle}${p.vin ? ` · VIN ${p.vin}` : ""}${p.plate ? ` · plate ${p.plate}` : ""}`,
    `Job: ${p.job}${p.parts?.length ? ` — ${p.parts.map((x) => [x.jobType, x.partNumber, x.description].filter(Boolean).join(" ")).join("; ")}` : ""}`,
    when ? `Wanted: ${when}` : "Date: flexible",
    p.customerBudget ? `Customer budget ≈ ${money(p.customerBudget)}` : "",
    p.notes ? `Notes: ${p.notes}` : "",
    `Customer has been told a partner shop will contact them. Please call soon. Details: ${frontendUrl()}/lead/${sale.offers.find((o) => o.status === "paid")?.token || ""}`,
  ].filter(Boolean).join("\n");
}

function packageHtml(sale) {
  return `<div style="font-family:Segoe UI,Arial,sans-serif;font-size:15px;color:#111;max-width:520px"><pre style="white-space:pre-wrap;font-family:inherit">${esc(packageText(sale))}</pre></div>`;
}

// Manda el adelanto a cada comprador (SMS y correo, lo que haya). Devuelve las ofertas con resultado.
async function sendOffers(sale) {
  const settings = leadBuyers.getSettings();
  const offers = [];
  for (const o of sale.offers) {
    const res = { sms: null, email: null };
    const text = teaserText(sale, o, settings);
    if (sms.isConfigured() && sms.normalizeUS(o.phone)) {
      try { const r = await sms.sendSms({ to: o.phone, body: text }); res.sms = { ok: true, sid: r.sid }; }
      catch (e) { res.sms = { ok: false, error: e.message }; }
    }
    if (mailer.isConfigured() && mailer.EMAIL_RE.test(o.email || "")) {
      try { const r = await mailer.sendEmail({ to: o.email, subject: `New lead — ${sale.teaser.vehicle} in ${sale.teaser.area} — ${money(sale.price)}`, html: teaserHtml(sale, o, settings), text }); res.email = { ok: true, id: r.id }; }
      catch (e) { res.email = { ok: false, error: e.message }; }
    }
    offers.push({ ...o, sentAt: new Date().toISOString(), sendResult: res });
  }
  return leadSales.setOffers(sale.id, offers);
}

// Entrega al comprador que pagó + aviso al cliente.
async function deliver(sale, workOrder) {
  const settings = leadBuyers.getSettings();
  const offer = sale.offers.find((o) => o.status === "paid");
  const delivery = { sms: null, email: null, customerSms: null };
  if (offer) {
    const text = packageText(sale);
    if (sms.isConfigured() && sms.normalizeUS(offer.phone)) {
      try { const r = await sms.sendSms({ to: offer.phone, body: text }); delivery.sms = { ok: true, sid: r.sid }; }
      catch (e) { delivery.sms = { ok: false, error: e.message }; }
    }
    if (mailer.isConfigured() && mailer.EMAIL_RE.test(offer.email || "")) {
      try { const r = await mailer.sendEmail({ to: offer.email, subject: `Lead details — ${sale.package.vehicle} — ${sale.package.customerName}`, html: packageHtml(sale), text }); delivery.email = { ok: true, id: r.id }; }
      catch (e) { delivery.email = { ok: false, error: e.message }; }
    }
  }
  let customerNotified = false;
  if (workOrder && sms.isConfigured() && sms.normalizeUS(workOrder.phone) && settings.customerNoticeSms) {
    try {
      const r = await sms.sendSms({ to: workOrder.phone, body: settings.customerNoticeSms });
      delivery.customerSms = { ok: true, sid: r.sid }; customerNotified = true;
      customerMessages.create({ workOrderId: workOrder.id, workOrderNo: workOrder.workOrderNo, kind: "lead_sold_notice", to: r.to, body: settings.customerNoticeSms, status: "sent", providerId: r.sid, sentBy: "System" });
    } catch (e) { delivery.customerSms = { ok: false, error: e.message }; }
  }
  return leadSales.markDelivered(sale.id, delivery, customerNotified);
}

module.exports = { buildPackage, buildTeaser, sendOffers, deliver, teaserText, packageText, areaOf };
