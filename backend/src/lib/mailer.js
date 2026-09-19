// Correo saliente por Resend (https://resend.com), con fetch nativo: sin dependencia nueva.
//
// Antonio (19-sep-2026) quiso que el CRM mande la factura por correo sin abrir su cliente de correo.
// Sale desde el dominio crmreyesautoglassgroup.com, que él administra (DNS verificado en Resend).
// Variables en Railway (backend):
//   RESEND_API_KEY  — llave "re_…" de Resend
//   EMAIL_FROM      — "Reyes Auto Glass Group <invoices@crmreyesautoglassgroup.com>"
//   EMAIL_REPLY_TO  — opcional, a dónde llegan las respuestas (info@reyesautoglassgroup.com)
// Sin RESEND_API_KEY el servicio se reporta "no configurado" y el botón de envío automático no
// aparece; nada truena.

const API = "https://api.resend.com/emails";

function isConfigured() {
  return Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM);
}

function status() {
  return {
    configured: isConfigured(),
    provider: "resend",
    from: process.env.EMAIL_FROM || "",
    replyTo: process.env.EMAIL_REPLY_TO || "",
    missing: ["RESEND_API_KEY", "EMAIL_FROM"].filter((k) => !process.env[k]),
  };
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Devuelve { id } de Resend. Lanza Error con el mensaje del proveedor si no se pudo mandar.
async function sendEmail({ to, subject, html, text, replyTo }) {
  if (!isConfigured()) throw new Error("Email is not configured (RESEND_API_KEY / EMAIL_FROM)");
  const destinos = (Array.isArray(to) ? to : [to]).map((s) => String(s || "").trim()).filter(Boolean);
  if (!destinos.length || destinos.some((d) => !EMAIL_RE.test(d))) throw new Error(`Invalid email address: ${destinos.join(", ") || "(empty)"}`);
  const body = {
    from: process.env.EMAIL_FROM,
    to: destinos,
    subject: String(subject || "").slice(0, 200),
    html,
    text,
  };
  const rt = replyTo || process.env.EMAIL_REPLY_TO;
  if (rt) body.reply_to = rt;
  const res = await fetch(API, {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.message || data?.error || `Resend HTTP ${res.status}`);
  return { id: data.id };
}

module.exports = { isConfigured, status, sendEmail, EMAIL_RE };
