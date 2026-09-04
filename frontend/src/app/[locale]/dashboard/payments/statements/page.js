"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { money } from "@/components/OrderSummaryUI";
import StatementImport from "@/components/StatementImport";
import { getStatementLines, getStatements, getStatementsByDistributor, getStatementsSummary, getUndecidedStatementLines } from "@/lib/api";
import { Link } from "@/i18n/navigation";

// Cuánto le debemos al distribuidor, hoy.
//
// Los statements se registran cuando LLEGAN. Con 60 días de crédito en Mygrant, una factura vive
// dos meses antes de tocar un pago: antes de esta pantalla ese periodo era ciego, porque las
// facturas solo existían dentro del pago que ya las había saldado.
//
// Un memo de crédito pendiente es, literalmente, una nota de crédito que el distribuidor ya
// emitió y que todavía no se descuenta de ningún pago — por eso resta del saldo.

const FILTROS = ["pending", "overdue", "credits", "undecided", "all"];

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
  // Cuántas filas pedir. Empieza en 300 y crece con "Ver más"; el servidor admite hasta 1,000.
  // Antes el tope era fijo y la lista se quedaba en "300 de 757" sin forma de ver el resto.
  const [limite, setLimite] = useState(300);
  const [datos, setDatos] = useState({ statements: [], total: 0, balance: 0 });
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState("");
  // El desglose por renglón de cada statement, cargado al abrirlo. null = cargando; [] = el
  // statement no trae detalle (los históricos entraron como cabecera sola).
  const [abierto, setAbierto] = useState(null);
  const [renglones, setRenglones] = useState({});

  function alternarDetalle(id) {
    if (abierto === id) return setAbierto(null);
    setAbierto(id);
    if (renglones[id] === undefined) {
      setRenglones((prev) => ({ ...prev, [id]: null }));
      getStatementLines(id)
        .then((r) => setRenglones((prev) => ({ ...prev, [id]: r.lines || [] })))
        .catch(() => setRenglones((prev) => ({ ...prev, [id]: [] })));
    }
  }

  // La lista de trabajo: renglones sin salida, de todos los statements a la vez.
  const [porDecidir, setPorDecidir] = useState([]);

  const cargar = useCallback(async () => {
    setCargando(true);
    setError("");
    try {
      if (filtro === "undecided") {
        const [lista, resumen] = await Promise.all([getUndecidedStatementLines(), getStatementsSummary()]);
        setPorDecidir(
          busqueda
            ? (lista.lines || []).filter((l) =>
                [l.partNumber, l.reqNo, l.invoiceNumber, l.customerName].some((v) =>
                  String(v || "").toLowerCase().includes(busqueda.toLowerCase())
                )
              )
            : lista.lines || []
        );
        setSummary(resumen);
        setCargando(false);
        return;
      }
      const params = { search: busqueda, limit: limite };
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
  }, [filtro, busqueda, limite, t]);

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

      {/* La lista de trabajo: cada renglón sin salida, con su statement y su pago de origen.
          Es la misma fila roja de los desgloses, pero junta — para decidir 1×1 sin ir
          statement por statement. */}
      {filtro === "undecided" && (
        <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800">
          <table className="w-full min-w-[760px] text-sm">
            <thead>
              <tr className="border-b border-gray-200 text-left text-xs uppercase tracking-wide text-gray-500 dark:border-gray-700 dark:text-gray-400">
                <th className="px-4 py-2.5">{t("lines.req")}</th>
                <th className="px-4 py-2.5">{t("lines.part")}</th>
                <th className="px-4 py-2.5">{t("col.issued")}</th>
                <th className="px-4 py-2.5">{t("col.invoice")}</th>
                <th className="px-4 py-2.5">{t("col.distributor")}</th>
                <th className="px-4 py-2.5">{t("undecidedPaidIn")}</th>
                <th className="px-4 py-2.5 text-right">{t("col.amount")}</th>
                <th className="px-4 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {cargando && (
                <tr><td colSpan={8} className="px-4 py-8 text-center text-gray-500 dark:text-gray-400">{t("loading")}</td></tr>
              )}
              {!cargando && porDecidir.length === 0 && (
                <tr><td colSpan={8} className="px-4 py-8 text-center text-gray-500 dark:text-gray-400">{t("undecidedEmpty")}</td></tr>
              )}
              {!cargando && porDecidir.map((l) => (
                <tr key={l.id} className="border-b border-gray-100 last:border-0 dark:border-gray-700">
                  <td className="px-4 py-2 font-mono text-xs text-gray-500 dark:text-gray-400">{l.reqNo || "—"}</td>
                  <td className="px-4 py-2 font-mono text-xs dark:text-gray-200">{l.partNumber || "—"}</td>
                  <td className="px-4 py-2 tabular-nums text-xs text-gray-500 dark:text-gray-400">{l.date || "—"}</td>
                  <td className="px-4 py-2 font-mono text-xs text-gray-500 dark:text-gray-400">{l.invoiceNumber}</td>
                  <td className="px-4 py-2 text-xs dark:text-gray-300">
                    {l.distributor}
                    {l.branch && <span className="block text-[11px] text-gray-400">{l.branch}</span>}
                  </td>
                  <td className="px-4 py-2 text-xs text-gray-500 dark:text-gray-400">{l.paymentNumber || t(`status.${l.statementStatus}`)}</td>
                  <td className="px-4 py-2 text-right tabular-nums dark:text-gray-100">{money(l.amount)}</td>
                  <td className="px-4 py-2 text-right">
                    {/* Aplicar = abrir la nota de débito con todo lo que el statement ya sabe
                        (parte, requisición, monto, fecha, sucursal, y el pago donde nació si el
                        statement ya se pagó). Solo queda elegir el destino: técnico o compañía. */}
                    <Link
                      href={`/dashboard/payments/debit-notes/create?entityType=DISTRIBUTOR&entityName=${encodeURIComponent(l.distributor || "")}&partNumber=${encodeURIComponent(l.partNumber || "")}&invoiceNumber=${encodeURIComponent(l.reqNo || "")}&amount=${encodeURIComponent(l.amount)}&issueDate=${encodeURIComponent(l.date || "")}${l.payoutId ? `&payment=${l.payoutId}` : ""}`}
                      className="whitespace-nowrap text-xs font-medium text-blue-600 hover:underline dark:text-blue-400"
                    >
                      {t("applyLine")} →
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
            {!cargando && porDecidir.length > 0 && (
              <tfoot>
                <tr className="border-t border-gray-200 bg-gray-50 font-medium dark:border-gray-700 dark:bg-gray-900">
                  <td colSpan={6} className="px-4 py-2.5 dark:text-gray-200">{t("lines.total", { count: porDecidir.length })}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums dark:text-gray-100">
                    {money(porDecidir.reduce((a, l) => a + Number(l.amount || 0), 0))}
                  </td>
                  <td />
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      )}

      {filtro !== "undecided" && (
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
                  <StatementRow
                    key={s.id}
                    s={s}
                    vencido={vencido}
                    abierto={abierto === s.id}
                    lineas={renglones[s.id]}
                    onToggle={() => alternarDetalle(s.id)}
                    t={t}
                  />
                );
              })}
          </tbody>
          {!cargando && datos.statements.length > 0 && (
            <tfoot>
              <tr className="border-t border-gray-200 bg-gray-50 font-medium dark:border-gray-700 dark:bg-gray-900">
                <td className="px-4 py-2.5 dark:text-gray-200" colSpan={5}>
                  {t("rowsShown", { shown: datos.statements.length, total: datos.total })}
                  {datos.statements.length < datos.total && (
                    <span className="ml-3 inline-flex gap-3 font-normal">
                      <button type="button" onClick={() => setLimite((n) => Math.min(n + 300, 1000))} className="text-xs text-blue-600 hover:underline dark:text-blue-400">
                        {t("showMore")}
                      </button>
                      <button type="button" onClick={() => setLimite(Math.min(datos.total, 1000))} className="text-xs text-blue-600 hover:underline dark:text-blue-400">
                        {t("showAll", { total: Math.min(datos.total, 1000) })}
                      </button>
                    </span>
                  )}
                </td>
                <td className="px-4 py-2.5 text-right tabular-nums dark:text-gray-100">{money(datos.balance)}</td>
                <td />
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      )}
    </div>
  );
}

// La clasificación de cada renglón, con el color que le corresponde en el ciclo.
const CLASE_RENGLON = {
  INSTALLED: { tone: "text-gray-600 dark:text-gray-300" },
  RETURNED: { tone: "text-amber-600 dark:text-amber-400" },
  CREDIT: { tone: "text-emerald-600 dark:text-emerald-400" },
  ACCESSORY: { tone: "text-gray-400 dark:text-gray-500" },
  UNDECIDED: { tone: "text-red-600 dark:text-red-400" },
  // Cobrada al tecnico: la parte SI tiene destino — su nota de debito — y por eso no puede
  // seguir pintada como pendiente. Morado, el mismo tono con que las notas marcan al tecnico.
  CHARGED: { tone: "text-purple-600 dark:text-purple-400" },
  // Perdida asumida: la pieza no fue a ningun trabajo, no se devolvio y no se le cobra a nadie.
  // Gris, como todo lo que ya no espera nada.
  LOSS: { tone: "text-gray-500 dark:text-gray-400" },
};

function StatementRow({ s, vencido, abierto, lineas, onToggle, t }) {
  return (
    <>
      <tr
        onClick={onToggle}
        className="cursor-pointer border-b border-gray-100 last:border-0 hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800/60"
      >
                    <td className="px-4 py-2.5 font-mono text-xs dark:text-gray-200">
                      <span className="mr-1.5 inline-block w-3 text-gray-400">{abierto ? "▾" : "▸"}</span>
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

      {/* Por qué salió este statement en la búsqueda. Si buscaste una parte, una requisición o
          una orden, la respuesta útil no es la factura sino EL RENGLÓN: se muestra aquí mismo,
          sin abrir nada. */}
      {!abierto && (s.matchedLines || []).length > 0 && (
        <tr className="border-b border-gray-100 bg-amber-50/50 dark:border-gray-700 dark:bg-amber-950/20">
          <td colSpan={7} className="px-4 py-2">
            {s.matchedLines.map((l, i) => (
              <div key={i} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-0.5 text-xs">
                <span className="font-mono text-gray-500 dark:text-gray-400">{l.reqNo}</span>
                <span className="font-medium dark:text-gray-200">{l.partNumber}</span>
                <span className="tabular-nums dark:text-gray-300">{money(l.amount)}</span>
                {l.customerName && <span className="text-gray-500 dark:text-gray-400">{l.customerName}</span>}
                {l.workOrderNo && (
                  l.workOrderId ? (
                    <Link
                      href={`/dashboard/workorders/${l.workOrderId}`}
                      target="_blank"
                      onClick={(e) => e.stopPropagation()}
                      className="text-blue-600 hover:underline dark:text-blue-400"
                    >
                      {l.workOrderNo}
                    </Link>
                  ) : (
                    <span className="font-mono">{l.workOrderNo}</span>
                  )
                )}
                <span className={(CLASE_RENGLON[l.classification] || CLASE_RENGLON.UNDECIDED).tone}>
                  {t(`lines.class.${l.classification}`)}
                </span>
              </div>
            ))}
          </td>
        </tr>
      )}

      {/* El desglose del statement: cada parte con su salida — la orden donde se instaló, la
          nota que generó, o la marca de que sigue sin decidir. */}
      {abierto && (
        <tr className="border-b border-gray-100 bg-gray-50/60 dark:border-gray-700 dark:bg-gray-900/40">
          <td colSpan={7} className="px-4 py-3">
            {lineas == null && <p className="text-xs text-gray-500 dark:text-gray-400">{t("lines.loading")}</p>}
            {Array.isArray(lineas) && lineas.length === 0 && (
              <p className="text-xs text-gray-500 dark:text-gray-400">{t("lines.none")}</p>
            )}
            {Array.isArray(lineas) && lineas.length > 0 && (
              <table className="w-full text-xs">
                <thead className="text-[10px] uppercase tracking-wide text-gray-400 dark:text-gray-500">
                  <tr>
                    <th className="py-1 pr-3 text-left">{t("lines.req")}</th>
                    {/* La fecha de CADA renglon. Un statement semanal junta compras de varios dias,
                        y sin ella no se puede cotejar contra el trabajo ni contra otra compra de la
                        misma parte (pedido de Antonio, 4-sep-2026). */}
                    <th className="py-1 pr-3 text-left">{t("lines.date")}</th>
                    <th className="py-1 pr-3 text-left">{t("lines.part")}</th>
                    <th className="py-1 pr-3 text-left">{t("lines.customer")}</th>
                    <th className="py-1 pr-3 text-right">{t("col.amount")}</th>
                    <th className="py-1 text-left">{t("lines.outcome")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                  {lineas.map((l) => {
                    const clase = CLASE_RENGLON[l.classification] || CLASE_RENGLON.UNDECIDED;
                    return (
                      <tr key={l.id}>
                        <td className="py-1.5 pr-3 font-mono text-gray-500 dark:text-gray-400">{l.reqNo || "—"}</td>
                        <td className="py-1.5 pr-3 tabular-nums text-gray-500 dark:text-gray-400">{l.date || "—"}</td>
                        <td className="py-1.5 pr-3 font-mono dark:text-gray-200">{l.partNumber || "—"}</td>
                        <td className="py-1.5 pr-3 text-gray-500 dark:text-gray-400">{l.customerName || "—"}</td>
                        <td className="py-1.5 pr-3 text-right tabular-nums dark:text-gray-200">{money(l.amount)}</td>
                        <td className={`py-1.5 ${clase.tone}`}>
                          {t(`lines.class.${l.classification}`)}
                          {l.workOrderNo && (
                            <>
                              {" · "}
                              {l.workOrderId ? (
                                <Link
                                  href={`/dashboard/workorders/${l.workOrderId}`}
                                  target="_blank"
                                  onClick={(e) => e.stopPropagation()}
                                  className="text-blue-600 hover:underline dark:text-blue-400"
                                >
                                  {l.workOrderNo}
                                </Link>
                              ) : (
                                <span className="font-mono">{l.workOrderNo}</span>
                              )}
                            </>
                          )}
                          {l.noteNumber && <span className="ml-1 font-mono">· {l.noteNumber}</span>}
                          {l.relatedRef && (
                            <span className="ml-1 text-gray-400 dark:text-gray-500">
                              {t("lines.relatedRef", { ref: l.relatedRef })}
                            </span>
                          )}
                          {/* Dónde acabó la devolución. "Devuelta" a secas obliga a ir a buscar el memo
                              a mano; con esto la respuesta viaja con el renglón. Si el crédito todavía
                              no llega, se dice también — es dinero que el distribuidor aún debe. */}
                          {l.classification === "RETURNED" && (
                            <span className="ml-1 text-gray-400 dark:text-gray-500">
                              {l.creditedIn
                                ? t("lines.creditedIn", { ref: l.creditedBy, memo: l.creditedIn })
                                : t("lines.awaitingCredit")}
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="border-t border-gray-200 dark:border-gray-700">
                    <td colSpan={3} className="py-1.5 pr-3 text-gray-500 dark:text-gray-400">
                      {t("lines.total", { count: lineas.length })}
                    </td>
                    <td className="py-1.5 pr-3 text-right font-medium tabular-nums dark:text-gray-100">
                      {money(lineas.reduce((a, l) => a + Number(l.amount || 0), 0))}
                    </td>
                    <td />
                  </tr>
                </tfoot>
              </table>
            )}
          </td>
        </tr>
      )}
    </>
  );
}
