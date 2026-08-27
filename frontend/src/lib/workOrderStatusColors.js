// "Approved" is not a real Work Order status (it's the Quote's status before conversion) — it is
// included here only because the Status Tracker displays it as the always-completed first step.
//
// Tres presentaciones del mismo estado, igual que en las cotizaciones, para que un estado se vea
// igual en el tracker de arriba, en el panel de la derecha, en la lista y en el calendario:
//   - soft:   pastilla discreta, para celdas de tabla y listas densas.
//   - strong: pastilla destacada con borde, para donde el estado manda.
//   - dot:    el punto de color que acompaña al texto.
//
// Las clases van escritas completas a propósito: Tailwind hace purge sobre el texto del código y no
// ve un nombre de clase construido por concatenación.
const WORK_ORDER_STATUS_STYLES = {
  Approved: {
    soft: "bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300",
    strong: "bg-blue-100 text-blue-800 border-blue-300 dark:bg-blue-500/15 dark:text-blue-200 dark:border-blue-500/40",
    dot: "bg-blue-500",
  },
  Scheduled: {
    soft: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300",
    strong: "bg-gray-100 text-gray-700 border-gray-300 dark:bg-gray-800 dark:text-gray-200 dark:border-gray-600",
    dot: "bg-gray-400",
  },
  Assigned: {
    soft: "bg-purple-100 text-purple-700 dark:bg-purple-500/15 dark:text-purple-300",
    strong: "bg-purple-100 text-purple-800 border-purple-300 dark:bg-purple-500/15 dark:text-purple-200 dark:border-purple-500/40",
    dot: "bg-purple-500",
  },
  "In Progress": {
    soft: "bg-orange-100 text-orange-700 dark:bg-orange-500/15 dark:text-orange-300",
    strong: "bg-orange-100 text-orange-800 border-orange-300 dark:bg-orange-500/15 dark:text-orange-200 dark:border-orange-500/40",
    dot: "bg-orange-500",
  },
  Completed: {
    soft: "bg-green-100 text-green-700 dark:bg-green-500/15 dark:text-green-300",
    strong: "bg-green-100 text-green-800 border-green-300 dark:bg-green-500/15 dark:text-green-200 dark:border-green-500/40",
    dot: "bg-green-500",
  },
  // Sólido: es el hito de dinero, la pregunta que más se hace de un vistazo sobre una orden.
  Paid: {
    soft: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300",
    strong: "bg-emerald-600 text-white border-emerald-600 dark:bg-emerald-600 dark:text-white dark:border-emerald-500",
    dot: "bg-emerald-500",
  },
  // Con borde y no en sólido, aunque sea el final del recorrido: en modo oscuro dos verdes sólidos
  // seguidos -Paid y Closed- se leían como la misma pastilla. El sólido se reserva para Paid.
  Closed: {
    soft: "bg-green-200 text-green-900 dark:bg-green-700/25 dark:text-green-200",
    strong: "bg-green-100 text-green-900 border-green-700 dark:bg-green-700/25 dark:text-green-200 dark:border-green-600",
    dot: "bg-green-800",
  },
  Cancelled: {
    soft: "bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300",
    strong: "bg-red-100 text-red-800 border-red-300 dark:bg-red-500/15 dark:text-red-200 dark:border-red-500/40",
    dot: "bg-red-500",
  },
};

const FALLBACK = WORK_ORDER_STATUS_STYLES.Scheduled;

export const STATUS_COLORS = {
  Approved: "#3b82f6",
  Scheduled: "#9ca3af",
  Assigned: "#a855f7",
  "In Progress": "#f97316",
  Completed: "#22c55e",
  Paid: "#10b981",
  Closed: "#166534",
  Cancelled: "#ef4444",
};

// Se mantiene con la misma forma de antes (estado -> clases pastel): la lista de Work Orders y el
// dashboard lo recorren para pintar sus chips y para armar el filtro por estado.
export const STATUS_BADGE_CLASSES = Object.fromEntries(
  Object.entries(WORK_ORDER_STATUS_STYLES).map(([status, style]) => [status, style.soft])
);

export function getStatusColor(wo) {
  return STATUS_COLORS[wo.status] || "#6b7280";
}

export function getWorkOrderStatusColorClass(status) {
  return (WORK_ORDER_STATUS_STYLES[status] || FALLBACK).soft;
}

export function getWorkOrderStatusStrongClass(status) {
  return (WORK_ORDER_STATUS_STYLES[status] || FALLBACK).strong;
}

export function getWorkOrderStatusDotClass(status) {
  return (WORK_ORDER_STATUS_STYLES[status] || FALLBACK).dot;
}
