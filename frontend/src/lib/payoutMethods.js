// Cómo se le manda el pago a un técnico o a un agente. Espejo de backend/src/lib/payoutMethods.js:
// si aquí se agrega un método, allá también (Antonio, 21-sep-2026).
//
// Es un subconjunto del catálogo de métodos de pago: sólo lo que sirve para MANDAR dinero. Las
// tarjetas y "We Have CC In File" son formas en que el CLIENTE nos paga, no vías para pagarle a
// alguien.
export const PAYOUT_METHODS = ["Zelle", "PayPal", "Venmo", "Cash App", "Check", "ACH Transfer", "Bank Transfer", "Wire Transfer", "Cash"];

// El efectivo se entrega en mano: no hay destino que capturar.
export const NO_HANDLE = new Set(["Cash"]);

// Qué se pide como destino según el método. La etiqueta correcta evita el error de capturar un
// correo donde va un teléfono.
export const HANDLE_HINT = {
  Zelle: { key: "handleZelle", placeholder: "(469) 610-6271 o correo" },
  PayPal: { key: "handleEmail", placeholder: "nombre@correo.com" },
  Venmo: { key: "handleUser", placeholder: "@usuario" },
  "Cash App": { key: "handleCashtag", placeholder: "$cashtag" },
  Check: { key: "handlePayableTo", placeholder: "Efficiency Auto Glass" },
  "ACH Transfer": { key: "handleBank", placeholder: "Banco · cuenta" },
  "Bank Transfer": { key: "handleBank", placeholder: "Banco · cuenta" },
  "Wire Transfer": { key: "handleBank", placeholder: "Banco · cuenta" },
};

export function emptyPayoutMethod() {
  return { method: "Zelle", handle: "", holderName: "", notes: "", preferred: false };
}

// Una línea para quien va a mandar el dinero: "Zelle · (469) 610-6271 · Efficiency Auto Glass".
export function describePayoutMethod(m) {
  if (!m) return "";
  // Un destino de 10 dígitos es un teléfono: va con el formato de todo el CRM, no en crudo.
  const d = String(m.handle || "").replace(/\D/g, "");
  const esTelefono = d.length === 10 && /^[\d()\s.+-]+$/.test(String(m.handle || ""));
  const destino = esTelefono ? "(" + d.slice(0, 3) + ") " + d.slice(3, 6) + "-" + d.slice(6) : m.handle;
  return [m.method, destino, m.holderName].filter(Boolean).join(" · ");
}

export function preferredPayoutMethod(list) {
  const arr = Array.isArray(list) ? list : [];
  return arr.find((m) => m.preferred) || arr[0] || null;
}
