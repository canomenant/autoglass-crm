"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { getQuotes, getCustomers, getInsuranceCompanies, getTableViews } from "@/lib/api";
import { DEFAULT_COLUMNS, getColumnValue, MONEY_COLUMNS } from "@/lib/quotesTableColumns";
import { getQuoteStatusColorClass, QUOTE_STATUS_COLORS } from "@/lib/quoteStatusColors";
import ConfigureViewModal from "@/components/ConfigureViewModal";

const MODULE = "quotes";
const PIN_WIDTH = 160;

function money(n) {
  return n === "" || n === undefined || n === null ? "" : `$${Number(n || 0).toFixed(2)}`;
}

function GearIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-4 h-4">
      <circle cx="6" cy="7" r="2" /><line x1="6" y1="9" x2="6" y2="21" /><line x1="6" y1="3" x2="6" y2="5" />
      <circle cx="12" cy="15" r="2" /><line x1="12" y1="17" x2="12" y2="21" /><line x1="12" y1="3" x2="12" y2="13" />
      <circle cx="18" cy="10" r="2" /><line x1="18" y1="12" x2="18" y2="21" /><line x1="18" y1="3" x2="18" y2="8" />
    </svg>
  );
}

export default function QuotesListPage() {
  const t = useTranslations("quotes");
  const tc = useTranslations("common");
  const tt = useTranslations("tableConfig");
  const tl = useTranslations("lostQuote");
  const [quotes, setQuotes] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [companies, setCompanies] = useState([]);
  const [error, setError] = useState("");
  const [columns, setColumns] = useState(DEFAULT_COLUMNS);
  const [modalOpen, setModalOpen] = useState(false);

  useEffect(() => {
    getQuotes().then(setQuotes).catch((e) => setError(e.message));
    getCustomers().then(setCustomers).catch(() => {});
    getInsuranceCompanies().then(setCompanies).catch(() => {});
    getTableViews(MODULE)
      .then((views) => {
        const defaultView = views.find((v) => v.isDefault);
        if (defaultView) setColumns(defaultView.columns);
      })
      .catch(() => {});
  }, []);

  function handleApply(newColumns) {
    setColumns(newColumns);
    setModalOpen(false);
  }

  const ctx = { customers, companies };
  const orderedColumns = [...columns.filter((c) => c.visible && c.pinned), ...columns.filter((c) => c.visible && !c.pinned)];
  const pinnedKeys = orderedColumns.filter((c) => c.pinned).map((c) => c.key);

  function pinStyle(key) {
    const pinIndex = pinnedKeys.indexOf(key);
    if (pinIndex === -1) return {};
    return { position: "sticky", left: pinIndex * PIN_WIDTH, zIndex: 5, background: "white", minWidth: PIN_WIDTH, maxWidth: PIN_WIDTH };
  }

  function renderCell(key, quote) {
    if (key === "acciones") {
      return (
        <Link href={`/dashboard/quotes/${quote.id}`} className="text-blue-600 dark:text-blue-400 hover:underline">
          {tc("viewEdit")}
        </Link>
      );
    }
    if (key === "estado") {
      return (
        <span className={`text-xs font-medium rounded-full px-2 py-1 whitespace-nowrap ${getQuoteStatusColorClass(quote.status)}`}>
          {t(`statuses.${quote.status}`)}
        </span>
      );
    }
    const value = getColumnValue(key, quote, ctx);
    if (MONEY_COLUMNS.has(key)) return money(value);
    return value || "";
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6 gap-2">
        <h1 className="text-2xl font-semibold dark:text-gray-100 tracking-tight">{t("title")}</h1>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setModalOpen(true)}
            className="border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-shadow text-sm flex items-center gap-2 text-gray-600"
          >
            <GearIcon /> {tt("configureView")}
          </button>
          <Link href="/dashboard/quotes/lost-report" className="border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-shadow text-sm text-gray-600">
            {tl("reportTitle")}
          </Link>
          <Link href="/dashboard/quotes/new" className="bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors px-4 py-2 text-sm">
            {t("newQuote")}
          </Link>
        </div>
      </div>

      {error && <p className="text-red-600 dark:text-red-400 text-sm mb-4">{error}</p>}

      <div className="bg-white dark:bg-gray-900 dark:border dark:border-gray-800 rounded-xl shadow-sm overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left border-b dark:border-gray-800">
              {orderedColumns.map((col) => (
                <th key={col.key} className="p-3 whitespace-nowrap" style={pinStyle(col.key)}>{tt(`columns.${col.key}`)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {quotes.map((q) => (
              <tr key={q.id} className="border-b last:border-0 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800/60 transition-colors">
                {orderedColumns.map((col) => (
                  <td key={col.key} className="p-3 whitespace-nowrap" style={pinStyle(col.key)}>{renderCell(col.key, q)}</td>
                ))}
              </tr>
            ))}
            {quotes.length === 0 && !error && (
              <tr>
                <td className="p-3 text-gray-500" colSpan={orderedColumns.length || 1}>
                  {t("noRecords")}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {modalOpen && (
        <ConfigureViewModal
          module={MODULE}
          columns={columns}
          defaultColumns={DEFAULT_COLUMNS}
          onApply={handleApply}
          onClose={() => setModalOpen(false)}
          title={tt("modalTitle")}
          subtitle={tt("modalSubtitle")}
          applyLabel={tt("apply")}
          t={tt}
          previewRows={quotes.slice(0, 6)}
          renderPreviewCell={renderCell}
          previewFilters={{
            date: (q) => q.date,
            status: {
              allLabel: tc("allStatuses"),
              get: (q) => q.status,
              options: Object.keys(QUOTE_STATUS_COLORS).map((s) => ({ value: s, label: t(`statuses.${s}`) })),
            },
          }}
        />
      )}
    </div>
  );
}
