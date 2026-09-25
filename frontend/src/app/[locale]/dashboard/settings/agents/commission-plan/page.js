"use client";

import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import CommissionPlanEditor from "@/components/CommissionPlanEditor";
import { getDefaultCommissionPlan, saveDefaultCommissionPlan } from "@/lib/api";

// El plan de comisión GENERAL: el que usa todo agente que no tiene uno propio en su ficha.
export default function DefaultCommissionPlanPage() {
  const t = useTranslations("commissionPlan");
  const ta = useTranslations("agents");
  const tc = useTranslations("common");
  const locale = useLocale();
  const [versions, setVersions] = useState(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    getDefaultCommissionPlan()
      .then((r) => setVersions(r.versions || []))
      .catch((e) => setError(e.message));
  }, []);

  async function save() {
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const r = await saveDefaultCommissionPlan(versions);
      setVersions(r.versions || []);
      setDirty(false);
      setMessage(t("saved"));
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="max-w-3xl">
      <Link href="/dashboard/settings/agents" className="text-sm text-gray-500">← {ta("title")}</Link>
      <h1 className="text-2xl font-semibold dark:text-gray-100 tracking-tight my-4">{t("defaultTitle")}</h1>
      <p className="text-sm text-gray-600 dark:text-gray-300 mb-4">{t("defaultExplainer")}</p>

      {error && <p className="text-red-600 dark:text-red-400 text-sm mb-3">{error}</p>}
      {message && <p className="text-green-600 dark:text-green-400 text-sm mb-3">{message}</p>}

      {versions === null ? (
        <p className="text-gray-500 text-sm">{tc("loading")}</p>
      ) : (
        <section className="bg-white dark:bg-gray-900 dark:border dark:border-gray-800 rounded-xl shadow-sm p-4">
          <CommissionPlanEditor
            versions={versions}
            locale={locale}
            onChange={(v) => {
              setVersions(v);
              setDirty(true);
            }}
          />
        </section>
      )}

      <button
        type="button"
        onClick={save}
        disabled={!dirty || saving}
        className="mt-4 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors px-6 py-2 disabled:opacity-40"
      >
        {saving ? tc("saving") : tc("saveChanges")}
      </button>
    </div>
  );
}
