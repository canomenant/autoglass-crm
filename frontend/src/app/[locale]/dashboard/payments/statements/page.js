"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { money } from "@/components/OrderSummaryUI";
import StatementImport from "@/components/StatementImport";
import { getStatements, getStatementsByDistributor, getStatementsSummary } from "@/lib/api";

// Cuánto le debemos al distribuidor, hoy.
//
// Los statements se registran cuando LLEGAN. Con 60 días de crédito en Mygrant, una factura vive
// dos meses antes de tocar un pago: antes de esta pantalla ese periodo era ciego, porque las
// facturas solo existían dentro del pago que ya las había saldado.
//
// Un memo de crédito pendiente es, literalmente, una nota de crédito que el distribuidor ya
// emitió y que todavía no se descuenta de ningún pago — por eso resta del saldo.

const FILTROS = ["pending", "overdue", "credits", "all"];

function Tarjeta({ etiqueta, monto, detalle, tono = "normal" }) {
  const tonos = {
    normal: "text-gray-900 dark:text-gray-100",
    alerta: "text-red-600 dark:text-red-400",
    aviso: "text-amber-600 dark:text-amber-400",
    bueno: "text-emerald-600 dark:text-emerald-400",
  };
  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4">
      <div className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">{etiqueta}</div>
      <div className={`mt-1 text-2xl font-semibold tabular-nums ${tonos[tono]}`}>{monto}</div>
      {detalle && <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">{detalle}</div>}
    </div>
  );
}

export default function StatementsPage() {
  const t = useTranslations("statements");
  const [summary, setSummary] = useState(null);
  const [porDistribuidor, setPorDistribuidor] = useState([]);
  const [filtro, setFiltro] = useState("pending");
  const [busqueda, setBusqueda] = useState("");
  const [datos, setDatos] = useState({ statements: [], total: 0, balance: 0 });
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState("");

  const cargar = useCallback(async () => {
    setCargando(true);
    setError("");
    try {
      const params = { search: busqueda, limit: 300 };
      if (filtro === "pending" || filtro === "overdue") params.pending = "true";
      if (filtro === "credits") params.kind = "CREDIT_MEMO";
      const [lista, resumen, dist] = await Promise.all([
        getStatements(params),
        getStatementsSummary(),
        getStatementsByDistributor(),
      ]);
      // "Vencido" se decide con los días de atraso que ya calcula el servidor.
      const filtrados = filtro === "overdue"
        ? { ...lista, statements: lista.statements.filter((s) => (s.daysOverdue ?? -1) > 0) }
        : lista;
      setDatos(filtrados);
      setSummary(resumen);
      setPorDistribuidor(dist.distributors || []);
    } catch (err) {
      setError(err.message || t("loadError"));
    } finally {
      setCargando(false);
    }
  }, [filtro, busqueda, t]);

  useEffect(() => {
    const id = setTimeout(cargar, busqueda ? 300 : 0);
    return () => clearTimeout(id);
  }, [cargar, busqueda]);

  const v = summary?.vencimiento;
  const n = summary?.notas;

  return (
    <div>
      <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-2xl font-semibold tracking-tight dark:text-gray-100">{t("pageTitle")}</h1>
        {summary && (
          <span className="text-sm text-gray-500 dark:text-gray-400">
            {t("netOwed", { amount: money(summary.neto) })}
          </span>
        )}
      </div>
      <p className="mb-4 max-w-2xl text-sm text-gray-500 dark:text-gray-400">{t("intro")}</p>

      {/* Subir el statement que acaba de llegar. Se lee primero y se guarda después. */}
      <div className="mb-5">
        <StatementImport onImported={cargar} />
      </div>

      {summary && (
        <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Tarjeta
            etiqueta={t("card.toPay")}
            monto={money(summary.porPagar.monto)}
            detalle={t("card.statementsCount", { count: summary.porPagar.statements })}
          />
          <Tarjeta
            etiqueta={t("card.creditsPending")}
            monto={money(summary.creditosPorAplicar.monto)}
            detalle={t("card.memosCount", { count: summary.creditosPorAplicar.statements })}
            tono="bueno"
          />
          <Tarjeta
            etiqueta={t("card.overdue")}
            monto={money(v.vencido.monto)}
            detalle={
              v.masVieja
                ? t("card.oldestSince", { date: v.masVieja, count: v.vencido.statements })
                : t("card.nothingOverdue")
            }
            tono={v.vencido.statements ? "alerta" : "normal"}
          />
          <Tarjeta
            etiqueta={t("card.openNotes")}
            monto={money(n.debitosAbiertos.monto)}
            detalle={t("card.notesDetail", {
              debits: n.debitosAbiertos.notas,
              credits: n.creditoPorRecibir.notas,
              amount: money(n.creditoPorRecibir.monto),
            })}
            tono={n.debitosAbiertos.notas ? "aviso" : "normal"}
          />
        </div>
      )}

      {summary && (
        <div className="mb-5 rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
          <div className="mb-3 text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">{t("aging.title")}</div>
          <div className="grid gap-3 sm:grid-cols-3">
            {[
              ["aging.overdue", v.vencido, "text-red-600 dark:text-red-400"],
              ["aging.soon", v.proximo, "text-amber-600 dark:text-amber-400"],
              ["aging.later", v.holgado, "text-gray-700 dark:text-gray-300"],
            ].map(([clave, bloque, color]) => (
              <div key={clave}>
                <div className={`text-lg font-semibold tabular-nums ${color}`}>{money(bloque.monto)}</div>
                <div className="text-xs text-gray-500 dark:text-gray-400">
                  {t(clave)} · {t("card.statementsCount", { count: bloque.statements })}
                </div>
              </div>
            ))}
          </div>
          {porDistribuidor.length > 0 && (
            <div className="mt-4 flex flex-wrap gap-2 border-t border-gray-100 pt-3 dark:border-gray-700">
              {porDistribuidor.map((d) => (
                <span
                  key={d.distributor}
                  className="rounded-lg bg-gray-100 px-2.5 py-1 text-xs text-gray-700 dark:bg-gray-700 dark:text-gray-200"
                >
                  {d.distributor} <span className="ml-1 font-medium tabular-nums">{money(d.balance)}</span>
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="mb-3 flex flex-wrap items-center gap-2">
        {FILTROS.map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setFiltro(f)}
            className={`rounded-lg px-3.5 py-1.5 text-sm transition-colors ${
              filtro === f
                ? "bg-gray-900 text-white dark:bg-blue-600"
                : "border border-gray-200 text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
            }`}
          >
            {t(`filter.${f}`)}
          </button>
        ))}
        <input
          type="search"
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
          placeholder={t("searchPlaceholder")}
          className="ml-auto w-56 rounded-lg border border-gray-200 px-3 py-1.5 text-sm dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
        />
      </div>

      {error && (
        <div className="mb-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
          {error}
        </div>
      )}

      <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800">
        <table className="w-full min-w-[720px] text-sm">
          <thead>
            <tr className="border-b border-gray-200 text-left text-xs uppercase tracking-wide text-gray-500 dark:border-gray-700 dark:text-gray-400">
              <th className="px-4 py-2.5">{t("col.invoice")}</th>
              <th className="px-4 py-2.5">{t("col.distributor")}</th>
              <th className="px-4 py-2.5">{t("col.issued")}</th>
              <th className="px-4 py-2.5">{t("col.due")}</th>
              <th className="px-4 py-2.5 text-right">{t("col.amount")}</th>
              <th className="px-4 py-2.5 text-right">{t("col.balance")}</th>
              <th className="px-4 py-2.5">{t("col.status")}</th>
            </tr>
          </thead>
          <tbody>
            {cargando && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-gray-500 dark:text-gray-400">
                  {t("loading")}
                </td>
              </tr>
            )}
            {!cargando && datos.statements.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-gray-500 dark:text-gray-400">
                  {t("empty")}
                </td>
              </tr>
            )}
            {!cargando &&
              datos.statements.map((s) => {
                const vencido = (s.daysOverdue ?? -1) > 0;
                return (
                  <tr key={s.id} className="border-b border-gray-100 last:border-0 dark:border-gray-700">
                    <td className="px-4 py-2.5 font-mono text-xs dark:text-gray-200">
                      {s.invoiceNumber}
                      {s.isCreditMemo && (
                        <span className="ml-2 rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] uppercase text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300">
                          {t("creditMemo")}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 dark:text-gray-300">
                      {s.distributor}
                      {s.branch && <span className="block text-xs text-gray-400">{s.branch}</span>}
                    </td>
                    <td className="px-4 py-2.5 tabular-nums text-gray-600 dark:text-gray-400">{s.issueDate || "—"}</td>
                    <td className={`px-4 py-2.5 tabular-nums ${vencido ? "text-red-600 dark:text-red-400" : "text-gray-600 dark:text-gray-400"}`}>
                      {s.dueDate || "—"}
                      {vencido && <span className="ml-1 text-xs">({t("daysLate", { days: s.daysOverdue })})</span>}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums dark:text-gray-200">{money(s.amount)}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums font-medium dark:text-gray-100">{money(s.balance)}</td>
                    <td className="px-4 py-2.5">
                      {s.paymentNumber ? (
                        <span className="text-xs text-gray-500 dark:text-gray-400">{s.paymentNumber}</span>
                      ) : (
                        <span
                          className={`rounded px-2 py-0.5 text-xs ${
                            s.status === "paid"
                              ? "bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300"
                              : s.status === "partial"
                              ? "bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300"
                              : "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300"
                          }`}
                        >
                          {t(`status.${s.status}`)}
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
          </tbody>
          {!cargando && datos.statements.length > 0 && (
            <tfoot>
              <tr className="border-t border-gray-200 bg-gray-50 font-medium dark:border-gray-700 dark:bg-gray-900">
                <td className="px-4 py-2.5 dark:text-gray-200" colSpan={5}>
                  {t("rowsShown", { shown: datos.statements.length, total: datos.total })}
                </td>
                <td className="px-4 py-2.5 text-right tabular-nums dark:text-gray-100">{money(datos.balance)}</td>
                <td />
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}
