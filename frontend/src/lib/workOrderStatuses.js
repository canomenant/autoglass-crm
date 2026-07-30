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
