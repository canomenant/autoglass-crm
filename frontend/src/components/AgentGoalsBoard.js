"use client";

import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { getAgentWeeklyGoals } from "@/lib/api";

// Metas semanales de los agentes (backend lib/agentPlanPayables): cuántos trabajos COBRADOS lleva
// cada uno esta semana (lunes a domingo), qué bono ya ganó y cuántos le faltan para el siguiente.
// El admin ve a todos en una tabla; el agente ve solo lo suyo, en grande, para motivarlo.

function money(n) {
  return `$${Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

function shiftWeek(iso, weeks) {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + weeks * 7);
  return d.toISOString().slice(0, 10);
}

function formatDay(iso, locale) {
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString(locale === "es" ? "es-MX" : "en-US", { day: "numeric", month: "short", timeZone: "UTC" });
}

// Barra de avance con una marca por meta. La escala llega a la meta más alta (o a lo que lleva, si
// ya la pasó).
function ProgressBar({ count, goals, big }) {
  const top = Math.max(count, ...goals.map((g) => g.jobs), 1);
  const pct = Math.min(100, (count / top) * 100);
  return (
    <div className={`relative ${big ? "h-4" : "h-2.5"} rounded-full bg-gray-100 dark:bg-gray-800`}>
      <div className="absolute inset-y-0 left-0 rounded-full bg-blue-600 dark:bg-blue-500 transition-all" style={{ width: `${pct}%` }} />
      {goals.map((g) => (
        <span
          key={g.jobs}
          title={`${g.jobs} → ${money(g.bonus)}`}
          className={`absolute top-1/2 -translate-y-1/2 w-1 ${big ? "h-6" : "h-4"} rounded ${count >= g.jobs ? "bg-green-600" : "bg-gray-400 dark:bg-gray-500"}`}
          style={{ left: `calc(${(g.jobs / top) * 100}% - 2px)` }}
        />
      ))}
    </div>
  );
}

function Status({ row, t }) {
  if (!row.goals.length) return <span className="text-gray-500 dark:text-gray-400">{t("noGoals")}</span>;
  return (
    <span>
      {row.reached ? (
        <span className="text-green-700 dark:text-green-400 font-medium">{t("reached", { jobs: row.reached.jobs, bonus: money(row.reached.bonus) })}</span>
      ) : null}
      {row.reached && row.next ? " · " : null}
      {row.next ? (
        <span className="text-gray-700 dark:text-gray-200">{t("remaining", { count: row.remaining, jobs: row.next.jobs, bonus: money(row.next.bonus) })}</span>
      ) : (
        <span className="text-green-700 dark:text-green-400"> {t("allReached")}</span>
      )}
    </span>
  );
}

export default function AgentGoalsBoard({ mode = "admin" }) {
  const t = useTranslations("agentGoals");
  const locale = useLocale();
  const [date, setDate] = useState(null); // null = esta semana
  const [data, setData] = useState(null);
  const [open, setOpen] = useState(null);

  useEffect(() => {
    getAgentWeeklyGoals(date).then(setData).catch(() => setData(null));
  }, [date]);

  if (!data) return null;
  // Sin metas en ningún plan y sin trabajos cobrados, no hay nada que enseñar.
  if (!data.agents.length && date === null) return null;

  const header = (
    <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
      <div>
        <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-gray-500">{t("title")}</h2>
        <p className="text-sm text-gray-600 dark:text-gray-300">
          {t("week", { from: formatDay(data.weekStart, locale), to: formatDay(data.weekEnd, locale) })}
          {data.closed ? ` · ${t("closed")}` : ` · ${t("daysLeft", { count: data.daysLeft })}`}
        </p>
      </div>
      <div className="flex items-center gap-1 text-sm">
        <button type="button" onClick={() => setDate(shiftWeek(data.weekStart, -1))} className="px-2 py-1 rounded hover:bg-gray-100 dark:hover:bg-gray-800" aria-label={t("previous")}>‹</button>
        {date !== null && (
          <button type="button" onClick={() => setDate(null)} className="px-2 py-1 rounded text-blue-600 dark:text-blue-400 hover:bg-gray-100 dark:hover:bg-gray-800">{t("thisWeek")}</button>
        )}
        <button type="button" onClick={() => setDate(shiftWeek(data.weekStart, 1))} disabled={!data.closed} className="px-2 py-1 rounded hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-30" aria-label={t("next")}>›</button>
      </div>
    </div>
  );

  if (mode === "agent") {
    const row = data.agents[0] || { count: 0, goals: [], orders: [], reached: null, next: null, remaining: 0 };
    return (
      <section className="bg-white dark:bg-gray-900 dark:border dark:border-gray-800 rounded-xl shadow-sm p-4 mb-6">
        {header}
        <div className="flex items-baseline gap-2 mb-2">
          <span className="text-4xl font-bold tabular-nums dark:text-gray-100">{row.count}</span>
          <span className="text-sm text-gray-500 dark:text-gray-400">{t("paidJobs")}</span>
        </div>
        {row.goals.length > 0 && <ProgressBar count={row.count} goals={row.goals} big />}
        <p className="text-sm mt-3">
          <Status row={row} t={t} />
        </p>
        {row.goals.length > 0 && (
          <ul className="flex flex-wrap gap-2 mt-3 text-xs">
            {row.goals.map((g) => (
              <li key={g.jobs} className={`rounded-full px-2.5 py-1 ${row.count >= g.jobs ? "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300" : "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300"}`}>
                {t("goalChip", { jobs: g.jobs, bonus: money(g.bonus) })}
              </li>
            ))}
          </ul>
        )}
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-3">{t("rule")}</p>
      </section>
    );
  }

  return (
    <section className="bg-white dark:bg-gray-900 dark:border dark:border-gray-800 rounded-xl shadow-sm p-4 mb-6">
      {header}
      {data.agents.length === 0 ? (
        <p className="text-sm text-gray-500 dark:text-gray-400">{t("empty")}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[560px]">
            <thead>
              <tr className="text-left text-xs text-gray-500 dark:text-gray-400">
                <th className="font-normal pb-2">{t("agent")}</th>
                <th className="font-normal pb-2 text-right pr-3">{t("jobs")}</th>
                <th className="font-normal pb-2 w-1/3">{t("progress")}</th>
                <th className="font-normal pb-2 pl-3">{t("status")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
              {data.agents.map((row) => (
                <FragmentRow key={row.agentId} row={row} t={t} open={open === row.agentId} onToggle={() => setOpen(open === row.agentId ? null : row.agentId)} />
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-xs text-gray-500 dark:text-gray-400 mt-3">{t("rule")}</p>
    </section>
  );
}

function FragmentRow({ row, t, open, onToggle }) {
  return (
    <>
      <tr className="cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800/60" onClick={onToggle}>
        <td className="py-2 font-medium dark:text-gray-100">{row.agentName}</td>
        <td className="py-2 text-right pr-3 tabular-nums font-semibold dark:text-gray-100">{row.count}</td>
        <td className="py-2">{row.goals.length ? <ProgressBar count={row.count} goals={row.goals} /> : null}</td>
        <td className="py-2 pl-3">
          <Status row={row} t={t} />
        </td>
      </tr>
      {open && (
        <tr>
          <td colSpan={4} className="pb-3">
            {row.orders.length === 0 ? (
              <p className="text-xs text-gray-500 dark:text-gray-400">{t("noOrders")}</p>
            ) : (
              <ul className="flex flex-wrap gap-2 text-xs">
                {row.orders.map((o) => (
                  <li key={o.id}>
                    <Link href={`/dashboard/workorders/${o.id}`} className="inline-block rounded bg-gray-100 dark:bg-gray-800 px-2 py-1 text-blue-700 dark:text-blue-300 hover:underline">
                      {o.workOrderNo} · {o.customerName}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </td>
        </tr>
      )}
    </>
  );
}
