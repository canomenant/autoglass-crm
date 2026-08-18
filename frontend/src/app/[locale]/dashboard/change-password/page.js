"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { changePassword, getCurrentUser } from "@/lib/api";

export default function ChangePasswordPage() {
  const t = useTranslations("changePassword");
  const user = getCurrentUser();

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");

    if (newPassword.length < 8) {
      setError(t("tooShort"));
      return;
    }
    if (newPassword !== confirmPassword) {
      setError(t("mismatch"));
      return;
    }

    setSaving(true);
    try {
      await changePassword({ currentPassword, newPassword });
      const stored = getCurrentUser();
      if (stored) {
        localStorage.setItem("user", JSON.stringify({ ...stored, mustChangePassword: false }));
      }
      setSuccess(true);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="max-w-md space-y-6">
      <h1 className="text-2xl font-semibold dark:text-gray-100 tracking-tight">{t("title")}</h1>

      {user?.mustChangePassword && !success && (
        <p className="text-sm bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400 rounded-lg px-4 py-3">
          {t("mustChangeNotice")}
        </p>
      )}

      <form onSubmit={handleSubmit} className="bg-white dark:bg-gray-900 dark:border dark:border-gray-800 rounded-xl shadow-sm p-6 space-y-4">
        <div>
          <label className="block text-sm mb-1 text-gray-600 dark:text-gray-300">{t("currentPassword")}</label>
          <input
            type="password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            className="w-full border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-shadow"
            required
          />
        </div>

        <div>
          <label className="block text-sm mb-1 text-gray-600 dark:text-gray-300">{t("newPassword")}</label>
          <input
            type="password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            className="w-full border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-shadow"
            required
          />
        </div>

        <div>
          <label className="block text-sm mb-1 text-gray-600 dark:text-gray-300">{t("confirmPassword")}</label>
          <input
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            className="w-full border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-shadow"
            required
          />
        </div>

        {error && <p className="text-red-600 dark:text-red-400 text-sm">{error}</p>}
        {success && <p className="text-green-600 dark:text-green-400 text-sm">{t("success")}</p>}

        <button
          type="submit"
          disabled={saving}
          className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white rounded-lg transition-colors py-2"
        >
          {saving ? t("saving") : t("submit")}
        </button>
      </form>
    </div>
  );
}
