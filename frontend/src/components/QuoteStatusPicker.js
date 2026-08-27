"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { SELECTABLE_QUOTE_STATUSES, isConvertedStatus } from "@/lib/quoteStatuses";
import { getQuoteStatusDotClass } from "@/lib/quoteStatusColors";
import QuoteStatusBadge from "./QuoteStatusBadge";

function ChevronIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4 flex-shrink-0 opacity-60">
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="w-4 h-4 flex-shrink-0">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

// Sustituye al <select> de estado, que quedaba enterrado a media pantalla entre otros campos y no
// se distinguía de un campo de texto. Aquí el propio botón es la pastilla de color: el estado se
// lee sin buscarlo, y sigue siendo el control para cambiarlo.
//
// "Converted" no aparece en la lista y el menú no se abre cuando ya lo está: esa transición la hace
// el botón de convertir, que además crea la orden de trabajo. Poder elegirlo a mano dejaba
// cotizaciones marcadas como convertidas sin ninguna orden detrás.
export default function QuoteStatusPicker({ value, onChange, disabled }) {
  const t = useTranslations("quotes");
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef(null);

  const locked = disabled || isConvertedStatus(value);

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

  if (locked) {
    return (
      <div>
        <span className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">{t("status")}</span>
        <QuoteStatusBadge status={value} size="lg" variant="strong" withDot />
        {isConvertedStatus(value) && (
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1.5">{t("convertedStatusLocked")}</p>
        )}
      </div>
    );
  }

  return (
    <div ref={wrapperRef} className="relative">
      <span className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">{t("status")}</span>
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="inline-flex items-center gap-2 rounded-full border border-gray-200 dark:border-gray-700 p-1 pr-3 hover:border-gray-300 dark:hover:border-gray-600 focus:ring-2 focus:ring-blue-500 outline-none transition-colors"
      >
        <QuoteStatusBadge status={value} size="lg" variant="strong" withDot />
        <span className="text-xs text-gray-500 dark:text-gray-400">{t("changeStatus")}</span>
        <ChevronIcon />
      </button>

      {open && (
        <div role="listbox" className="absolute z-30 mt-2 w-64 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl shadow-lg py-1">
          {SELECTABLE_QUOTE_STATUSES.map((s) => {
            const active = s === value;
            return (
              <button
                key={s}
                type="button"
                role="option"
                aria-selected={active}
                onClick={() => {
                  if (s !== value) onChange(s);
                  setOpen(false);
                }}
                className={`w-full flex items-center gap-2.5 px-3 py-2 text-sm text-left transition-colors ${
                  active ? "bg-gray-50 dark:bg-gray-800 font-medium" : "hover:bg-gray-50 dark:hover:bg-gray-800"
                } dark:text-gray-100`}
              >
                <span className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${getQuoteStatusDotClass(s)}`} />
                <span className="flex-1">{t(`statuses.${s}`)}</span>
                {active && <CheckIcon />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
