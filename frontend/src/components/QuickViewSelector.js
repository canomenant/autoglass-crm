"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { usePathname } from "@/i18n/navigation";
import { getCurrentUser } from "@/lib/api";
import { getVisibleModules } from "@/lib/permissions";
import { getQuickViewCards } from "@/lib/quickViewData";

const MODULE_HREFS = {
  dashboard: "/dashboard",
  quotes: "/dashboard/quotes",
  workorders: "/dashboard/workorders",
  customers: "/dashboard/customers",
  expenses: "/dashboard/expenses",
  payments: "/dashboard/payments",
  reports: "/dashboard/reports",
  users: "/dashboard/users",
};

function currentModuleFromPath(pathname) {
  if (!pathname || pathname === "/dashboard") return "dashboard";
  const segment = pathname.replace(/^\/dashboard\/?/, "").split("/")[0];
  return MODULE_HREFS[segment] ? segment : segment || "dashboard";
}

export default function QuickViewSelector() {
  const t = useTranslations("quickView");
  const pathname = usePathname();
  const currentModule = currentModuleFromPath(pathname);
  const [user, setUser] = useState(null);
  const visibleModules = getVisibleModules(user?.role).filter((m) => MODULE_HREFS[m]);

  const [selected, setSelected] = useState(currentModule);
  const [panelOpen, setPanelOpen] = useState(false);
  const [cards, setCards] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setUser(getCurrentUser());
  }, []);

  useEffect(() => {
    setSelected(currentModule);
    setPanelOpen(false);
  }, [currentModule]);

  function handleChange(value) {
    setSelected(value);
    if (value === currentModule) {
      setPanelOpen(false);
      return;
    }
    setPanelOpen(true);
    setLoading(true);
    getQuickViewCards(value)
      .then(setCards)
      .catch(() => setCards([]))
      .finally(() => setLoading(false));
  }

  return (
    <div className="w-full sm:w-auto relative">
      <div className="flex flex-col sm:flex-row sm:items-center gap-2">
        <label className="text-xs font-medium text-gray-500 sm:hidden">{t("label")}</label>
        <select
          value={selected}
          onChange={(e) => handleChange(e.target.value)}
          className="w-full sm:w-56 border rounded-lg px-3 py-2 text-sm bg-white"
          aria-label={t("label")}
        >
          <option value="" disabled>{t("placeholder")}</option>
          {visibleModules.map((m) => (
            <option key={m} value={m}>{t(`modules.${m}`)}</option>
          ))}
        </select>
      </div>

      {panelOpen && (
        <div className="fixed inset-x-4 top-20 sm:absolute sm:inset-x-auto sm:right-0 sm:top-auto sm:mt-2 sm:w-96 bg-white dark:bg-gray-800 dark:border dark:border-gray-700 rounded-xl shadow-xl border p-4 z-40">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-sm">{t(`modules.${selected}`)}</h3>
            <button type="button" onClick={() => setPanelOpen(false)} className="text-gray-400 hover:text-gray-600 text-sm">✕</button>
          </div>

          {loading && <p className="text-sm text-gray-500">{t("loading")}</p>}

          {!loading && cards.length === 0 && (
            <p className="text-sm text-gray-500">{t("empty")}</p>
          )}

          {!loading && cards.length > 0 && (
            <div className="grid grid-cols-2 gap-3">
              {cards.map((card) => (
                <div key={card.key} className="bg-gray-50 rounded-lg p-3">
                  <div className="text-xs text-gray-500">{t(`cards.${card.key}`)}</div>
                  <div className="text-sm font-bold">{card.value}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
