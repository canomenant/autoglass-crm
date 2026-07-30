"use client";

import { useEffect, useMemo, useState } from "react";
import { getTableViews, createTableView, setDefaultTableView, deleteTableView } from "@/lib/api";
import {
  SearchIcon, RefreshIcon, BookmarkIcon, ChevronUpIcon, ChevronDownIcon,
  ColumnsIcon, GripIcon, CloseIcon, CheckIcon, SettingsIcon, WorkOrdersIcon,
  CustomersIcon, CarIcon, ShieldIcon, CalendarIcon, DollarIcon, TagIcon,
  TruckIcon, UsersIcon, QuotesIcon, PaymentsIcon, FolderIcon,
} from "@/components/Icons";

const CATEGORY_ICONS = {
  general: SettingsIcon,
  workOrder: WorkOrdersIcon,
  customer: CustomersIcon,
  vehicle: CarIcon,
  insurance: ShieldIcon,
  appointment: CalendarIcon,
  financial: DollarIcon,
  glass: TagIcon,
  distributor: TruckIcon,
  technician: UsersIcon,
  invoice: QuotesIcon,
  payments: PaymentsIcon,
  documents: FolderIcon,
};

function categoryIcon(cat) {
  return CATEGORY_ICONS[cat] || ColumnsIcon;
}

function PinIcon({ active, className = "w-4 h-4" }) {
  return (
    <svg viewBox="0 0 24 24" fill={active ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M12 17v5" />
      <path d="M9 3h6l1 6 3 3v2H5v-2l3-3 1-6Z" />
    </svg>
  );
}

function Toggle({ checked, onChange }) {
  return (
    <button
      type="button"
      onClick={onChange}
      className={`relative inline-flex h-5 w-9 flex-shrink-0 items-center rounded-full transition-colors duration-200 ${checked ? "bg-blue-600" : "bg-slate-300 dark:bg-gray-700"}`}
    >
      <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform duration-200 ${checked ? "translate-x-[18px]" : "translate-x-[2px]"}`} />
    </button>
  );
}

export default function ConfigureViewModal({
  module,
  columns,
  defaultColumns,
  onApply,
  onClose,
  title,
  subtitle,
  applyLabel,
  t,
  previewRows = [],
  renderPreviewCell,
  previewFilters,
}) {
  const [items, setItems] = useState(columns);
  const [dragKey, setDragKey] = useState(null);
  const [dragOverKey, setDragOverKey] = useState(null);
  const [search, setSearch] = useState("");
  const [views, setViews] = useState([]);
  const [viewName, setViewName] = useState("");
  const [error, setError] = useState("");

  const categoryOrder = useMemo(() => [...new Set(items.map((c) => c.category || "other"))], [items]);
  const [activeCategory, setActiveCategory] = useState(categoryOrder[0]);

  const [filterDateFrom, setFilterDateFrom] = useState("");
  const [filterDateTo, setFilterDateTo] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const [filterTechnician, setFilterTechnician] = useState("");

  useEffect(() => {
    getTableViews(module).then(setViews).catch(() => {});
  }, [module]);

  function indexOf(key) {
    return items.findIndex((c) => c.key === key);
  }

  function toggle(key) {
    setItems((prev) => prev.map((c) => (c.key === key ? { ...c, visible: !c.visible } : c)));
  }

  function togglePin(key) {
    setItems((prev) => prev.map((c) => (c.key === key ? { ...c, pinned: !c.pinned } : c)));
  }

  function move(key, dir) {
    setItems((prev) => {
      const index = prev.findIndex((c) => c.key === key);
      const target = index + dir;
      if (target < 0 || target >= prev.length) return prev;
      const next = [...prev];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  function handleDrop(key) {
    if (dragKey !== null) {
      setItems((prev) => {
        const fromIndex = prev.findIndex((c) => c.key === dragKey);
        const toIndex = prev.findIndex((c) => c.key === key);
        if (fromIndex === -1 || toIndex === -1 || fromIndex === toIndex) return prev;
        const next = [...prev];
        const [moved] = next.splice(fromIndex, 1);
        next.splice(toIndex, 0, moved);
        return next;
      });
    }
    setDragKey(null);
    setDragOverKey(null);
  }

  function handleReset() {
    setItems(defaultColumns);
  }

  async function handleSaveView(scope) {
    if (!viewName.trim()) return;
    try {
      const view = await createTableView({ module, scope, viewName: viewName.trim(), columns: items });
      setViews((prev) => [...prev, view]);
      setViewName("");
    } catch (e) {
      setError(e.message);
    }
  }

  function handleLoadView(view) {
    onApply(view.columns);
  }

  async function handleSetDefault(view) {
    try {
      await setDefaultTableView(view.id);
      const refreshed = await getTableViews(module);
      setViews(refreshed);
    } catch (e) {
      setError(e.message);
    }
  }

  async function handleDeleteView(view) {
    try {
      await deleteTableView(view.id);
      setViews((prev) => prev.filter((v) => v.id !== view.id));
    } catch (e) {
      setError(e.message);
    }
  }

  const grouped = {};
  items.forEach((col) => {
    const label = t(`columns.${col.key}`);
    if (search && !label.toLowerCase().includes(search.toLowerCase()) && !col.key.toLowerCase().includes(search.toLowerCase())) return;
    const cat = col.category || "other";
    if (!grouped[cat]) grouped[cat] = [];
    grouped[cat].push(col);
  });
  const visibleCategories = search ? Object.keys(grouped) : [activeCategory].filter((c) => grouped[c]);

  const previewColumns = useMemo(
    () => [...items.filter((c) => c.visible && c.pinned), ...items.filter((c) => c.visible && !c.pinned)],
    [items]
  );
  const visibleCount = items.filter((c) => c.visible).length;

  const filteredPreviewRows = useMemo(() => {
    if (!previewFilters) return previewRows;
    return previewRows.filter((row) => {
      if (previewFilters.date && (filterDateFrom || filterDateTo)) {
        const d = previewFilters.date(row);
        if (filterDateFrom && (!d || d < filterDateFrom)) return false;
        if (filterDateTo && (!d || d > filterDateTo)) return false;
      }
      if (previewFilters.status && filterStatus && previewFilters.status.get(row) !== filterStatus) return false;
      if (previewFilters.technician && filterTechnician && previewFilters.technician.get(row) !== filterTechnician) return false;
      return true;
    });
  }, [previewRows, previewFilters, filterDateFrom, filterDateTo, filterStatus, filterTechnician]);

  return (
    <div className="fixed inset-0 bg-slate-900/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white dark:bg-gray-900 dark:border dark:border-gray-800 rounded-2xl shadow-2xl w-full max-w-6xl max-h-[92vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-6 py-5 border-b border-slate-100 dark:border-gray-800">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-blue-50 dark:bg-blue-500/10 text-blue-600 dark:text-blue-400 flex items-center justify-center flex-shrink-0">
              <ColumnsIcon className="w-5 h-5" />
            </div>
            <div>
              <h2 className="font-semibold text-slate-800 dark:text-gray-100">{title}</h2>
              <p className="text-xs text-slate-500 dark:text-gray-400 max-w-lg">{subtitle}</p>
            </div>
          </div>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-600 dark:hover:text-gray-200 p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-gray-800 transition-colors">
            <CloseIcon className="w-4 h-4" />
          </button>
        </div>

        <div className="px-6 py-4 border-b border-slate-100 dark:border-gray-800">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-gray-500">{t("previewTitle")}</span>
            <span className="text-xs text-slate-400 dark:text-gray-500">{visibleCount}/{items.length}</span>
          </div>

          {previewFilters && (
            <div className="flex flex-wrap items-center gap-2 mb-3">
              {previewFilters.date && (
                <>
                  <input type="date" value={filterDateFrom} onChange={(e) => setFilterDateFrom(e.target.value)} className="border border-slate-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-2 py-1.5 text-xs focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none" />
                  <input type="date" value={filterDateTo} onChange={(e) => setFilterDateTo(e.target.value)} className="border border-slate-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-2 py-1.5 text-xs focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none" />
                </>
              )}
              {previewFilters.status && (
                <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)} className="border border-slate-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-2 py-1.5 text-xs focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none">
                  <option value="">{previewFilters.status.allLabel}</option>
                  {previewFilters.status.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              )}
              {previewFilters.technician && (
                <select value={filterTechnician} onChange={(e) => setFilterTechnician(e.target.value)} className="border border-slate-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-2 py-1.5 text-xs focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none">
                  <option value="">{previewFilters.technician.allLabel}</option>
                  {previewFilters.technician.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              )}
            </div>
          )}

          <div className="bg-slate-50 dark:bg-gray-800/40 border border-slate-100 dark:border-gray-800 rounded-xl overflow-hidden">
            {renderPreviewCell ? (
              <div className="overflow-x-auto max-h-40">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-left border-b border-slate-200 dark:border-gray-700 bg-white dark:bg-gray-900">
                      {previewColumns.map((col) => (
                        <th key={col.key} className={`p-2 whitespace-nowrap font-semibold ${col.pinned ? "text-blue-600 dark:text-blue-400" : "text-slate-500 dark:text-gray-400"}`}>
                          <span className="flex items-center gap-1">
                            {col.pinned && <PinIcon active className="w-3 h-3" />}
                            {t(`columns.${col.key}`)}
                          </span>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {filteredPreviewRows.map((row, i) => (
                      <tr key={i} className="border-b last:border-0 border-slate-100 dark:border-gray-800">
                        {previewColumns.map((col) => (
                          <td key={col.key} className="p-2 whitespace-nowrap text-slate-600 dark:text-gray-300">{renderPreviewCell(col.key, row)}</td>
                        ))}
                      </tr>
                    ))}
                    {filteredPreviewRows.length === 0 && (
                      <tr><td className="p-3 text-slate-400" colSpan={previewColumns.length || 1}>{t("noFieldsFound")}</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="p-4 flex flex-wrap gap-2">
                {previewColumns.map((col) => (
                  <span key={col.key} className={`flex items-center gap-1 text-xs font-medium rounded-full px-3 py-1 ${col.pinned ? "bg-blue-600 text-white" : "bg-white dark:bg-gray-900 border border-slate-200 dark:border-gray-700 text-slate-600 dark:text-gray-300"}`}>
                    {col.pinned && <PinIcon active className="w-3 h-3" />}
                    {t(`columns.${col.key}`)}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="flex flex-col lg:flex-row flex-1 overflow-hidden">
          <div className="flex-1 flex flex-col overflow-hidden lg:border-r border-slate-100 dark:border-gray-800">
            <div className="px-6 py-4 border-b border-slate-100 dark:border-gray-800 flex flex-wrap items-center gap-3">
              <div className="relative flex-1 min-w-[200px]">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"><SearchIcon className="w-4 h-4" /></span>
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder={t("searchFields")}
                  className="w-full border border-slate-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded-lg pl-9 pr-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-shadow text-sm"
                />
              </div>
              <button
                type="button"
                onClick={handleReset}
                className="flex items-center gap-1.5 text-xs font-medium text-slate-500 dark:text-gray-400 border border-slate-200 dark:border-gray-700 hover:bg-slate-50 dark:hover:bg-gray-800 rounded-lg px-3 py-2 transition-colors whitespace-nowrap"
              >
                <RefreshIcon className="w-3.5 h-3.5" />
                {t("resetDefault")}
              </button>
            </div>

            {!search && (
              <div className="flex items-center gap-1 px-6 pt-3 overflow-x-auto border-b border-slate-100 dark:border-gray-800">
                {categoryOrder.map((cat) => {
                  const CatIcon = categoryIcon(cat);
                  const catItems = items.filter((c) => (c.category || "other") === cat);
                  const catVisible = catItems.filter((c) => c.visible).length;
                  const active = activeCategory === cat;
                  return (
                    <button
                      key={cat}
                      type="button"
                      onClick={() => setActiveCategory(cat)}
                      className={`flex items-center gap-1.5 text-xs font-medium px-3 py-2 rounded-t-lg border-b-2 transition-all duration-200 whitespace-nowrap ${
                        active
                          ? "border-blue-600 text-blue-600 bg-blue-50 dark:bg-blue-500/10 dark:text-blue-400"
                          : "border-transparent text-slate-500 dark:text-gray-400 hover:bg-slate-50 dark:hover:bg-gray-800"
                      }`}
                    >
                      <CatIcon className="w-3.5 h-3.5" />
                      {t(`categories.${cat}`)}
                      <span className={`text-[10px] rounded-full px-1.5 ${active ? "bg-blue-600 text-white" : "bg-slate-200 dark:bg-gray-700 text-slate-500 dark:text-gray-400"}`}>{catVisible}/{catItems.length}</span>
                    </button>
                  );
                })}
              </div>
            )}

            <div className="p-6 overflow-y-auto space-y-5">
              {visibleCategories.map((cat) => {
                const cols = grouped[cat];
                const CatIcon = categoryIcon(cat);
                return (
                  <div key={cat} className="animate-fadeIn">
                    {search && (
                      <div className="flex items-center gap-2 mb-2">
                        <CatIcon className="w-3.5 h-3.5 text-slate-400" />
                        <span className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-gray-400">{t(`categories.${cat}`)}</span>
                      </div>
                    )}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {cols.map((col) => (
                        <div
                          key={col.key}
                          draggable
                          onDragStart={() => setDragKey(col.key)}
                          onDragEnter={() => setDragOverKey(col.key)}
                          onDragOver={(e) => e.preventDefault()}
                          onDragEnd={() => { setDragKey(null); setDragOverKey(null); }}
                          onDrop={() => handleDrop(col.key)}
                          className={`flex items-center gap-2 border rounded-lg px-3 py-2 transition-all duration-150 ${
                            col.pinned
                              ? "border-blue-200 bg-blue-50/60 dark:bg-blue-500/10 dark:border-blue-500/30"
                              : "border-slate-100 dark:border-gray-800"
                          } ${col.visible ? "" : "opacity-50"} ${dragKey === col.key ? "opacity-40" : ""} ${dragOverKey === col.key && dragKey !== col.key ? "ring-2 ring-blue-300" : ""}`}
                        >
                          <span className="cursor-grab text-slate-300 dark:text-gray-600"><GripIcon /></span>
                          <CatIcon className="w-3.5 h-3.5 text-slate-400 dark:text-gray-500 flex-shrink-0" />
                          <span className="flex-1 text-sm font-medium text-slate-700 dark:text-gray-200 truncate">{t(`columns.${col.key}`)}</span>
                          <button type="button" onClick={() => togglePin(col.key)} className={col.pinned ? "text-blue-600" : "text-slate-300 dark:text-gray-600 hover:text-slate-500"} title={t("pinColumn")}>
                            <PinIcon active={col.pinned} />
                          </button>
                          <div className="flex flex-col text-slate-300 dark:text-gray-600">
                            <button type="button" onClick={() => move(col.key, -1)} disabled={indexOf(col.key) === 0} className="disabled:opacity-30 hover:text-slate-500 leading-none">
                              <ChevronUpIcon className="w-3.5 h-3.5" />
                            </button>
                            <button type="button" onClick={() => move(col.key, 1)} disabled={indexOf(col.key) === items.length - 1} className="disabled:opacity-30 hover:text-slate-500 leading-none">
                              <ChevronDownIcon className="w-3.5 h-3.5" />
                            </button>
                          </div>
                          <Toggle checked={col.visible} onChange={() => toggle(col.key)} />
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
              {visibleCategories.length === 0 && <p className="text-sm text-slate-400">{t("noFieldsFound")}</p>}
            </div>
          </div>

          <div className="w-full lg:w-72 flex-shrink-0 flex flex-col overflow-hidden border-t lg:border-t-0 border-slate-100 dark:border-gray-800">
            <div className="px-4 py-3 border-b border-slate-100 dark:border-gray-800 flex items-center gap-2">
              <BookmarkIcon className="w-3.5 h-3.5 text-slate-400" />
              <span className="text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-gray-500">{t("savedViews")}</span>
            </div>
            <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2 max-h-56 lg:max-h-none">
              {error && <p className="text-red-600 text-xs">{error}</p>}
              {views.map((view) => (
                <div key={view.id} className="border border-slate-100 dark:border-gray-800 rounded-lg p-3 animate-fadeIn">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium text-slate-700 dark:text-gray-200 truncate">{view.viewName}</span>
                    {view.isDefault && <span className="text-[10px] font-medium bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400 rounded-full px-2 py-0.5 flex-shrink-0">{t("default")}</span>}
                  </div>
                  <div className="text-[11px] text-slate-400 dark:text-gray-500 mb-2">{view.scope === "Company" ? t("companyView") : t("personalView")}</div>
                  <div className="flex flex-wrap gap-1.5">
                    <button type="button" onClick={() => handleLoadView(view)} className="text-xs font-medium text-blue-600 dark:text-blue-400 border border-blue-100 dark:border-blue-500/30 hover:bg-blue-50 dark:hover:bg-blue-500/10 rounded-md px-2 py-1 transition-colors">{t("loadView")}</button>
                    <button type="button" onClick={() => handleSetDefault(view)} className="text-xs font-medium text-slate-500 dark:text-gray-400 border border-slate-200 dark:border-gray-700 hover:bg-slate-50 dark:hover:bg-gray-800 rounded-md px-2 py-1 transition-colors">{t("setAsDefault")}</button>
                    <button type="button" onClick={() => handleDeleteView(view)} className="text-xs font-medium text-red-500 border border-red-100 dark:border-red-500/30 hover:bg-red-50 dark:hover:bg-red-500/10 rounded-md px-2 py-1 transition-colors">{t("deleteView")}</button>
                  </div>
                </div>
              ))}
              {views.length === 0 && <p className="text-xs text-slate-400">{t("noSavedViews")}</p>}
            </div>
            <div className="p-4 border-t border-slate-100 dark:border-gray-800 space-y-2">
              <input
                value={viewName}
                onChange={(e) => setViewName(e.target.value)}
                placeholder={t("viewNamePlaceholder")}
                className="w-full border border-slate-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-shadow text-xs"
              />
              <button type="button" onClick={() => handleSaveView("Personal")} className="w-full border border-slate-200 dark:border-gray-700 hover:bg-slate-50 dark:hover:bg-gray-800 text-slate-600 dark:text-gray-300 rounded-lg px-3 py-2 transition-colors text-xs font-medium">
                {t("savePersonalView")}
              </button>
              <button type="button" onClick={() => handleSaveView("Company")} className="w-full border border-slate-200 dark:border-gray-700 hover:bg-slate-50 dark:hover:bg-gray-800 text-slate-600 dark:text-gray-300 rounded-lg px-3 py-2 transition-colors text-xs font-medium">
                {t("saveCompanyView")}
              </button>
            </div>
          </div>
        </div>

        <div className="px-6 py-4 border-t border-slate-100 dark:border-gray-800 bg-slate-50 dark:bg-gray-900 flex justify-end">
          <button type="button" onClick={() => onApply(items)} className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors px-5 py-2.5 text-sm font-medium">
            <CheckIcon className="w-4 h-4" />
            {applyLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
