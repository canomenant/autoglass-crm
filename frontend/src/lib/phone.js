// Un solo formato de teléfono en todo el CRM: (###) ###-#### (Antonio, 20-sep-2026). Los campos
// guardan sólo dígitos (PhoneInput); esto es para MOSTRAR, y tolera lo histórico: números con
// prefijo 1, con guiones o con espacios. Lo que no sea un número de 10 dígitos sale tal cual.
export function phoneDigits(v) {
  return String(v || "").replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "");
}

export function formatPhone(v) {
  const d = phoneDigits(v);
  return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : String(v || "");
}
