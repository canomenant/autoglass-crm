"use client";

import { useEffect, useRef, useState } from "react";

export default function SearchableSelect({ value, onChange, options, placeholder, disabled, required, className }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const wrapperRef = useRef(null);

  const selected = options.find((o) => String(o.value) === String(value));

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

  const filtered = query
    ? options.filter((o) => (o.searchText || o.label).toLowerCase().includes(query.toLowerCase()))
    : options;

  function handleSelect(option) {
    onChange(option.value);
    setOpen(false);
    setQuery("");
  }

  return (
    <div className="relative" ref={wrapperRef}>
      <input
        type="text"
        value={open ? query : (selected?.label || "")}
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
          {filtered.length === 0 && <div className="px-3 py-2 text-sm text-gray-400">—</div>}
          {filtered.map((option) => (
            <button
              key={option.value}
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
        </div>
      )}
    </div>
  );
}
