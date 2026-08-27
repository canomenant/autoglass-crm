export const WORK_ORDER_STATUSES = ["Scheduled", "Assigned", "In Progress", "Completed", "Paid", "Closed", "Cancelled"];

// The normal linear flow, excluding Cancelled — used by the Status Tracker, which shows
// Cancelled as a standalone override instead of a step in this sequence.
export const WORK_ORDER_FLOW_STATUSES = ["Scheduled", "Assigned", "In Progress", "Completed", "Paid", "Closed"];

export const COMPLETED_STATUSES = ["Completed", "Paid"];
export const CLOSED_STATUSES = ["Closed"];
// Terminal = no longer active/open (for scheduling/dashboard "is this still open" filters).
// Distinct from CLOSED_STATUSES: Closed (successful) and Cancelled (lost opportunity) are
// deliberately reported separately even though both are terminal.
export const TERMINAL_STATUSES = ["Closed", "Cancelled"];

export const CANCELLATION_REASONS = [
  "Customer Cancelled",
  "Insurance Declined Claim",
  "Customer Never Responded",
  "Pricing Rejected",
  "Duplicate Order",
  "No Authorization Received",
  "Other",
];

// Los dos estados que pone el sistema solo: asignar un tecnico -> Assigned, y el saldo llegando a
// cero -> Paid (ver workorders.store.update). Una persona siempre puede ponerlos a mano y gana, asi
// que siguen en el menu; lo que no hacen es aparecer como boton de accion rapida, porque invitarian
// a saltarse justo el paso que los dispara.
export const AUTOMATIC_STATUSES = ["Assigned", "Paid"];

export function isAutomaticWorkOrderStatus(status) {
  return AUTOMATIC_STATUSES.includes(status);
}

// El siguiente paso del recorrido que de verdad decide una persona. Desde Completed el siguiente en
// la lista es Paid, que es automatico, asi que se salta hasta Closed.
export function getNextManualWorkOrderStatus(status) {
  const i = WORK_ORDER_FLOW_STATUSES.indexOf(status);
  if (i === -1) return null;
  return WORK_ORDER_FLOW_STATUSES.slice(i + 1).find((s) => !isAutomaticWorkOrderStatus(s)) || null;
}

export function isCompletedWorkOrderStatus(status) {
  return COMPLETED_STATUSES.includes(status);
}

export function isClosedWorkOrderStatus(status) {
  return CLOSED_STATUSES.includes(status);
}

export function isCancelledWorkOrderStatus(status) {
  return status === "Cancelled";
}

export function isTerminalWorkOrderStatus(status) {
  return TERMINAL_STATUSES.includes(status);
}
