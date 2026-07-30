import { masterCatalogs } from "./settingsCatalogs";

const PAYMENT_PERMISSIONS = {
  ADMIN: { create: true, edit: true, approve: true, pay: true, export: true, viewAll: true },
  AGENT: { create: false, edit: false, approve: false, pay: false, export: false, viewAll: false },
  TECHNICIAN: { create: false, edit: false, approve: false, pay: false, export: false, viewAll: false },
};

export function getPaymentPermissions(role) {
  return PAYMENT_PERMISSIONS[role] || PAYMENT_PERMISSIONS.TECHNICIAN;
}

export function canViewPayment(role, entityId, payment) {
  const perms = getPaymentPermissions(role);
  if (perms.viewAll) return true;
  if (role === "AGENT") return payment.type === "AGENT" && payment.agentId === entityId;
  return false;
}

export const MODULE_KEYS = [
  "dashboard",
  "quotes",
  "workorders",
  "customers",
  "expenses",
  "payments",
  "reports",
  "users",
  "settings",
  "masterCatalogs",
];

const MODULE_PERMISSIONS = {
  ADMIN: MODULE_KEYS,
  AGENT: ["dashboard", "quotes", "workorders", "customers", "payments"],
  TECHNICIAN: ["dashboard", "workorders", "customers"],
};

export function getVisibleModules(role) {
  return MODULE_PERMISSIONS[role] || MODULE_PERMISSIONS.TECHNICIAN;
}

export function canAccessModule(role, moduleKey) {
  return getVisibleModules(role).includes(moduleKey);
}

const MASTER_CATALOG_SLUGS = new Set(masterCatalogs.map((c) => c.slug));

export function moduleForPath(pathname) {
  if (pathname === "/dashboard") return "dashboard";
  if (pathname.startsWith("/dashboard/quotes")) return "quotes";
  if (pathname.startsWith("/dashboard/workorders")) return "workorders";
  if (pathname.startsWith("/dashboard/customers")) return "customers";
  if (pathname.startsWith("/dashboard/distributors")) return "masterCatalogs";
  if (pathname.startsWith("/dashboard/expenses")) return "expenses";
  if (pathname.startsWith("/dashboard/payments")) return "payments";
  if (pathname.startsWith("/dashboard/reports")) return "reports";
  if (pathname.startsWith("/dashboard/users")) return "users";

  if (pathname.startsWith("/dashboard/settings/")) {
    const slug = pathname.split("/")[3];
    if (MASTER_CATALOG_SLUGS.has(slug)) return "masterCatalogs";
    return "settings";
  }
  if (pathname === "/dashboard/settings") return "settings";

  return null;
}

export function canAccessPath(role, pathname) {
  const moduleKey = moduleForPath(pathname);
  if (!moduleKey) return true;
  return canAccessModule(role, moduleKey);
}
