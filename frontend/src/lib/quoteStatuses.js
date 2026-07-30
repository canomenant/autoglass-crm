export const QUOTE_STATUSES = ["Draft", "Waiting Customer", "Ready For Review", "Approved", "Rejected", "Converted"];

export function isLostStatus(status) {
  return status === "Rejected";
}

export function canConvertToWorkOrder(status) {
  return status === "Approved";
}
