"use client";

import { useState } from "react";

function sanitizeRaw(input) {
  let raw = input.replace(/[^0-9.]/g, "");
  const firstDot = raw.indexOf(".");
  if (firstDot !== -1) {
    raw = raw.slice(0, firstDot + 1) + raw.slice(firstDot + 1).replace(/\./g, "");
    const [intPart, decPart] = raw.split(".");
    raw = `${intPart}.${decPart.slice(0, 2)}`;
  }
  if (raw !== "" && raw !== "." && Number(raw) > 100) raw = "100";
  return raw;
}

function formatPercent(value) {
  const num = Number(value) || 0;
  return num.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function PercentInput({ value, onChange, placeholder, className, disabled }) {
  const [focused, setFocused] = useState(false);
  const [rawText, setRawText] = useState("");

  const display = focused ? rawText : (value ? formatPercent(value) : "");

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
    const num = raw === "" || raw === "." ? 0 : Number(raw);
    onChange(Math.min(100, Math.max(0, num)));
  }

  return (
    <div className="relative">
      <input
        type="text"
        inputMode="decimal"
        value={display}
        placeholder={placeholder || "0.00"}
        onFocus={handleFocus}
        onBlur={handleBlur}
        onChange={handleChange}
        disabled={disabled}
        className={
          className ||
          "w-full border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded-lg pl-3 pr-7 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-shadow text-sm disabled:bg-gray-100 dark:disabled:bg-gray-900 disabled:cursor-not-allowed"
        }
      />
      <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none select-none text-sm">%</span>
    </div>
  );
}
