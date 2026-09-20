// Mensajes de texto por Twilio, con fetch nativo (sin dependencia). Antonio, 19-sep-2026.
// Variables en Railway (backend):
//   TWILIO_ACCOUNT_SID  — "AC…"
//   TWILIO_AUTH_TOKEN
//   TWILIO_FROM         — número de Twilio en formato +1XXXXXXXXXX (o un Messaging Service "MG…")
// Sin ellas el servicio se reporta "no configurado" y los botones de envío automático no aparecen.
// Cuenta de prueba de Twilio: solo manda a números verificados en Twilio y antepone "Sent from your
// Twilio trial account"; para mandar a cualquier cliente hay que verificar el número (toll-free) o
// registrar el negocio (A2P 10DLC).

const env = (k) => String(process.env[k] || "").trim();

function isConfigured() {
  return Boolean(env("TWILIO_ACCOUNT_SID") && env("TWILIO_AUTH_TOKEN") && env("TWILIO_FROM"));
}

function status() {
  return {
    configured: isConfigured(),
    provider: "twilio",
    from: env("TWILIO_FROM"),
    missing: ["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_FROM"].filter((k) => !env(k)),
  };
}

// Teléfonos de EE.UU. a E.164 (+1 y 10 dígitos). Cualquier otra cosa → null (no se manda a ciegas).
function normalizeUS(phone) {
  const d = String(phone || "").replace(/\D/g, "");
  if (d.length === 10) return `+1${d}`;
  if (d.length === 11 && d.startsWith("1")) return `+${d}`;
  return null;
}

// Devuelve { sid, status }. Lanza Error con el mensaje de Twilio si no se pudo mandar.
async function sendSms({ to, body }) {
  if (!isConfigured()) throw new Error("SMS is not configured (TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN / TWILIO_FROM)");
  const dest = normalizeUS(to);
  if (!dest) throw new Error(`Invalid US phone number: ${to || "(empty)"}`);
  const texto = String(body || "").trim();
  if (!texto) throw new Error("Empty message");
  const sid = env("TWILIO_ACCOUNT_SID"), token = env("TWILIO_AUTH_TOKEN"), from = env("TWILIO_FROM");
  const form = new URLSearchParams({ To: dest, Body: texto.slice(0, 1600) });
  // TWILIO_FROM pegado sin el "+" (18555167046) → E.164; Twilio lo rechaza sin él.
  if (from.startsWith("MG")) form.set("MessagingServiceSid", from);
  else form.set("From", normalizeUS(from) || from);
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: "POST",
    headers: { Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString("base64")}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: form.toString(),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.message ? `${data.message}${data.code ? ` (Twilio ${data.code})` : ""}` : `Twilio HTTP ${res.status}`);
  return { sid: data.sid, status: data.status, to: dest };
}

module.exports = { isConfigured, status, sendSms, normalizeUS };
