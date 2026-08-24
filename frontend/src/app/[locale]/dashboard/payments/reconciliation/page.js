"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { getReconciliation, resolveReconciliationItem, reopenReconciliationItem, getTechnicians } from "@/lib/api";
import { money } from "@/components/OrderSummaryUI";

// La bandeja de conciliacion: partes que la factura del distribuidor cobro y que todavia no tienen
// destino, la mas vieja primero.
//
// Clasificar no saca una fila de aca. "Se le cobra al tecnico" la deja visible hasta que el cobro
// entre en un pago, porque asignar sin cobrar es exactamente como se acumularon 39 partes por
// $5,537.77 que nadie pago nunca.

const SALIDAS = [
  { key: "INSTALLED", tone: "ok" },
  { key: "TECH", tone: "ok" },
  { key: "RETURNED", tone: "ok" },
  { key: "LOSS", tone: "warn" },
];

const inputClass =
  "w-full border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-shadow";

// La antiguedad es el dato que decide el orden de trabajo, asi que se codifica en forma y no solo
// en numero: a mas vieja, mas fuerte se ve.
function edad(dias) {
  if (dias == null) return { txt: "—", cls: "text-gray-400" };
  if (dias > 365) return { txt: `${Math.floor(dias / 365)}a ${Math.floor((dias % 365) / 30)}m`, cls: "text-red-700 dark:text-red-400 font-semibold" };
  if (dias > 180) return { txt: `${Math.floor(dias / 30)} m`, cls: "text-amber-700 dark:text-amber-500 font-medium" };
  return { txt: `${Math.floor(dias / 30)} m`, cls: "text-gray-500 dark:text-gray-400" };
}

export default function ReconciliationPage() {
  const t = useTranslations("reconciliation");
  const tc = useTranslations("common");

  const [summary, setSummary] = useState(null);
  const [items, setItems] = useState([]);
  const [soloSinClasificar, setSoloSinClasificar] = useState(false);
  const [abierta, setAbierta] = useState(null);
  const [salida, setSalida] = useState("");
  const [wo, setWo] = useState("");
  const [tecnico, setTecnico] = useState("");
  const [tecnicos, setTecnicos] = useState([]);
  const [error, setError] = useState("");
  const [guardando, setGuardando] = useState(false);

  const cargar = useCallback(() => {
    getReconciliation({ untriaged: soloSinClasificar })
      .then((r) => { setSummary(r.summary); setItems(r.items || []); })
      .catch((e) => setError(e.message));
  }, [soloSinClasificar]);

  useEffect(() => { cargar(); }, [cargar]);
  useEffect(() => { getTechnicians().then(setTecnicos).catch(() => {}); }, []);

  function abrir(n) {
    setAbierta(n.id === abierta ? null : n.id);
    setSalida(n.resolution || "");
    setWo(n.resolutionWorkOrderNo || "");
    setTecnico(n.technician || "");
    setError("");
  }

  async function resolver(n) {
    if (!salida || guardando) return;
    setGuardando(true);
    setError("");
    try {
      await resolveReconciliationItem(n.id, { resolution: salida, workOrderNo: wo, technician: tecnico });
      setAbierta(null);
      cargar();
    } catch (e) {
      setError(e.message);
    } finally {
      setGuardando(false);
    }
  }

  async function reabrir(n) {
    try {
      await reopenReconciliationItem(n.id);
      setAbierta(null);
      cargar();
    } catch (e) {
      setError(e.message);
    }
  }

  return (
    <div>
      <div className="mb-1">
        <h1 className="text-2xl font-semibold dark:text-gray-100 tracking-tight">{t("title")}</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400">{t("subtitle")}</p>
      </div>

      {summary && (
        <div className="grid gap-3 my-5" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))" }}>
          <Cifra n={money(summary.openAmount)} d={t("stat.open", { count: summary.openCount })} tono="risk" />
          <Cifra n={money(summary.overOneYearAmount)} d={t("stat.aged", { count: summary.overOneYearCount })} tono="risk" />
          <Cifra n={money(summary.assignedUnchargedAmount)} d={t("stat.assigned", { count: summary.assignedUnchargedCount })} tono="warn" />
          <Cifra n={String(summary.untriagedCount)} d={t("stat.untriaged")} />
        </div>
      )}

      {error && <p className="text-sm text-red-600 dark:text-red-400 mb-3">{error}</p>}

      <label className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300 mb-3">
        <input type="checkbox" checked={soloSinClasificar} onChange={(e) => setSoloSinClasificar(e.target.checked)} />
        {t("onlyUntriaged")}
      </label>

      <div className="bg-white dark:bg-gray-900 dark:border dark:border-gray-800 rounded-xl shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm" style={{ minWidth: 760 }}>
            <thead>
              <tr className="text-left border-b dark:border-gray-800 text-xs text-gray-400 uppercase">
                <th className="p-3">{t("note")}</th>
                <th className="p-3">{t("distributor")}</th>
                <th className="p-3">{t("part")}</th>
                <th className="p-3">{t("age")}</th>
                <th className="p-3">{t("state")}</th>
                <th className="p-3 text-right">{tc("amount")}</th>
                <th className="p-3"></th>
              </tr>
            </thead>
            <tbody>
              {items.map((n) => {
                const e = edad(n.ageDays);
                const asignada = n.resolution === "TECH";
                return (
                  <FilaGrupo key={n.id}>
                    <tr className="border-b dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800/60 transition-colors">
                      <td className="p-3 font-medium">{n.noteNumber || `#${n.id}`}</td>
                      <td className="p-3">{n.entityName || "—"}</td>
                      <td className="p-3 text-gray-500 font-mono text-xs">{n.partNumber || "—"}</td>
                      <td className={`p-3 ${e.cls}`}>{e.txt}</td>
                      <td className="p-3">
                        {asignada ? (
                          <span className="inline-block text-[11px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-400">
                            {t("assignedTo", { who: n.technician || "?" })}
                          </span>
                        ) : (
                          <span className="inline-block text-[11px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400">
                            {t("untriaged")}
                          </span>
                        )}
                      </td>
                      <td className="p-3 text-right tabular-nums font-medium">{money(n.amount)}</td>
                      <td className="p-3 text-right">
                        <button type="button" onClick={() => abrir(n)} className="text-blue-600 text-xs">
                          {abierta === n.id ? tc("cancel") : t("resolve")}
                        </button>
                      </td>
                    </tr>
                    {abierta === n.id && (
                      <tr className="border-b dark:border-gray-800 bg-gray-50 dark:bg-gray-800/40">
                        <td colSpan={7} className="p-4">
                          <div className="text-xs text-gray-500 dark:text-gray-400 mb-2">{t("chooseOutcome")}</div>
                          <div className="flex flex-wrap gap-2 mb-3">
                            {SALIDAS.map((s) => (
                              <button
                                key={s.key} type="button" onClick={() => setSalida(s.key)}
                                className={`rounded-lg px-3 py-1.5 text-sm border transition-colors ${
                                  salida === s.key
                                    ? "bg-gray-900 dark:bg-blue-600 text-white border-transparent"
                                    : "border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-white dark:hover:bg-gray-800"
                                }`}
                              >
                                {t(`outcome.${s.key}`)}
                              </button>
                            ))}
                          </div>

                          {salida === "INSTALLED" && (
                            <div className="mb-3 max-w-xs">
                              <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">{t("workOrder")}</label>
                              <input value={wo} onChange={(e2) => setWo(e2.target.value)} placeholder="Wo-0000" className={inputClass} />
                            </div>
                          )}
                          {salida === "TECH" && (
                            <div className="mb-3 max-w-xs">
                              <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">{t("technician")}</label>
                              <select value={tecnico} onChange={(e2) => setTecnico(e2.target.value)} className={inputClass}>
                                <option value="">{t("selectTechnician")}</option>
                                {tecnicos.map((x) => <option key={x.id} value={x.name}>{x.name}</option>)}
                              </select>
                            </div>
                          )}

                          <p className="text-xs text-gray-500 dark:text-gray-400 mb-3 max-w-2xl">
                            {salida ? t(`explain.${salida}`) : t("explainNone")}
                          </p>

                          <div className="flex gap-2">
                            <button
                              type="button" onClick={() => resolver(n)} disabled={!salida || guardando}
                              className="bg-gray-900 hover:bg-gray-800 dark:bg-blue-600 dark:hover:bg-blue-700 text-white rounded-lg px-4 py-2 text-sm disabled:opacity-40"
                            >
                              {guardando ? tc("saving") : t("confirm")}
                            </button>
                            {asignada && (
                              <button type="button" onClick={() => reabrir(n)} className="border border-gray-200 dark:border-gray-700 rounded-lg px-4 py-2 text-sm text-gray-600 dark:text-gray-300">
                                {t("reopen")}
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                  </FilaGrupo>
                );
              })}
              {items.length === 0 && (
                <tr><td colSpan={7} className="p-6 text-center text-gray-500">{t("empty")}</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <p className="text-xs text-gray-400 dark:text-gray-500 mt-3 max-w-3xl">{t("footnote")}</p>
    </div>
  );
}

function FilaGrupo({ children }) {
  return <>{children}</>;
}

function Cifra({ n, d, tono }) {
  const color = tono === "risk" ? "text-red-700 dark:text-red-400"
    : tono === "warn" ? "text-amber-700 dark:text-amber-500"
    : "dark:text-gray-100";
  return (
    <div className="bg-white dark:bg-gray-900 dark:border dark:border-gray-800 rounded-xl shadow-sm p-4">
      <div className={`text-2xl font-semibold tabular-nums tracking-tight ${color}`}>{n}</div>
      <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">{d}</div>
    </div>
  );
}
