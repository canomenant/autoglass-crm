"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Link, usePathname, useRouter } from "@/i18n/navigation";
import { useTheme } from "./ThemeProvider";
import { getCurrentUser, sendPresenceHeartbeat, getQuotes, getWorkOrders, getCustomers } from "@/lib/api";
import ActiveUsersPanel from "./ActiveUsersPanel";
import { UsersIcon } from "./Icons";

function MenuIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" className="w-5 h-5">
      <line x1="4" y1="7" x2="20" y2="7" /><line x1="4" y1="12" x2="20" y2="12" /><line x1="4" y1="17" x2="20" y2="17" />
    </svg>
  );
}

function CalendarIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
      <rect x="3" y="5" width="18" height="16" rx="2" /><line x1="3" y1="10" x2="21" y2="10" /><line x1="8" y1="3" x2="8" y2="7" /><line x1="16" y1="3" x2="16" y2="7" />
    </svg>
  );
}

function BellIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
      <path d="M6 8a6 6 0 0 1 12 0c0 5 2 6 2 6H4s2-1 2-6Z" /><path d="M10 21a2 2 0 0 0 4 0" />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
      <circle cx="11" cy="11" r="7" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  );
}

export default function Header({ onToggleSidebar }) {
  const t = useTranslations("header");
  const pathname = usePathname();
  const router = useRouter();
  const { theme, setTheme } = useTheme();
  const [user, setUser] = useState(null);

  const [search, setSearch] = useState("");
  const [results, setResults] = useState([]);
  const [activeCount, setActiveCount] = useState(0);
  const [notifications, setNotifications] = useState([]);
  const [openMenu, setOpenMenu] = useState(null);

  useEffect(() => {
    setUser(getCurrentUser());
  }, []);

  useEffect(() => {
    sendPresenceHeartbeat(pathname).catch(() => {});
    const interval = setInterval(() => sendPresenceHeartbeat(pathname).catch(() => {}), 30000);
    return () => clearInterval(interval);
  }, [pathname]);

  useEffect(() => {
    getWorkOrders()
      .then((wos) => {
        setNotifications(
          wos
            .filter((w) => w.status === "Completed" && !w.payment?.paid)
            .slice(0, 10)
            .map((w) => ({ id: `wo-${w.id}`, label: `${w.workOrderNo} — ${w.customerName || ""}`, href: `/dashboard/workorders/${w.id}` }))
        );
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!search.trim()) {
      setResults([]);
      return;
    }
    const query = search.toLowerCase();
    const timeout = setTimeout(() => {
      Promise.all([getQuotes(), getWorkOrders(), getCustomers()])
        .then(([quotes, wos, customers]) => {
          const r = [];
          quotes
            .filter((q) => q.quoteNo?.toLowerCase().includes(query) || (q.customerName || "").toLowerCase().includes(query))
            .slice(0, 5)
            .forEach((q) => r.push({ type: t("typeQuote"), label: `${q.quoteNo} — ${q.customerName || ""}`, href: `/dashboard/quotes/${q.id}` }));
          wos
            .filter((w) => w.workOrderNo?.toLowerCase().includes(query) || (w.customerName || "").toLowerCase().includes(query))
            .slice(0, 5)
            .forEach((w) => r.push({ type: t("typeWorkOrder"), label: `${w.workOrderNo} — ${w.customerName || ""}`, href: `/dashboard/workorders/${w.id}` }));
          customers
            .filter((c) => (c.name || "").toLowerCase().includes(query) || (c.phone || "").includes(query))
            .slice(0, 5)
            .forEach((c) => r.push({ type: t("typeCustomer"), label: c.name, href: `/dashboard/customers/${c.id}` }));
          setResults(r);
        })
        .catch(() => {});
    }, 250);
    return () => clearTimeout(timeout);
  }, [search, t]);

  function toggleMenu(name) {
    setOpenMenu((cur) => (cur === name ? null : name));
  }

  function handleLogout() {
    localStorage.removeItem("token");
    localStorage.removeItem("user");
    router.push("/login");
  }

  const themeIcon = theme === "dark" ? "🌙" : theme === "light" ? "☀️" : "💻";

  return (
    <header className="h-16 border-b border-slate-100 bg-white/95 backdrop-blur dark:bg-gray-900 dark:border-gray-800 flex items-center gap-2 px-4 sticky top-0 z-30 flex-shrink-0 shadow-sm">
      {openMenu && <div className="fixed inset-0 z-30" onClick={() => setOpenMenu(null)} />}

      <button onClick={onToggleSidebar} className="lg:hidden p-2 rounded hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-600 dark:text-gray-300">
        <MenuIcon />
      </button>

      <div className="relative flex-1 max-w-md z-40">
        <div className="relative">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"><SearchIcon /></span>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onFocus={() => setOpenMenu("search")}
            placeholder={t("searchPlaceholder")}
            className="w-full border border-slate-200 rounded-lg pl-9 pr-3 py-2 text-sm bg-slate-50 dark:bg-gray-800 dark:border-gray-700 dark:text-gray-100 dark:placeholder-gray-500 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-shadow"
          />
        </div>
        {openMenu === "search" && results.length > 0 && (
          <div className="absolute mt-1 w-full bg-white dark:bg-gray-800 rounded-lg shadow-lg border dark:border-gray-700 max-h-80 overflow-y-auto z-40">
            {results.map((r) => (
              <Link
                key={r.href + r.label}
                href={r.href}
                onClick={() => { setOpenMenu(null); setSearch(""); }}
                className="block px-3 py-2 text-sm hover:bg-gray-50 dark:hover:bg-gray-700"
              >
                <span className="text-xs text-gray-400 mr-2">{r.type}</span>{r.label}
              </Link>
            ))}
          </div>
        )}
      </div>

      <Link href="/dashboard" className="p-2 rounded hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-500 dark:text-gray-300" title={t("calendar")}>
        <CalendarIcon />
      </Link>

      <div className="relative z-40">
        <button onClick={() => toggleMenu("notif")} className="relative p-2 rounded hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-500 dark:text-gray-300">
          <BellIcon />
          {notifications.length > 0 && <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-red-500 rounded-full" />}
        </button>
        {openMenu === "notif" && (
          <div className="absolute right-0 mt-2 w-72 bg-white dark:bg-gray-800 rounded-lg shadow-lg border dark:border-gray-700">
            <div className="px-3 py-2 text-xs font-semibold text-gray-400 uppercase border-b dark:border-gray-700">{t("notifications")}</div>
            <div className="max-h-64 overflow-y-auto">
              {notifications.map((n) => (
                <Link key={n.id} href={n.href} onClick={() => setOpenMenu(null)} className="block px-3 py-2 text-sm hover:bg-gray-50 dark:hover:bg-gray-700">
                  {n.label}
                </Link>
              ))}
              {notifications.length === 0 && <p className="px-3 py-3 text-sm text-gray-400">{t("noNotifications")}</p>}
            </div>
          </div>
        )}
      </div>

      <div className="relative z-40">
        <button onClick={() => toggleMenu("users")} className="relative p-2 rounded hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-500 dark:text-gray-300">
          <UsersIcon className="w-5 h-5" />
          {activeCount > 0 && (
            <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 flex items-center justify-center text-[10px] font-semibold bg-blue-600 text-white rounded-full">
              {activeCount}
            </span>
          )}
        </button>
        <ActiveUsersPanel open={openMenu === "users"} onCountChange={setActiveCount} />
      </div>

      <div className="relative z-40">
        <button onClick={() => toggleMenu("theme")} className="p-2 rounded hover:bg-gray-100 dark:hover:bg-gray-800 text-sm">
          {themeIcon}
        </button>
        {openMenu === "theme" && (
          <div className="absolute right-0 mt-2 w-40 bg-white dark:bg-gray-800 rounded-lg shadow-lg border dark:border-gray-700 text-sm">
            <button onClick={() => { setTheme("light"); setOpenMenu(null); }} className="block w-full text-left px-3 py-2 hover:bg-gray-50 dark:hover:bg-gray-700 dark:text-gray-100">☀️ {t("light")}</button>
            <button onClick={() => { setTheme("dark"); setOpenMenu(null); }} className="block w-full text-left px-3 py-2 hover:bg-gray-50 dark:hover:bg-gray-700 dark:text-gray-100">🌙 {t("dark")}</button>
            <button onClick={() => { setTheme("system"); setOpenMenu(null); }} className="block w-full text-left px-3 py-2 hover:bg-gray-50 dark:hover:bg-gray-700 dark:text-gray-100">💻 {t("system")}</button>
          </div>
        )}
      </div>

      <div className="relative z-40">
        <button onClick={() => toggleMenu("profile")} className="flex items-center gap-2 pl-1 pr-2 py-1 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800">
          <div className="w-8 h-8 rounded-full bg-blue-600 text-white flex items-center justify-center text-xs font-semibold flex-shrink-0 shadow-sm">
            {(user?.name || "?").slice(0, 1).toUpperCase()}
          </div>
          <div className="hidden sm:block text-left leading-tight">
            <div className="text-sm font-medium dark:text-gray-100">{user?.name || "-"}</div>
            <div className="text-xs text-gray-400">{user?.role || ""}</div>
          </div>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="hidden sm:block w-3.5 h-3.5 text-gray-400">
            <polyline points="6,9 12,15 18,9" />
          </svg>
        </button>
        {openMenu === "profile" && (
          <div className="absolute right-0 mt-2 w-48 bg-white dark:bg-gray-800 rounded-lg shadow-lg border dark:border-gray-700 text-sm">
            <div className="px-3 py-2 border-b dark:border-gray-700 sm:hidden">
              <div className="font-medium dark:text-gray-100">{user?.name || "-"}</div>
              <div className="text-xs text-gray-400">{user?.role || ""}</div>
            </div>
            <Link
              href="/dashboard/change-password"
              onClick={() => setOpenMenu(null)}
              className="block w-full text-left px-3 py-2 hover:bg-gray-50 dark:hover:bg-gray-700 dark:text-gray-100"
            >
              {t("changePassword")}
            </Link>
            <button onClick={handleLogout} className="block w-full text-left px-3 py-2 hover:bg-gray-50 dark:hover:bg-gray-700 text-red-600 font-medium">
              {t("logout")}
            </button>
          </div>
        )}
      </div>
    </header>
  );
}
