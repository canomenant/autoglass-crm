"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";

function formatPhone(digits) {
  const d = digits.slice(0, 10);
  if (d.length === 0) return "";
  if (d.length < 4) return `(${d}`;
  if (d.length < 7) return `(${d.slice(0, 3)}) ${d.slice(3)}`;
  return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
}

export default function PhoneInput({ value, onChange, placeholder, className, required, disabled }) {
  const tc = useTranslations("common");
  const [touched, setTouched] = useState(false);
  const digits = (value || "").replace(/\D/g, "").slice(0, 10);
  const display = formatPhone(digits);
  const incomplete = touched && digits.length > 0 && digits.length < 10;

  function handleChange(e) {
    onChange(e.target.value.replace(/\D/g, "").slice(0, 10));
  }

  return (
    <div>
      <input
        type="tel"
        inputMode="numeric"
        autoComplete="tel"
        value={display}
        placeholder={placeholder || "(000) 000-0000"}
        onChange={handleChange}
        onBlur={() => setTouched(true)}
        required={required}
        disabled={disabled}
        className={
          className ||
          `w-full border ${incomplete ? "border-red-400" : "border-gray-200 dark:border-gray-700"} dark:bg-gray-800 dark:text-gray-100 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-shadow text-sm disabled:bg-gray-100 dark:disabled:bg-gray-900 disabled:cursor-not-allowed`
        }
      />
      {incomplete && <p className="text-xs text-red-500 mt-1">{tc("mustBe10Digits")}</p>}
    </div>
  );
}
