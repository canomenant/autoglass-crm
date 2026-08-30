"use client";

import { useEffect, useRef, useState } from "react";

// Desplegable con casillas para filtrar por UNA O VARIAS partes a la vez (Antonio, 29-ago-2026:
// "que podamos seleccionar 1 o más distribuidores"). El <select> nativo múltiple exige
// Ctrl+clic y en la práctica nadie lo descubre; esto es un botón que abre una lista de checkboxes.
export default function MultiSelectFilter({ options, values, onChange, placeholder, className = "" }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    const onDoc = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const toggle = (v) =>
    onChange(values.includes(v) ? values.filter((x) => x !== v) : [...values, v]);

  const label =
    values.length === 0 ? placeholder : values.length === 1 ? values[0] : `${values[0]} +${values.length - 1}`;

  return (
    <div ref={ref} className={`relative ${className}`}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between gap-2 border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
      >
        <span className={`truncate ${values.length ? "" : "text-gray-400 dark:text-gray-500"}`}>{label}</span>
        <span className="text-gray-400 text-xs">▾</span>
      </button>
      {open && (
        <div className="absolute z-20 mt-1 w-full min-w-[240px] max-h-64 overflow-y-auto bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg py-1">
          {options.map((o) => (
            <label key={o} className="flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-gray-50 dark:hover:bg-gray-800 cursor-pointer dark:text-gray-200">
              <input type="checkbox" checked={values.includes(o)} onChange={() => toggle(o)} />
              <span className="truncate">{o}</span>
            </label>
          ))}
          {options.length === 0 && <div className="px-3 py-2 text-sm text-gray-400">—</div>}
        </div>
      )}
    </div>
  );
}
