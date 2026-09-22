// Qué métodos de pago ofrece cada pantalla: los de COBRO (el cliente nos paga) o los de PAGO
// (nosotros pagamos a técnicos, distribuidores y gastos). El catálogo lo dice en `direction`:
// "in", "out" o "both" (Settings → Payment Method).
//
// Nació porque el cobro de la orden ofrecía las cuentas de la empresa —Capital One ****4360,
// Chase, Business Card— con las que ningún cliente ha pagado nunca (Antonio, 21-sep-2026).
export const DIRECTIONS = ["in", "out", "both"];

export function filterByDirection(methods, direction) {
  return (methods || []).filter((m) => {
    const d = m?.direction || "both";
    return d === "both" || d === direction;
  });
}

// Las opciones del desplegable. `current` es lo que la orden ya tiene guardado: aunque su método
// haya salido de la lista (o sea uno viejo como "Stripe"), tiene que seguir viéndose, si no el
// campo aparece vacío y el primer guardado borra el dato.
export function methodOptions(methods, direction, current) {
  const lista = filterByDirection(methods, direction).map((m) => ({ value: m.name, label: m.name }));
  if (current && !lista.some((o) => o.value === current)) lista.unshift({ value: current, label: current });
  return lista;
}
