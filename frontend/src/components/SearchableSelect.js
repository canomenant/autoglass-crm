"use client";

import { useEffect, useMemo, useRef, useState } from "react";

const LARGE_LIST_THRESHOLD = 100;
const MIN_SEARCH_CHARS = 2;
const MAX_RESULTS = 50;

function normalizeSearch(value) {
  return String(value || "").toLowerCase().trim();
}

// NAGS part numbers get written every which way — "FW02500 GBN", "fw02500gbn", "FW-02500 GBN" —
// and a plain substring match finds none of the variants from any of the others. Comparing a
// squashed copy of both sides makes every spelling reach the same part.
function squashSearch(value) {
  return normalizeSearch(value).replace(/[\s\-._\/]+/g, "");
}

// Match quality, best first. Without this the catalog was filtered but never ordered, so results
// came back in import order and got cut at MAX_RESULTS: with 11k part numbers, 85.9% of them
// never appeared when you typed their own first three characters, because ~2,400 other parts
// happened to sit ahead of them in the file. An exact prefix now outranks a mid-string hit, and
// a hit in the description outranks neither.
function matchScore(entry, query, squashedQuery) {
  if (entry.label.startsWith(query)) return 0;
  if (entry.squashedLabel.startsWith(squashedQuery)) return 1;
  if (entry.label.includes(query)) return 2;
  if (entry.squashedLabel.includes(squashedQuery)) return 3;
  if (entry.haystack.includes(query)) return 4;
  if (entry.squashedHaystack.includes(squashedQuery)) return 5;
  return -1;
}

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

  // Normalized forms are precomputed per option list, not per keystroke — with 11k entries the
  // difference is a visibly janky dropdown versus a responsive one.
  const indexed = useMemo(
    () =>
      dedupedOptions.map((o) => {
        const haystack = o.searchText || o.label;
        return {
          option: o,
          label: normalizeSearch(o.label),
          squashedLabel: squashSearch(o.label),
          haystack: normalizeSearch(haystack),
          squashedHaystack: squashSearch(haystack),
        };
      }),
    [dedupedOptions]
  );

  const matched = useMemo(() => {
    if (!query) return dedupedOptions;
    const normalizedQuery = normalizeSearch(query);
    const squashedQuery = squashSearch(query);

    const scored = [];
    for (const entry of indexed) {
      const score = matchScore(entry, normalizedQuery, squashedQuery);
      if (score >= 0) scored.push({ score, entry });
    }
    // Alphabetical inside a score band so the list is stable and predictable between keystrokes
    // instead of following the order the catalog happened to be imported in.
    scored.sort((a, b) => a.score - b.score || a.entry.label.localeCompare(b.entry.label));
    return scored.map((s) => s.entry.option);
  }, [dedupedOptions, indexed, query]);

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
