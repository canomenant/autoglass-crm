// "Cancelled" existe en la base desde el import de AppSheet (146 cotizaciones) y ya estaba
// traducido, pero faltaba en esta lista: el <select> del formulario no tenía la opción, así que una
// cotización cancelada se abría mostrando "Draft" seleccionado. El valor guardado sobrevivía
// mientras nadie tocara el campo, pero la pantalla mentía y bastaba un clic para perderlo.
export const QUOTE_STATUSES = ["Draft", "Waiting Customer", "Ready For Review", "Approved", "Rejected", "Cancelled", "Converted"];

// "Converted" no se elige a mano: lo pone el sistema cuando existe la orden de trabajo (ver
// workorders.store.createFromQuote). Dejarlo en el selector permitía marcar como convertida una
// cotización sin orden — justo al revés de la regla.
export const SELECTABLE_QUOTE_STATUSES = QUOTE_STATUSES.filter((s) => s !== "Converted");

export function isLostStatus(status) {
  return status === "Rejected";
}

export function isConvertedStatus(status) {
  return status === "Converted";
}

// Una cotización muerta (rechazada o cancelada) no se convierte: primero hay que reabrirla
// cambiándole el estado. El resto sí, sin obligar a pasar por "Approved" — esa escala era el
// motivo de que convertir costara tres pasos y un guardado intermedio.
const NOT_CONVERTIBLE = ["Converted", "Rejected", "Cancelled"];

export function canConvertToWorkOrder(status) {
  return !NOT_CONVERTIBLE.includes(status);
}
