"use client";

import { useState } from "react";

function formatCurrency(value) {
  const num = Number(value) || 0;
  return num.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function sanitizeRaw(input) {
  let raw = input.replace(/[^0-9.]/g, "");
  const firstDot = raw.indexOf(".");
  if (firstDot !== -1) {
    raw = raw.slice(0, firstDot + 1) + raw.slice(firstDot + 1).replace(/\./g, "");
    const [intPart, decPart] = raw.split(".");
    raw = `${intPart}.${decPart.slice(0, 2)}`;
  }
  return raw;
}

export default function CurrencyInput({ value, onChange, placeholder, className, disabled, compact, required }) {
  const [focused, setFocused] = useState(false);
  const [rawText, setRawText] = useState("");

  const display = focused ? rawText : (value ? formatCurrency(value) : "");

  function handleFocus() {
    setFocused(true);
    setRawText(value ? String(value) : "");
  }

  function handleBlur() {
    setFocused(false);
  }

  function handleChange(e) {
    const raw = sanitizeRaw(e.target.value);
    setRawText(raw);
    onChange(raw === "" || raw === "." ? 0 : Number(raw));
  }

  const defaultClassName = compact
    ? "border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded-lg pl-5 pr-2 py-1.5 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-shadow text-xs w-full disabled:bg-gray-100 dark:disabled:bg-gray-900 disabled:text-gray-500 disabled:cursor-not-allowed"
    : "w-full border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded-lg pl-6 pr-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-shadow text-sm disabled:bg-gray-100 dark:disabled:bg-gray-900 disabled:text-gray-500 disabled:cursor-not-allowed";

  return (
    <div className="relative">
      <span className={`absolute top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none select-none ${compact ? "left-2 text-xs" : "left-3 text-sm"}`}>$</span>
      <input
        type="text"
        inputMode="decimal"
        value={display}
        placeholder={placeholder || "0.00"}
        onFocus={handleFocus}
        onBlur={handleBlur}
        onChange={handleChange}
        disabled={disabled}
        required={required}
        className={className || defaultClassName}
      />
    </div>
  );
}
