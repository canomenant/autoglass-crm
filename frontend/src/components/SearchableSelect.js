"use client";

import { useEffect, useMemo, useRef, useState } from "react";

const LARGE_LIST_THRESHOLD = 100;
const MIN_SEARCH_CHARS = 2;
const MAX_RESULTS = 50;

export default function SearchableSelect({ value, onChange, options, placeholder, disabled, required, className, fallbackLabel }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const wrapperRef = useRef(null);

  // Dedupe by value — some catalogs (e.g. the migrated zip codes) carry duplicate rows for
  // the same value; showing two identical-looking options is confusing and also breaks
  // React's key uniqueness. First occurrence wins, matching what a .find() by value would
  // resolve to anyway, so nothing is functionally lost.
  const dedupedOptions = useMemo(() => {
    const seen = new Set();
    const result = [];
    for (const o of options) {
      const key = String(o.value);
      if (seen.has(key)) continue;
      seen.add(key);
      result.push(o);
    }
    return result;
  }, [options]);

  const selected = dedupedOptions.find((o) => String(o.value) === String(value));

  // A value with no matching option (e.g. a historical record whose stored make/model isn't
  // in the current live catalog) used to render as a blank field — indistinguishable from
  // "nothing saved". Editing and submitting the form would then silently wipe out data the
  // user never touched. Show something instead: for self-describing values (model names, zip
  // codes, job types — the value itself already reads fine) that's just the raw value; for
  // opaque values (VehicleSelector's numeric NHTSA makeId) the caller supplies fallbackLabel
  // with the actual human-readable text it already has on hand.
  const displayLabel = selected ? selected.label : value ? (fallbackLabel ?? String(value)) : "";

  useEffect(() => {
    function handleClickOutside(e) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target)) {
        setOpen(false);
        setQuery("");
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Large catalogs (NHTSA makes, zip codes, ...) render every option on focus and re-filter
  // on every keystroke otherwise — with thousands of rows that's thousands of DOM nodes
  // rebuilt per keypress, which reads as "the dropdown doesn't work" rather than "it's slow".
  // Small lists keep the original show-everything-on-focus behavior.
  const isLargeList = dedupedOptions.length > LARGE_LIST_THRESHOLD;
  const needsMoreChars = isLargeList && query.length < MIN_SEARCH_CHARS;

  const matched = query
    ? dedupedOptions.filter((o) => (o.searchText || o.label).toLowerCase().includes(query.toLowerCase()))
    : dedupedOptions;

  const filtered = needsMoreChars ? [] : matched;
  const visible = filtered.slice(0, MAX_RESULTS);
  const truncated = filtered.length > MAX_RESULTS;

  function handleSelect(option) {
    onChange(option.value);
    setOpen(false);
    setQuery("");
  }

  return (
    <div className="relative" ref={wrapperRef}>
      <input
        type="text"
        value={open ? query : displayLabel}
        onChange={(e) => {
          setQuery(e.target.value);
          if (!open) setOpen(true);
        }}
        onFocus={() => {
          setOpen(true);
          setQuery("");
        }}
        placeholder={placeholder}
        disabled={disabled}
        required={required}
        autoComplete="off"
        className={className || "w-full border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-shadow text-sm disabled:bg-gray-100 dark:disabled:bg-gray-900 disabled:cursor-not-allowed"}
      />
      {open && !disabled && (
        <div className="absolute z-30 mt-1 w-full max-h-52 overflow-y-auto bg-white dark:bg-gray-800 border dark:border-gray-700 rounded-lg shadow-lg">
          {needsMoreChars ? (
            <div className="px-3 py-2 text-sm text-gray-400">Escribí {MIN_SEARCH_CHARS} caracteres para buscar…</div>
          ) : (
            <>
              {visible.length === 0 && <div className="px-3 py-2 text-sm text-gray-400">—</div>}
              {visible.map((option) => (
                <button
                  key={String(option.value)}
                  type="button"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    handleSelect(option);
                  }}
                  className="block w-full text-left px-3 py-2 text-sm hover:bg-gray-50 dark:hover:bg-gray-700 dark:text-gray-100"
                >
                  {option.label}
                </button>
              ))}
              {truncated && (
                <div className="px-3 py-2 text-xs text-gray-400 border-t dark:border-gray-700">
                  Mostrando {MAX_RESULTS} de {filtered.length} resultados — refiná la búsqueda
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
