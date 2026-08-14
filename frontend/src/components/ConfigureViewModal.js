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

function CategoryBadge({ category, t }) {
  const CatIcon = categoryIcon(category);
  return (
    <span className="flex items-center gap-1 text-[10px] font-medium text-slate-400 dark:text-gray-500 bg-slate-100 dark:bg-gray-800 rounded-full px-2 py-0.5 flex-shrink-0">
      <CatIcon className="w-3 h-3" />
      {t(`categories.${category || "other"}`)}
    </span>
  );
}

function SelectedColumnRow({
  col, predicate, groupKeys, t,
  dragKey, dragOverKey, setDragKey, setDragOverKey,
  handleSelectedDrop, moveInGroup, togglePin, toggle,
}) {
  const pos = groupKeys.indexOf(col.key);
  return (
    <div
      draggable
      onDragStart={() => setDragKey(col.key)}
      onDragEnter={() => setDragOverKey(col.key)}
      onDragOver={(e) => e.preventDefault()}
      onDragEnd={() => { setDragKey(null); setDragOverKey(null); }}
      onDrop={() => handleSelectedDrop(predicate, col.key)}
      className={`flex items-center gap-2 border rounded-lg px-3 py-1.5 bg-white dark:bg-gray-900 transition-all duration-150 ${
        col.pinned ? "border-blue-200 dark:border-blue-500/30" : "border-slate-200 dark:border-gray-700"
      } ${dragKey === col.key ? "opacity-40" : ""} ${dragOverKey === col.key && dragKey !== col.key ? "ring-2 ring-blue-300" : ""}`}
    >
      <span className="cursor-grab text-slate-300 dark:text-gray-600"><GripIcon /></span>
      <span className="flex-1 text-sm font-medium text-slate-700 dark:text-gray-200 truncate">{t(`columns.${col.key}`)}</span>
      <CategoryBadge category={col.category} t={t} />
      <button type="button" onClick={() => togglePin(col.key)} className={col.pinned ? "text-blue-600" : "text-slate-300 dark:text-gray-600 hover:text-slate-500"} title={t("pinColumn")}>
        <PinIcon active={col.pinned} />
      </button>
      <div className="flex flex-col text-slate-300 dark:text-gray-600">
        <button type="button" onClick={() => moveInGroup(predicate, col.key, -1)} disabled={pos === 0} className="disabled:opacity-30 hover:text-slate-500 leading-none">
          <ChevronUpIcon className="w-3.5 h-3.5" />
        </button>
        <button type="button" onClick={() => moveInGroup(predicate, col.key, 1)} disabled={pos === groupKeys.length - 1} className="disabled:opacity-30 hover:text-slate-500 leading-none">
          <ChevronDownIcon className="w-3.5 h-3.5" />
        </button>
      </div>
      <button type="button" onClick={() => toggle(col.key)} className="text-slate-300 dark:text-gray-600 hover:text-red-500" title={t("removeColumn")}>
        <CloseIcon className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

function AvailableColumnRow({ col, t, toggle }) {
  return (
    <div className="flex items-center gap-2 border border-slate-100 dark:border-gray-800 rounded-lg px-3 py-1.5">
      <span className="flex-1 text-sm font-medium text-slate-600 dark:text-gray-300 truncate">{t(`columns.${col.key}`)}</span>
      <CategoryBadge category={col.category} t={t} />
      <Toggle checked={false} onChange={() => toggle(col.key)} />
    </div>
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

  const [filterDateFrom, setFilterDateFrom] = useState("");
  const [filterDateTo, setFilterDateTo] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const [filterTechnician, setFilterTechnician] = useState("");

  useEffect(() => {
    getTableViews(module).then(setViews).catch(() => {});
  }, [module]);

  function toggle(key) {
    setItems((prev) => prev.map((c) => (c.key === key ? { ...c, visible: !c.visible } : c)));
  }

  function togglePin(key) {
    setItems((prev) => prev.map((c) => (c.key === key ? { ...c, pinned: !c.pinned } : c)));
  }

  // The real table order is [visible+pinned..., visible+non-pinned...] (see previewColumns
  // below) — pinned columns always render first regardless of array position. So reordering
  // must stay within one group or the "Selected Columns" panel would show an order the table
  // doesn't actually use. Moves/drops only ever shuffle positions *within* the set of slots
  // already occupied by that group — other items (hidden, or the other pin group) keep their
  // slots untouched.
  function reorderWithinGroup(prev, predicate, fromKey, toKey) {
    const groupIndices = [];
    prev.forEach((c, i) => {
      if (predicate(c)) groupIndices.push(i);
    });
    const groupKeys = groupIndices.map((i) => prev[i].key);
    const fromPos = groupKeys.indexOf(fromKey);
    const toPos = groupKeys.indexOf(toKey);
    if (fromPos === -1 || toPos === -1 || fromPos === toPos) return prev;
    const reordered = [...groupKeys];
    const [moved] = reordered.splice(fromPos, 1);
    reordered.splice(toPos, 0, moved);
    const next = [...prev];
    groupIndices.forEach((originalIndex, i) => {
      next[originalIndex] = prev.find((c) => c.key === reordered[i]);
    });
    return next;
  }

  function moveInGroup(predicate, key, dir) {
    setItems((prev) => {
      const groupKeys = prev.filter(predicate).map((c) => c.key);
      const pos = groupKeys.indexOf(key);
      const target = pos + dir;
      if (pos === -1 || target < 0 || target >= groupKeys.length) return prev;
      return reorderWithinGroup(prev, predicate, key, groupKeys[target]);
    });
  }

  function handleSelectedDrop(predicate, toKey) {
    if (dragKey !== null) {
      setItems((prev) => reorderWithinGroup(prev, predicate, dragKey, toKey));
    }
    setDragKey(null);
    setDragOverKey(null);
  }

  const isPinnedVisible = (c) => c.visible && c.pinned;
  const isOtherVisible = (c) => c.visible && !c.pinned;

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

  function matchesSearch(col) {
    if (!search) return true;
    const label = t(`columns.${col.key}`);
    const q = search.toLowerCase();
    return label.toLowerCase().includes(q) || col.key.toLowerCase().includes(q);
  }

  const previewColumns = useMemo(
    () => [...items.filter((c) => c.visible && c.pinned), ...items.filter((c) => c.visible && !c.pinned)],
    [items]
  );
  const visibleCount = items.filter((c) => c.visible).length;

  // Selected columns keep the real table order (see previewColumns above — pinned always
  // first). groupKeys/predicate stay unfiltered by search so drag/move math isn't thrown off
  // by items temporarily hidden by the search box; only the rendered list is filtered.
  const pinnedSelected = useMemo(() => items.filter(isPinnedVisible), [items]);
  const otherSelected = useMemo(() => items.filter(isOtherVisible), [items]);
  const pinnedSelectedKeys = useMemo(() => pinnedSelected.map((c) => c.key), [pinnedSelected]);
  const otherSelectedKeys = useMemo(() => otherSelected.map((c) => c.key), [otherSelected]);
  const pinnedSelectedVisible = pinnedSelected.filter(matchesSearch);
  const otherSelectedVisible = otherSelected.filter(matchesSearch);

  // Available (inactive) fields: no per-category grouping anymore — one flat, alphabetical
  // list, since there's no tab structure left to lean on for browsing. Order carries no
  // meaning here (nothing renders these in the table), so alphabetical is purely for scanning.
  const availableColumns = useMemo(
    () =>
      items
        .filter((c) => !c.visible)
        .slice()
        .sort((a, b) => t(`columns.${a.key}`).localeCompare(t(`columns.${b.key}`))),
    [items, t]
  );
  const availableVisible = availableColumns.filter(matchesSearch);

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

            <div className="flex-1 overflow-y-auto p-6 space-y-5">
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-gray-500">{t("selectedColumnsTitle")}</span>
                  <span className="text-xs text-slate-400 dark:text-gray-500">{visibleCount}</span>
                </div>
                {visibleCount === 0 ? (
                  <p className="text-sm text-slate-400">{t("noColumnsSelected")}</p>
                ) : (
                  <div className="space-y-3">
                    {pinnedSelectedVisible.length > 0 && (
                      <div>
                        <div className="text-[10px] font-semibold uppercase tracking-wide text-blue-500 mb-1.5">{t("pinnedGroupLabel")}</div>
                        <div className="space-y-1.5">
                          {pinnedSelectedVisible.map((col) => (
                            <SelectedColumnRow
                              key={col.key}
                              col={col}
                              predicate={isPinnedVisible}
                              groupKeys={pinnedSelectedKeys}
                              t={t}
                              dragKey={dragKey}
                              dragOverKey={dragOverKey}
                              setDragKey={setDragKey}
                              setDragOverKey={setDragOverKey}
                              handleSelectedDrop={handleSelectedDrop}
                              moveInGroup={moveInGroup}
                              togglePin={togglePin}
                              toggle={toggle}
                            />
                          ))}
                        </div>
                      </div>
                    )}
                    {otherSelectedVisible.length > 0 && (
                      <div>
                        <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400 dark:text-gray-500 mb-1.5">{t("otherGroupLabel")}</div>
                        <div className="space-y-1.5">
                          {otherSelectedVisible.map((col) => (
                            <SelectedColumnRow
                              key={col.key}
                              col={col}
                              predicate={isOtherVisible}
                              groupKeys={otherSelectedKeys}
                              t={t}
                              dragKey={dragKey}
                              dragOverKey={dragOverKey}
                              setDragKey={setDragKey}
                              setDragOverKey={setDragOverKey}
                              handleSelectedDrop={handleSelectedDrop}
                              moveInGroup={moveInGroup}
                              togglePin={togglePin}
                              toggle={toggle}
                            />
                          ))}
                        </div>
                      </div>
                    )}
                    {pinnedSelectedVisible.length === 0 && otherSelectedVisible.length === 0 && (
                      <p className="text-sm text-slate-400">{t("noFieldsFound")}</p>
                    )}
                  </div>
                )}
              </div>

              <div className="flex items-center gap-3">
                <div className="h-px flex-1 bg-slate-200 dark:bg-gray-800" />
                <span className="text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-gray-500 whitespace-nowrap">{t("availableFieldsLabel")}</span>
                <div className="h-px flex-1 bg-slate-200 dark:bg-gray-800" />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {availableVisible.map((col) => (
                  <AvailableColumnRow key={col.key} col={col} t={t} toggle={toggle} />
                ))}
              </div>
              {availableVisible.length === 0 && <p className="text-sm text-slate-400">{t("noFieldsFound")}</p>}
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
