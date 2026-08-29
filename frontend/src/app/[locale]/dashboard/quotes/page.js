"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { getQuotes, getCustomers, getInsuranceCompanies, getTableViews } from "@/lib/api";
import { DEFAULT_COLUMNS, getColumnValue, MONEY_COLUMNS, COLUMN_CATALOG_VERSION } from "@/lib/quotesTableColumns";
import { getQuoteStatusColorClass, QUOTE_STATUS_COLORS } from "@/lib/quoteStatusColors";
import ConfigureViewModal from "@/components/ConfigureViewModal";

const MODULE = "quotes";
const APPLIED_COLUMNS_STORAGE_KEY = `tableView:${MODULE}:appliedColumns`;
const PIN_WIDTH = 160;
const PAGE_SIZE_OPTIONS = [50, 100, 200];
const DEFAULT_PAGE_SIZE = 50;

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
  const tp = useTranslations("quotesList");
  const [quotes, setQuotes] = useState([]);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [customers, setCustomers] = useState([]);
  const [companies, setCompanies] = useState([]);
  const [error, setError] = useState("");
  // Vuelve a lo ultimo que se aplico con "Apply Configuration", igual que en Work Orders. Antes
  // handleApply solo llamaba a setColumns: la configuracion vivia en memoria y se perdia entera al
  // salir de Quotes y volver, que es justo como se reporto. Una vista guardada con nombre, si la
  // hay, sigue mandando sobre esto cuando termina de cargar (mas abajo).
  const [columns, setColumns] = useState(() => {
    if (typeof window === "undefined") return DEFAULT_COLUMNS;
    try {
      const saved = JSON.parse(window.localStorage.getItem(APPLIED_COLUMNS_STORAGE_KEY));
      if (saved && saved.version === COLUMN_CATALOG_VERSION && Array.isArray(saved.columns)) {
        return saved.columns;
      }
      window.localStorage.removeItem(APPLIED_COLUMNS_STORAGE_KEY);
      return DEFAULT_COLUMNS;
    } catch {
      return DEFAULT_COLUMNS;
    }
  });
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
    try {
      window.localStorage.setItem(
        APPLIED_COLUMNS_STORAGE_KEY,
        JSON.stringify({ version: COLUMN_CATALOG_VERSION, columns: newColumns })
      );
    } catch {
      // Modo incognito o almacenamiento lleno: la configuracion sigue aplicada en esta pantalla,
      // solo no sobrevive a la recarga. No es motivo para romper el guardado.
    }
  }

  // De mayor a menor por numero de cotizacion. El backend las devuelve por created_at, y como las
  // importadas de AppSheet tienen fechas que no siguen su numeracion, la lista salia en un orden
  // que parecia aleatorio (Q-3865, Q-0003, Q-0004, Q-3856...).
  //
  // Se compara el numero, no el texto: "Q-4581" contra "Q-999" ordenado como texto pondria la
  // segunda primero. Hoy todas van rellenadas a cuatro digitos, pero eso no tiene por que seguir
  // siendo cierto.
  const numeroDe = (q) => Number(String(q.quoteNo || "").replace(/\D/g, "")) || 0;
  const quotesOrdenadas = useMemo(() => [...quotes].sort((a, b) => numeroDe(b) - numeroDe(a)), [quotes]);

  // La tabla renderizaba las ~4.600 cotizaciones de golpe: decenas de miles de celdas que
  // congelaban la pestaña al entrar y en cada re-render. Se busca sobre el arreglo ya cargado y
  // sólo se montan las filas de la página visible.
  const quotesFiltradas = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return quotesOrdenadas;
    return quotesOrdenadas.filter(
      (quote) =>
        String(quote.quoteNo || "").toLowerCase().includes(q) ||
        String(quote.customerName || "").toLowerCase().includes(q)
    );
  }, [quotesOrdenadas, search]);

  const totalPages = Math.max(1, Math.ceil(quotesFiltradas.length / pageSize));
  const paginaActual = Math.min(page, totalPages);
  const quotesVisibles = useMemo(
    () => quotesFiltradas.slice((paginaActual - 1) * pageSize, paginaActual * pageSize),
    [quotesFiltradas, paginaActual, pageSize]
  );
  const from = quotesFiltradas.length === 0 ? 0 : (paginaActual - 1) * pageSize + 1;
  const to = Math.min(paginaActual * pageSize, quotesFiltradas.length);

  useEffect(() => {
    setPage(1);
  }, [search, pageSize]);

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

      <div className="max-w-sm mb-4">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={tp("searchPlaceholder")}
          className="w-full border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-shadow text-sm"
        />
      </div>

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
            {quotesVisibles.map((q) => (
              <tr key={q.id} className="border-b last:border-0 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800/60 transition-colors">
                {orderedColumns.map((col) => (
                  <td key={col.key} className="p-3 whitespace-nowrap" style={pinStyle(col.key)}>{renderCell(col.key, q)}</td>
                ))}
              </tr>
            ))}
            {quotesVisibles.length === 0 && !error && (
              <tr>
                <td className="p-3 text-gray-500" colSpan={orderedColumns.length || 1}>
                  {t("noRecords")}
                </td>
              </tr>
            )}
          </tbody>
        </table>

        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 px-4 py-3 border-t dark:border-gray-800 text-sm">
          <div className="text-gray-500 dark:text-gray-400">
            {tp("showingRange", { from, to, total: quotesFiltradas.length })}
          </div>
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex items-center gap-2">
              <span className="text-gray-500 dark:text-gray-400">{tp("rowsPerPage")}</span>
              {PAGE_SIZE_OPTIONS.map((size) => (
                <button
                  key={size}
                  type="button"
                  onClick={() => setPageSize(size)}
                  className={`px-2 py-1 rounded-md text-xs border transition-colors ${
                    pageSize === size
                      ? "bg-gray-900 dark:bg-blue-600 text-white border-gray-900 dark:border-blue-600"
                      : "border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:border-gray-300 dark:hover:border-gray-600"
                  }`}
                >
                  {size}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={paginaActual <= 1}
                onClick={() => setPage(paginaActual - 1)}
                className="px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 disabled:opacity-40 disabled:cursor-not-allowed hover:border-gray-300 dark:hover:border-gray-600 transition-colors"
              >
                {tp("previous")}
              </button>
              <span className="text-gray-500 dark:text-gray-400 whitespace-nowrap">
                {tp("pageOf", { page: paginaActual, totalPages })}
              </span>
              <button
                type="button"
                disabled={paginaActual >= totalPages}
                onClick={() => setPage(paginaActual + 1)}
                className="px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 disabled:opacity-40 disabled:cursor-not-allowed hover:border-gray-300 dark:hover:border-gray-600 transition-colors"
              >
                {tp("next")}
              </button>
            </div>
          </div>
        </div>
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
