"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { getPriceTiers } from "@/lib/api";

// Editor del plan de comisión de un agente (o del plan general): versiones con fecha "vigente
// desde", y en cada una cuánto gana por vidrio según su price tier. Ver backend lib/agentCommission.
//
// Controlado: `versions` entra y cada cambio sale por onChange con la lista completa. Nada se
// guarda aquí — lo guarda el botón del formulario que lo contiene.

const inputCls =
  "border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-2 py-1.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none";

function today() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
}

function tomorrow() {
  const d = new Date(`${today()}T12:00:00`);
  d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}

function formatDay(iso, locale) {
  if (!iso) return "";
  return new Date(`${iso}T12:00:00`).toLocaleDateString(locale === "es" ? "es-MX" : "en-US", { day: "numeric", month: "short", year: "numeric" });
}

export function emptyVersion(effectiveFrom = tomorrow()) {
  return { effectiveFrom, tiers: {}, noTier: { type: "Fixed", value: 0 }, services: { type: "Fixed", value: 0 }, lead: { value: 0 }, goals: [], note: "" };
}

// Qué versión está vigente hoy: la última cuya fecha ya llegó.
function currentIndex(versions) {
  const hoy = today();
  let idx = -1;
  versions.forEach((v, i) => {
    if (v.effectiveFrom <= hoy) idx = i;
  });
  return idx;
}

function RateInput({ rate, onChange }) {
  const r = rate || { type: "Fixed", value: 0 };
  return (
    <div className="flex items-center gap-2">
      <select value={r.type} onChange={(e) => onChange({ ...r, type: e.target.value })} className={inputCls}>
        <option value="Fixed">$</option>
        <option value="Percentage">%</option>
      </select>
      <input
        type="number"
        min="0"
        step="0.01"
        value={r.value ?? 0}
        onChange={(e) => onChange({ ...r, value: e.target.value === "" ? 0 : Number(e.target.value) })}
        className={`${inputCls} w-24 text-right tabular-nums`}
      />
    </div>
  );
}

function VersionCard({ version, status, tiers, onChange, onRemove, locale, t }) {
  const set = (patch) => onChange({ ...version, ...patch });
  const setTier = (name, rate) => set({ tiers: { ...version.tiers, [name]: rate } });
  const badge = {
    current: "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300",
    future: "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300",
    past: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400",
  }[status];

  return (
    <div className={`rounded-lg border ${status === "current" ? "border-green-300 dark:border-green-800" : "border-gray-200 dark:border-gray-800"} p-3`}>
      <div className="flex flex-wrap items-center gap-3 mb-3">
        <label className="flex items-center gap-2 text-sm">
          <span className="text-gray-600 dark:text-gray-300">{t("effectiveFrom")}</span>
          <input type="date" value={version.effectiveFrom} onChange={(e) => set({ effectiveFrom: e.target.value })} className={inputCls} />
        </label>
        <span className={`text-xs rounded-full px-2 py-0.5 ${badge}`}>{t(`status.${status}`)}</span>
        <span className="text-xs text-gray-500 dark:text-gray-400">{t(`statusHint.${status}`, { date: formatDay(version.effectiveFrom, locale) })}</span>
        <button type="button" onClick={onRemove} className="ml-auto text-xs text-red-600 dark:text-red-400 hover:underline">
          {t("removeVersion")}
        </button>
      </div>

      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-gray-500 dark:text-gray-400">
            <th className="font-normal pb-1">{t("line")}</th>
            <th className="font-normal pb-1">{t("pays")}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
          {tiers.map((tier) => (
            <tr key={tier.id ?? tier.name}>
              <td className="py-1.5 pr-3">
                <span className="font-medium dark:text-gray-100">{tier.name}</span>
                <span className="block text-xs text-gray-500 dark:text-gray-400">{t("perGlass")}</span>
              </td>
              <td className="py-1.5">
                <RateInput rate={version.tiers?.[tier.name]} onChange={(r) => setTier(tier.name, r)} />
              </td>
            </tr>
          ))}
          <tr>
            <td className="py-1.5 pr-3">
              <span className="font-medium dark:text-gray-100">{t("noTier")}</span>
              <span className="block text-xs text-gray-500 dark:text-gray-400">{t("noTierHint")}</span>
            </td>
            <td className="py-1.5">
              <RateInput rate={version.noTier} onChange={(r) => set({ noTier: r })} />
            </td>
          </tr>
          <tr>
            <td className="py-1.5 pr-3">
              <span className="font-medium dark:text-gray-100">{t("services")}</span>
              <span className="block text-xs text-gray-500 dark:text-gray-400">{t("servicesHint")}</span>
            </td>
            <td className="py-1.5">
              <RateInput rate={version.services} onChange={(r) => set({ services: r })} />
            </td>
          </tr>
          <tr>
            <td className="py-1.5 pr-3">
              <span className="font-medium dark:text-gray-100">{t("lead")}</span>
              <span className="block text-xs text-gray-500 dark:text-gray-400">{t("leadHint")}</span>
            </td>
            <td className="py-1.5">
              <div className="flex items-center gap-2">
                <span className="text-sm text-gray-500 w-[46px] text-center">$</span>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={version.lead?.value ?? 0}
                  onChange={(e) => set({ lead: { value: e.target.value === "" ? 0 : Number(e.target.value) } })}
                  className={`${inputCls} w-24 text-right tabular-nums`}
                />
              </div>
            </td>
          </tr>
        </tbody>
      </table>
      <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">{t("percentHint")}</p>
      <GoalsEditor goals={version.goals || []} onChange={(goals) => set({ goals })} t={t} />
    </div>
  );
}

// Metas del bono semanal: "si hace N trabajos cobrados en la semana, gana $X". Se paga solo el
// escalón más alto que alcance.
function GoalsEditor({ goals, onChange, t }) {
  const setAt = (i, patch) => onChange(goals.map((g, j) => (j === i ? { ...g, ...patch } : g)));
  const add = () => {
    const last = goals[goals.length - 1];
    onChange([...goals, { jobs: last ? Number(last.jobs || 0) + 10 : 10, bonus: 0 }]);
  };
  return (
    <div className="mt-4 border-t border-gray-100 dark:border-gray-800 pt-3">
      <h4 className="text-sm font-medium dark:text-gray-100">{t("goalsTitle")}</h4>
      <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">{t("goalsHint")}</p>
      {goals.length === 0 && <p className="text-xs text-gray-500 dark:text-gray-400 italic mb-2">{t("noGoals")}</p>}
      <div className="space-y-2">
        {goals.map((g, i) => (
          <div key={i} className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-gray-600 dark:text-gray-300">{t("goalIf")}</span>
            <input
              type="number"
              min="1"
              step="1"
              value={g.jobs}
              onChange={(e) => setAt(i, { jobs: e.target.value === "" ? "" : Number(e.target.value) })}
              className={`${inputCls} w-20 text-right tabular-nums`}
            />
            <span className="text-gray-600 dark:text-gray-300">{t("goalJobs")}</span>
            <span className="text-gray-500">$</span>
            <input
              type="number"
              min="0"
              step="0.01"
              value={g.bonus}
              onChange={(e) => setAt(i, { bonus: e.target.value === "" ? "" : Number(e.target.value) })}
              className={`${inputCls} w-24 text-right tabular-nums`}
            />
            <button type="button" onClick={() => onChange(goals.filter((_, j) => j !== i))} className="text-xs text-red-600 dark:text-red-400 hover:underline">
              {t("removeGoal")}
            </button>
          </div>
        ))}
      </div>
      <button type="button" onClick={add} className="mt-2 text-xs text-blue-600 dark:text-blue-400 hover:underline">
        + {t("addGoal")}
      </button>
    </div>
  );
}

export default function CommissionPlanEditor({ versions, onChange, locale = "es" }) {
  const t = useTranslations("commissionPlan");
  const [tiers, setTiers] = useState([]);

  useEffect(() => {
    getPriceTiers().then(setTiers).catch(() => setTiers([]));
  }, []);

  const list = Array.isArray(versions) ? [...versions].sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom)) : [];
  const cur = currentIndex(list);
  const statusOf = (i) => (i === cur ? "current" : i > cur ? "future" : "past");

  function update(i, v) {
    const next = [...list];
    next[i] = v;
    onChange(next);
  }

  function remove(i) {
    if (!confirm(t("confirmRemove"))) return;
    onChange(list.filter((_, j) => j !== i));
  }

  // Una versión nueva arranca copiando la más reciente: casi siempre se cambia una cifra, no todas.
  function addVersion() {
    const base = list[list.length - 1];
    let fecha = tomorrow();
    if (base && base.effectiveFrom >= fecha) {
      const d = new Date(`${base.effectiveFrom}T12:00:00`);
      d.setDate(d.getDate() + 1);
      fecha = d.toISOString().slice(0, 10);
    }
    const nueva = base
      ? { ...JSON.parse(JSON.stringify(base)), id: undefined, createdAt: undefined, createdBy: undefined, effectiveFrom: fecha }
      : emptyVersion(fecha);
    onChange([...list, nueva]);
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-gray-600 dark:text-gray-300">{t("explainer")}</p>
      {list.length === 0 && <p className="text-sm text-gray-500 dark:text-gray-400 italic">{t("noVersions")}</p>}
      {/* La más nueva arriba: es la que se viene a cambiar. */}
      {list
        .map((v, i) => ({ v, i }))
        .reverse()
        .map(({ v, i }) => (
          <VersionCard
            key={v.id || `new-${i}`}
            version={v}
            status={statusOf(i)}
            tiers={tiers}
            locale={locale}
            t={t}
            onChange={(nv) => update(i, nv)}
            onRemove={() => remove(i)}
          />
        ))}
      <button type="button" onClick={addVersion} className="text-sm text-blue-600 dark:text-blue-400 border border-blue-200 dark:border-blue-900 rounded-lg px-3 py-1.5 hover:bg-blue-50 dark:hover:bg-blue-950">
        + {list.length ? t("addVersion") : t("createPlan")}
      </button>
    </div>
  );
}
