// Tres presentaciones del mismo estado, para que el color signifique lo mismo en toda la app:
//   - soft:   pastilla discreta, para celdas de tabla y listas densas.
//   - strong: pastilla destacada con borde, para la cabecera de la cotización.
//   - dot:    el punto de color que acompaña al texto en el menú de cambio de estado.
//
// Las clases van escritas completas a propósito: Tailwind hace purge sobre el texto del código y
// no ve un nombre de clase construido por concatenación.
const QUOTE_STATUS_STYLES = {
  Draft: {
    soft: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300",
    strong: "bg-gray-100 text-gray-700 border-gray-300 dark:bg-gray-800 dark:text-gray-200 dark:border-gray-600",
    dot: "bg-gray-400",
  },
  "Waiting Customer": {
    soft: "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300",
    strong: "bg-amber-100 text-amber-800 border-amber-300 dark:bg-amber-500/15 dark:text-amber-200 dark:border-amber-500/40",
    dot: "bg-amber-500",
  },
  "Ready For Review": {
    soft: "bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300",
    strong: "bg-blue-100 text-blue-800 border-blue-300 dark:bg-blue-500/15 dark:text-blue-200 dark:border-blue-500/40",
    dot: "bg-blue-500",
  },
  Approved: {
    soft: "bg-teal-100 text-teal-700 dark:bg-teal-500/15 dark:text-teal-300",
    strong: "bg-teal-100 text-teal-800 border-teal-300 dark:bg-teal-500/15 dark:text-teal-200 dark:border-teal-500/40",
    dot: "bg-teal-500",
  },
  Rejected: {
    soft: "bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300",
    strong: "bg-red-100 text-red-800 border-red-300 dark:bg-red-500/15 dark:text-red-200 dark:border-red-500/40",
    dot: "bg-red-500",
  },
  Cancelled: {
    soft: "bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300",
    strong: "bg-rose-100 text-rose-800 border-rose-300 dark:bg-rose-500/15 dark:text-rose-200 dark:border-rose-500/40",
    dot: "bg-rose-500",
  },
  // El único estado que se pinta en sólido: es el final del recorrido y el que más se preguntaba
  // de un vistazo ("¿esta ya tiene orden?").
  Converted: {
    soft: "bg-green-100 text-green-800 dark:bg-green-500/15 dark:text-green-300",
    strong: "bg-green-600 text-white border-green-600 dark:bg-green-600 dark:text-white dark:border-green-500",
    dot: "bg-green-600",
  },
};

const FALLBACK = QUOTE_STATUS_STYLES.Draft;

// Se mantiene exportado con la misma forma que antes (estado -> clases pastel) porque la lista de
// Quotes lo recorre para armar el filtro por estado de ConfigureViewModal.
export const QUOTE_STATUS_COLORS = Object.fromEntries(
  Object.entries(QUOTE_STATUS_STYLES).map(([status, style]) => [status, style.soft])
);

export function getQuoteStatusColorClass(status) {
  return (QUOTE_STATUS_STYLES[status] || FALLBACK).soft;
}

export function getQuoteStatusStrongClass(status) {
  return (QUOTE_STATUS_STYLES[status] || FALLBACK).strong;
}

export function getQuoteStatusDotClass(status) {
  return (QUOTE_STATUS_STYLES[status] || FALLBACK).dot;
}

export const QUOTE_STATUS_HEX = {
  Draft: "#6b7280",
  "Waiting Customer": "#f59e0b",
  "Ready For Review": "#2563eb",
  Approved: "#14b8a6",
  Rejected: "#ef4444",
  Cancelled: "#f43f5e",
  Converted: "#166534",
};

export function getQuoteStatusHex(status) {
  return QUOTE_STATUS_HEX[status] || "#9ca3af";
}
