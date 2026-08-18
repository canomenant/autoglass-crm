"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { EyeIcon, EyeOffIcon, RefreshIcon, ClipboardIcon, CheckIcon } from "./Icons";

export const MIN_PASSWORD_LENGTH = 8;

// Cryptographically random, not Math.random() — this generates real credentials.
function randomInt(max) {
  const arr = new Uint32Array(1);
  crypto.getRandomValues(arr);
  return arr[0] % max;
}

// Guarantees at least one char from each class, then shuffles (Fisher-Yates) so the guaranteed
// chars aren't always in the same leading positions.
export function generateStrongPassword(length = 16) {
  const classes = ["ABCDEFGHJKLMNPQRSTUVWXYZ", "abcdefghijkmnpqrstuvwxyz", "23456789", "!@#%&*?"];
  const all = classes.join("");
  const chars = classes.map((set) => set[randomInt(set.length)]);
  while (chars.length < length) chars.push(all[randomInt(all.length)]);
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join("");
}

function strengthOf(pw) {
  if (!pw) return null;
  let score = 0;
  if (pw.length >= MIN_PASSWORD_LENGTH) score++;
  if (pw.length >= 12) score++;
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) score++;
  if (/\d/.test(pw)) score++;
  if (/[^a-zA-Z0-9]/.test(pw)) score++;
  if (score <= 2) return "weak";
  if (score <= 3) return "medium";
  return "strong";
}

const STRENGTH_STYLE = {
  weak: { bars: 1, color: "bg-red-500", text: "text-red-500" },
  medium: { bars: 2, color: "bg-amber-500", text: "text-amber-500" },
  strong: { bars: 3, color: "bg-green-500", text: "text-green-500" },
};

// Shared by AgentForm/TechnicianForm/UserForm wherever an admin sets or resets someone else's
// password: show/hide, a strong-password generator, copy-to-clipboard (the real use case — an
// admin needs to hand this exact value to the account's owner), and a live strength readout.
// Actual minimum-length enforcement lives server-side in lib/password.js; this is user feedback,
// not the source of truth.
export default function PasswordField({ label, value, onChange, placeholder, required }) {
  const t = useTranslations("common");
  const [show, setShow] = useState(false);
  const [copied, setCopied] = useState(false);

  const strength = strengthOf(value);
  const tooShort = value.length > 0 && value.length < MIN_PASSWORD_LENGTH;

  function handleGenerate() {
    onChange(generateStrongPassword());
    setShow(true);
  }

  async function handleCopy() {
    await navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <label className="text-sm text-gray-600 dark:text-gray-300">
          {label}
          {required && <span className="text-red-500"> *</span>}
        </label>
        <button type="button" onClick={handleGenerate} className="flex items-center gap-1 text-xs text-blue-600 dark:text-blue-400 hover:underline">
          <RefreshIcon className="w-3 h-3" />
          {t("passwordField.generate")}
        </button>
      </div>

      <div className="relative">
        <input
          type={show ? "text" : "password"}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          autoComplete="new-password"
          required={required}
          className="w-full border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-3 py-2 pr-16 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-shadow"
        />
        <div className="absolute right-1.5 top-1/2 -translate-y-1/2 flex items-center gap-0.5">
          <button
            type="button"
            onClick={() => setShow((s) => !s)}
            title={show ? t("passwordField.hide") : t("passwordField.show")}
            className="p-1.5 rounded text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700"
          >
            {show ? <EyeOffIcon className="w-4 h-4" /> : <EyeIcon className="w-4 h-4" />}
          </button>
          <button
            type="button"
            onClick={handleCopy}
            disabled={!value}
            title={t("passwordField.copy")}
            className="p-1.5 rounded text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-30 disabled:hover:bg-transparent"
          >
            {copied ? <CheckIcon className="w-4 h-4 text-green-500" /> : <ClipboardIcon className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {copied && <p className="text-xs text-green-600 dark:text-green-400 mt-1">{t("passwordField.copied")}</p>}

      {strength && (
        <div className="flex items-center gap-2 mt-1.5">
          <div className="flex gap-1 flex-1">
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                className={`h-1 flex-1 rounded-full ${i < STRENGTH_STYLE[strength].bars ? STRENGTH_STYLE[strength].color : "bg-gray-200 dark:bg-gray-700"}`}
              />
            ))}
          </div>
          <span className={`text-xs font-medium ${STRENGTH_STYLE[strength].text}`}>{t(`passwordField.strength${strength.charAt(0).toUpperCase()}${strength.slice(1)}`)}</span>
        </div>
      )}

      {tooShort && <p className="text-xs text-red-500 mt-1">{t("passwordField.tooShort")}</p>}
    </div>
  );
}
