"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { REPORT_CATEGORIES, REPORT_COLUMNS } from "@/lib/detailedReportColumns";

function ChevronIcon({ open }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={`w-4 h-4 flex-shrink-0 opacity-60 transition-transform ${open ? "rotate-180" : ""}`}>
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

function XIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="w-3 h-3 flex-shrink-0">
      <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

// Elegir qué columnas lleva el reporte, y en qué orden.
//
// El orden es el orden en que se marcan, no el del catálogo: quien arma un reporte piensa "primero
// la fecha, luego el número, luego el cliente", y que salieran siempre en el orden interno obligaría
// a recolocarlas en Excel. Por eso `selected` es una lista y no un conjunto, y las pastillas de
// arriba enseñan ese orden — que es exactamente el de la vista previa y el del archivo.
export default function ReportColumnPicker({ selected, onChange, defaults }) {
  const t = useTranslations("detailedReport");
  const tcol = useTranslations("detailedReport.columns");
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    function handleClickOutside(e) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target)) setOpen(false);
    }
    function handleKey(e) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKey);
    };
  }, [open]);

  const byCategory = useMemo(() => {
    return REPORT_CATEGORIES.map((category) => ({
      category,
      columns: REPORT_COLUMNS.filter((c) => c.category === category),
    }));
  }, []);

  function toggle(key) {
    onChange(selected.includes(key) ? selected.filter((k) => k !== key) : [...selected, key]);
  }

  return (
    <div ref={wrapperRef} className="relative">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setOpen((prev) => !prev)}
          aria-haspopup="true"
          aria-expanded={open}
          className="inline-flex items-center gap-2 border border-slate-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-3 py-2 text-sm text-slate-600 hover:border-slate-300 dark:hover:border-gray-600 focus:ring-2 focus:ring-blue-500 outline-none transition-colors"
        >
          {t("chooseColumns")}
          <span className="bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-300 rounded-full px-1.5 text-xs font-semibold">{selected.length}</span>
          <ChevronIcon open={open} />
        </button>

        {/* Las columnas elegidas, en su orden. Se quitan desde aquí sin abrir el menú. */}
        {selected.map((key, i) => (
          <span key={key} className="inline-flex items-center gap-1.5 bg-slate-100 dark:bg-gray-800 text-slate-700 dark:text-gray-200 rounded-full pl-2.5 pr-1.5 py-1 text-xs">
            <span className="text-slate-400 dark:text-gray-500 tabular-nums">{i + 1}</span>
            {tcol(key)}
            <button
              type="button"
              onClick={() => toggle(key)}
              aria-label={`${t("removeColumn")}: ${tcol(key)}`}
              className="text-slate-400 hover:text-red-600 dark:hover:text-red-400 transition-colors"
            >
              <XIcon />
            </button>
          </span>
        ))}
      </div>

      {open && (
        <div className="absolute z-30 mt-2 w-[min(46rem,90vw)] max-h-[26rem] overflow-y-auto bg-white dark:bg-gray-900 border border-slate-200 dark:border-gray-700 rounded-xl shadow-lg p-4">
          <div className="flex items-center justify-between mb-3 pb-3 border-b dark:border-gray-800">
            <p className="text-xs text-slate-500 dark:text-gray-400">{t("chooseColumnsHelp")}</p>
            <div className="flex gap-2 flex-shrink-0">
              <button type="button" onClick={() => onChange(defaults)} className="text-xs text-blue-600 dark:text-blue-400 hover:underline">
                {t("resetColumns")}
              </button>
              <button type="button" onClick={() => onChange([])} className="text-xs text-slate-500 dark:text-gray-400 hover:underline">
                {t("clearColumns")}
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-4">
            {byCategory.map(({ category, columns }) => (
              <div key={category}>
                <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-gray-500 mb-1.5">{t(`categories.${category}`)}</h3>
                <div className="space-y-0.5">
                  {columns.map((col) => (
                    <label key={col.key} className="flex items-center gap-2 text-sm text-slate-700 dark:text-gray-200 py-0.5 cursor-pointer hover:text-blue-700 dark:hover:text-blue-400">
                      <input
                        type="checkbox"
                        checked={selected.includes(col.key)}
                        onChange={() => toggle(col.key)}
                        className="w-4 h-4 rounded border-slate-300 dark:border-gray-600 text-blue-600 focus:ring-blue-500"
                      />
                      {tcol(col.key)}
                    </label>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
