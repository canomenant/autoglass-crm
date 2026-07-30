"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { useLocale, useTranslations } from "next-intl";
import { Link, usePathname, useRouter } from "@/i18n/navigation";
import { getCurrentUser } from "@/lib/api";
import { getVisibleModules } from "@/lib/permissions";
import {
  DashboardIcon, QuotesIcon, WorkOrdersIcon, CustomersIcon, ExpensesIcon,
  PaymentsIcon, ReportsIcon, UsersIcon, SettingsIcon,
} from "@/components/Icons";

const NAV_ICONS = {
  dashboard: DashboardIcon,
  quotes: QuotesIcon,
  workOrders: WorkOrdersIcon,
  customers: CustomersIcon,
  expenses: ExpensesIcon,
  payments: PaymentsIcon,
  reports: ReportsIcon,
  users: UsersIcon,
  settings: SettingsIcon,
};

export default function Sidebar({ mobileOpen, onCloseMobile }) {
  const t = useTranslations("nav");
  const locale = useLocale();
  const pathname = usePathname();
  const router = useRouter();
  const [collapsed, setCollapsed] = useState(false);
  const [user, setUser] = useState(null);

  useEffect(() => {
    setCollapsed(localStorage.getItem("sidebarCollapsed") === "1");
    setUser(getCurrentUser());
  }, []);

  function toggleCollapsed() {
    setCollapsed((prev) => {
      localStorage.setItem("sidebarCollapsed", !prev ? "1" : "0");
      return !prev;
    });
  }

  const visibleModules = getVisibleModules(user?.role);

  const allLinks = [
    { key: "dashboard", module: "dashboard", href: "/dashboard", label: t("dashboard") },
    { key: "quotes", module: "quotes", href: "/dashboard/quotes", label: t("quotes") },
    { key: "workOrders", module: "workorders", href: "/dashboard/workorders", label: t("workOrders") },
    { key: "customers", module: "customers", href: "/dashboard/customers", label: t("customers") },
    { key: "expenses", module: "expenses", href: "/dashboard/expenses", label: t("expenses") },
    { key: "payments", module: "payments", href: "/dashboard/payments", label: t("payments") },
    { key: "reports", module: "reports", href: "/dashboard/reports", label: t("reports") },
    { key: "users", module: "users", href: "/dashboard/users", label: t("users") },
    { key: "settings", module: "settings", href: "/dashboard/settings", label: t("settings") },
  ];

  const links = allLinks.filter((link) => visibleModules.includes(link.module));

  function switchLocale(nextLocale) {
    router.replace(pathname, { locale: nextLocale });
  }

  function isActive(href) {
    return href === "/dashboard" ? pathname === href : pathname.startsWith(href);
  }

  return (
    <>
      {mobileOpen && <div className="fixed inset-0 bg-black/40 z-40 lg:hidden" onClick={onCloseMobile} />}

      <aside
        className={`fixed lg:static inset-y-0 left-0 z-50 bg-white dark:bg-gray-900 border-r border-slate-100 dark:border-gray-800 min-h-screen p-4 flex flex-col transition-all duration-200 ease-in-out
          ${collapsed ? "lg:w-20" : "lg:w-60"} w-60
          ${mobileOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"}`}
      >
        <div className="flex items-center justify-between mb-6">
          <div className={`rounded-xl overflow-hidden ${collapsed ? "lg:hidden" : ""}`}>
            <Image src="/logo.png" alt="Reyes Auto Glass Group" width={300} height={300} className="w-full h-auto block" priority />
          </div>
          <button
            onClick={toggleCollapsed}
            className="hidden lg:flex w-8 h-8 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-gray-800 flex-shrink-0 transition-colors"
            title={t("collapse")}
          >
            {collapsed ? "»" : "«"}
          </button>
        </div>

        <nav className="space-y-1 flex-1 overflow-y-auto">
          {links.map((link) => {
            const active = isActive(link.href);
            const NavIcon = NAV_ICONS[link.key];
            return (
              <Link
                key={link.href}
                href={link.href}
                onClick={onCloseMobile}
                title={collapsed ? link.label : undefined}
                className={`group relative flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors
                  ${active
                    ? "bg-blue-50 text-blue-700 dark:bg-blue-600/15 dark:text-blue-400"
                    : "text-slate-500 dark:text-gray-400 hover:bg-slate-100 hover:text-slate-800 dark:hover:bg-gray-800 dark:hover:text-gray-200"}
                  ${collapsed ? "lg:justify-center" : ""}`}
              >
                {active && <span className="absolute left-0 top-1.5 bottom-1.5 w-1 rounded-full bg-blue-600 lg:block hidden" />}
                <NavIcon className={`w-5 h-5 flex-shrink-0 ${active ? "text-blue-600 dark:text-blue-400" : "text-slate-400 dark:text-gray-500 group-hover:text-slate-600 dark:group-hover:text-gray-300"}`} />
                <span className={collapsed ? "lg:hidden" : ""}>{link.label}</span>
              </Link>
            );
          })}
        </nav>

        <div className={`flex gap-1 border-t border-slate-100 dark:border-gray-800 pt-4 ${collapsed ? "lg:hidden" : ""}`}>
          <button
            onClick={() => switchLocale("en")}
            className={`flex-1 text-xs font-medium py-1.5 rounded-md transition-colors ${locale === "en" ? "bg-blue-600 text-white" : "bg-slate-100 dark:bg-gray-800 text-slate-500 dark:text-gray-300 hover:bg-slate-200 dark:hover:bg-gray-700"}`}
          >
            EN
          </button>
          <button
            onClick={() => switchLocale("es")}
            className={`flex-1 text-xs font-medium py-1.5 rounded-md transition-colors ${locale === "es" ? "bg-blue-600 text-white" : "bg-slate-100 dark:bg-gray-800 text-slate-500 dark:text-gray-300 hover:bg-slate-200 dark:hover:bg-gray-700"}`}
          >
            ES
          </button>
        </div>
      </aside>
    </>
  );
}
