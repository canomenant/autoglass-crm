export const QUOTE_STATUS_COLORS = {
  Draft: "bg-gray-100 text-gray-600",
  "Waiting Customer": "bg-amber-100 text-amber-700",
  "Ready For Review": "bg-blue-100 text-blue-700",
  Approved: "bg-teal-100 text-teal-700",
  Rejected: "bg-red-100 text-red-700",
  Converted: "bg-green-100 text-green-800",
};

export function getQuoteStatusColorClass(status) {
  return QUOTE_STATUS_COLORS[status] || "bg-gray-100 text-gray-600";
}

export const QUOTE_STATUS_HEX = {
  Draft: "#6b7280",
  "Waiting Customer": "#f59e0b",
  "Ready For Review": "#2563eb",
  Approved: "#14b8a6",
  Rejected: "#ef4444",
  Converted: "#166534",
};

export function getQuoteStatusHex(status) {
  return QUOTE_STATUS_HEX[status] || "#9ca3af";
}
