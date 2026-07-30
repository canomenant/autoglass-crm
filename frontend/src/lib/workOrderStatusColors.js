// "Approved" is not a real Work Order status (it's the Quote's status before conversion) — it is
// included here only because the Status Tracker displays it as the always-completed first step.
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

// Tailwind badge classes matching the same palette, for components that render pill/badge chips
// instead of a plain color dot.
export const STATUS_BADGE_CLASSES = {
  Approved: "bg-blue-100 text-blue-700",
  Scheduled: "bg-gray-100 text-gray-600",
  Assigned: "bg-purple-100 text-purple-700",
  "In Progress": "bg-orange-100 text-orange-700",
  Completed: "bg-green-100 text-green-700",
  Paid: "bg-emerald-100 text-emerald-700",
  Closed: "bg-green-200 text-green-900",
  Cancelled: "bg-red-100 text-red-700",
};

export function getStatusColor(wo) {
  return STATUS_COLORS[wo.status] || "#6b7280";
}
