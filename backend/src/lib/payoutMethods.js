// Cómo se le manda el pago a un técnico o a un agente. Espejo de frontend/src/lib/payoutMethods.js:
// si aquí se agrega un método, allá también (Antonio, 21-sep-2026).
//
// Es un subconjunto del catálogo de métodos de pago: sólo lo que sirve para MANDAR dinero. Las
// tarjetas y "We Have CC In File" son formas en que el CLIENTE nos paga, no vías para pagarle a
// alguien.
const PAYOUT_METHODS = ["Zelle", "PayPal", "Venmo", "Cash App", "Check", "ACH Transfer", "Bank Transfer", "Wire Transfer", "Cash"];

// Efectivo no lleva destino: se le entrega en mano.
const SIN_DESTINO = new Set(["Cash"]);

const LIMITES = { handle: 120, holderName: 120, notes: 300 };

// Saneado de lo que llega de la ficha. Descarta lo que no tenga método conocido, recorta y deja a
// lo sumo UNA preferida (la primera marcada) para que quien paga no tenga que elegir.
function normalizePayoutMethods(value) {
  if (!Array.isArray(value)) return [];
  let yaHayPreferida = false;
  const out = [];
  for (const raw of value.slice(0, 10)) {
    const method = String(raw?.method || "").trim();
    if (!PAYOUT_METHODS.includes(method)) continue;
    const handle = String(raw?.handle || "").trim().slice(0, LIMITES.handle);
    // Sin método de entrega en mano y sin destino no hay nada que guardar.
    if (!handle && !SIN_DESTINO.has(method)) continue;
    const preferred = !yaHayPreferida && raw?.preferred === true;
    if (preferred) yaHayPreferida = true;
    out.push({
      method,
      handle,
      holderName: String(raw?.holderName || "").trim().slice(0, LIMITES.holderName),
      notes: String(raw?.notes || "").trim().slice(0, LIMITES.notes),
      preferred,
    });
  }
  // Si nadie marcó preferida, la primera lo es: siempre hay una respuesta a "¿por dónde le pago?".
  if (out.length && !yaHayPreferida) out[0].preferred = true;
  return out;
}

// Una línea para quien va a mandar el dinero: "Zelle · 469-610-6271 · Efficiency Auto Glass".
function describePayoutMethod(m) {
  if (!m) return "";
  // Un destino de 10 dígitos es un teléfono: va con el formato de todo el CRM, no en crudo.
  const d = String(m.handle || "").replace(/\D/g, "");
  const esTelefono = d.length === 10 && /^[\d()\s.+-]+$/.test(String(m.handle || ""));
  const destino = esTelefono ? "(" + d.slice(0, 3) + ") " + d.slice(3, 6) + "-" + d.slice(6) : m.handle;
  return [m.method, destino, m.holderName].filter(Boolean).join(" · ");
}

function preferredPayoutMethod(list) {
  const arr = Array.isArray(list) ? list : [];
  return arr.find((m) => m.preferred) || arr[0] || null;
}

module.exports = { PAYOUT_METHODS, SIN_DESTINO, normalizePayoutMethods, describePayoutMethod, preferredPayoutMethod };
