"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { getPayments, getPaymentParties, setPaymentReconciled } from "@/lib/api";

function money(n) {
  return `$${Number(n || 0).toFixed(2)}`;
}

// El detalle de pagos a distribuidores, con las columnas de la app vieja de AppSheet
// (BD_PAYMENTDISTRIBUTOR): # de pago, fecha, distribuidor, subtotal, débito, crédito, total y con
// qué tarjeta o método se pagó. Antes esta pantalla sólo agregaba por distribuidor: para conciliar
// contra el extracto de la tarjeta hace falta ver cada cargo, no la suma.
//
// La columna de conciliación es el cotejo con el banco: cada fila se marca cuando su cargo aparece
// en el extracto. La marca escribe al momento (payouts.reconciled_at, con quién la puso) — no hay
// botón de guardar que olvidar a mitad de un estado de cuenta.
export default function DistributorPaymentsReportPage() {
  const t = useTranslations("payments");
  const tc = useTranslations("common");
  const [payments, setPayments] = useState([]);
  const [parties, setParties] = useState([]);
  const [error, setError] = useState("");
  const [savingId, setSavingId] = useState(null);
  const [filters, setFilters] = useState({ party: "", dateFrom: "", dateTo: "", method: "", reconciled: "" });

  useEffect(() => {
    getPayments({ type: "DISTRIBUTOR" }).then(setPayments).catch((e) => setError(e.message));
    getPaymentParties("DISTRIBUTOR").then(setParties).catch(() => {});
  }, []);

  // Los métodos que existen de verdad en los pagos — las tarjetas concretas del histórico
  // ("Business Credit Card ...ending with 0533"), no un catálogo teórico.
  const methodOptions = useMemo(
    () => [...new Set(payments.map((p) => p.paymentMethod).filter(Boolean))].sort(),
    [payments]
  );

  const filtered = useMemo(() => {
    return payments
      .filter((p) => {
        // Un lote puede pagarle a varios distribuidores a la vez (135 de 246 lo hacen), así que
        // filtrar por distribuidor es "lotes donde a X se le pagó algo" — igual que en Payments.
        if (filters.party && !(p.parties || []).includes(filters.party)) return false;
        const date = p.paymentDate || "";
        if (filters.dateFrom && date < filters.dateFrom) return false;
        if (filters.dateTo && date > filters.dateTo) return false;
        if (filters.method && p.paymentMethod !== filters.method) return false;
        if (filters.reconciled === "yes" && !p.reconciledAt) return false;
        if (filters.reconciled === "no" && p.reconciledAt) return false;
        return true;
      })
      .sort((a, b) => (b.paymentDate || "").localeCompare(a.paymentDate || ""));
  }, [payments, filters]);

  const totals = useMemo(() => {
    const sum = (fn) => filtered.reduce((acc, p) => acc + fn(p), 0);
    const reconciled = filtered.filter((p) => p.reconciledAt);
    return {
      subtotal: sum((p) => Number(p.subtotal || 0)),
      debit: sum((p) => Number(p.debitNotesTotal || 0)),
      credit: sum((p) => Number(p.creditNotesTotal || 0)),
      total: sum((p) => Number(p.totalAmount || 0)),
      reconciledCount: reconciled.length,
      reconciledTotal: reconciled.reduce((acc, p) => acc + Number(p.totalAmount || 0), 0),
      pendingCount: filtered.length - reconciled.length,
      pendingTotal: sum((p) => Number(p.totalAmount || 0)) - reconciled.reduce((acc, p) => acc + Number(p.totalAmount || 0), 0),
    };
  }, [filtered]);

  function setFilter(field, value) {
    setFilters((prev) => ({ ...prev, [field]: value }));
  }

  async function toggleReconciled(payment) {
    setSavingId(payment.id);
    setError("");
    try {
      const updated = await setPaymentReconciled(payment.id, !payment.reconciledAt);
      setPayments((prev) => prev.map((p) => (p.id === updated.id ? { ...p, ...updated, parties: p.parties } : p)));
    } catch (e) {
      setError(e.message);
    } finally {
      setSavingId(null);
    }
  }

  const filterClass =
    "border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none";

  return (
    <div className="space-y-6">
      <div>
        <Link href="/dashboard/payments" className="text-sm text-gray-500">← {t("backToPayments")}</Link>
        <h1 className="text-2xl font-semibold dark:text-gray-100 tracking-tight mt-2">{t("distributorReport")}</h1>
      </div>

      {error && <p className="text-red-600 dark:text-red-400 text-sm">{error}</p>}

      <div className="bg-white dark:bg-gray-900 dark:border dark:border-gray-800 rounded-xl shadow-sm p-4 flex flex-wrap items-end gap-4">
        <div>
          <label htmlFor="dist-party" className="block text-xs mb-1 text-gray-500 dark:text-gray-400">{t("distributor")}</label>
          <select id="dist-party" value={filters.party} onChange={(e) => setFilter("party", e.target.value)} className={`${filterClass} min-w-[190px]`}>
            <option value="">{t("allDistributors")}</option>
            {parties.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="dist-from" className="block text-xs mb-1 text-gray-500 dark:text-gray-400">{t("dateFrom")}</label>
          <input id="dist-from" type="date" value={filters.dateFrom} onChange={(e) => setFilter("dateFrom", e.target.value)} className={filterClass} />
        </div>
        <div>
          <label htmlFor="dist-to" className="block text-xs mb-1 text-gray-500 dark:text-gray-400">{t("dateTo")}</label>
          <input id="dist-to" type="date" value={filters.dateTo} onChange={(e) => setFilter("dateTo", e.target.value)} className={filterClass} />
        </div>
        <div>
          <label htmlFor="dist-method" className="block text-xs mb-1 text-gray-500 dark:text-gray-400">{t("paymentMethod")}</label>
          <select id="dist-method" value={filters.method} onChange={(e) => setFilter("method", e.target.value)} className={`${filterClass} min-w-[220px]`}>
            <option value="">{t("allMethods")}</option>
            {methodOptions.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="dist-rec" className="block text-xs mb-1 text-gray-500 dark:text-gray-400">{t("reconciliation")}</label>
          <select id="dist-rec" value={filters.reconciled} onChange={(e) => setFilter("reconciled", e.target.value)} className={`${filterClass} min-w-[150px]`}>
            <option value="">{t("reconciledAll")}</option>
            <option value="no">{t("reconciledPending")}</option>
            <option value="yes">{t("reconciledDone")}</option>
          </select>
        </div>
        <button
          type="button"
          onClick={() => setFilters({ party: "", dateFrom: "", dateTo: "", method: "", reconciled: "" })}
          className="text-sm text-gray-500 dark:text-gray-400 hover:underline pb-2"
        >
          {t("clearFilters")}
        </button>
      </div>

      {/* El estado del cotejo de lo filtrado: cuánto ya casó con el extracto y cuánto falta. */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-white dark:bg-gray-900 dark:border dark:border-gray-800 rounded-xl shadow-sm p-4">
          <div className="text-xs text-gray-500 dark:text-gray-400">{t("paymentsShown")}</div>
          <div className="text-2xl font-bold dark:text-gray-100">{filtered.length}</div>
        </div>
        <div className="bg-white dark:bg-gray-900 dark:border dark:border-gray-800 rounded-xl shadow-sm p-4">
          <div className="text-xs text-gray-500 dark:text-gray-400">{tc("total")}</div>
          <div className="text-2xl font-bold dark:text-gray-100">{money(totals.total)}</div>
        </div>
        <div className="bg-white dark:bg-gray-900 dark:border dark:border-gray-800 rounded-xl shadow-sm p-4">
          <div className="text-xs text-gray-500 dark:text-gray-400">{t("reconciledDone")}</div>
          <div className="text-2xl font-bold text-green-600 dark:text-green-400">{totals.reconciledCount} · {money(totals.reconciledTotal)}</div>
        </div>
        <div className="bg-white dark:bg-gray-900 dark:border dark:border-gray-800 rounded-xl shadow-sm p-4">
          <div className="text-xs text-gray-500 dark:text-gray-400">{t("reconciledPending")}</div>
          <div className="text-2xl font-bold text-amber-600 dark:text-amber-400">{totals.pendingCount} · {money(totals.pendingTotal)}</div>
        </div>
      </div>

      <div className="bg-white dark:bg-gray-900 dark:border dark:border-gray-800 rounded-xl shadow-sm overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left border-b dark:border-gray-800 text-gray-400 dark:text-gray-500">
              <th className="p-3 font-medium">#</th>
              <th className="p-3 font-medium">{tc("date")}</th>
              <th className="p-3 font-medium">{t("distributor")}</th>
              <th className="p-3 font-medium text-right">{t("subtotal")}</th>
              <th className="p-3 font-medium text-right">{t("debit")}</th>
              <th className="p-3 font-medium text-right">{t("credit")}</th>
              <th className="p-3 font-medium text-right">{tc("total")}</th>
              <th className="p-3 font-medium">{t("paymentMethod")}</th>
              <th className="p-3 font-medium text-center">{t("reconciled")}</th>
              <th className="p-3 font-medium"></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((p) => (
              <tr key={p.id} className={`border-b last:border-0 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800/60 transition-colors ${p.reconciledAt ? "bg-green-50/50 dark:bg-green-500/5" : ""}`}>
                <td className="p-3 font-medium whitespace-nowrap dark:text-gray-200">{p.paymentNumber || "—"}</td>
                <td className="p-3 text-gray-500 dark:text-gray-400 whitespace-nowrap">{p.paymentDate || "—"}</td>
                <td className="p-3 max-w-[220px]">
                  <div className="truncate dark:text-gray-200" title={(p.paidTo || []).join(", ")}>
                    {(p.paidTo || []).join(", ") || "—"}
                  </div>
                </td>
                <td className="p-3 text-right tabular-nums dark:text-gray-200">{money(p.subtotal)}</td>
                <td className="p-3 text-right tabular-nums text-gray-500 dark:text-gray-400">{Number(p.debitNotesTotal || 0) ? money(p.debitNotesTotal) : "—"}</td>
                <td className="p-3 text-right tabular-nums text-gray-500 dark:text-gray-400">{Number(p.creditNotesTotal || 0) ? money(p.creditNotesTotal) : "—"}</td>
                <td className="p-3 text-right tabular-nums font-medium dark:text-gray-100">{money(p.totalAmount)}</td>
                <td className="p-3 max-w-[210px] truncate text-gray-500 dark:text-gray-400" title={p.paymentMethod}>{p.paymentMethod || "—"}</td>
                <td className="p-3 text-center">
                  {/* La marca del cotejo. Escribe al momento; el title dice quién y cuándo. */}
                  <input
                    type="checkbox"
                    checked={!!p.reconciledAt}
                    disabled={savingId === p.id}
                    onChange={() => toggleReconciled(p)}
                    title={p.reconciledAt ? `${p.reconciledBy || ""} ${String(p.reconciledAt).slice(0, 10)}`.trim() : t("markReconciled")}
                    className="w-4 h-4 rounded border-gray-300 dark:border-gray-600 text-green-600 focus:ring-green-500 cursor-pointer disabled:cursor-wait"
                  />
                </td>
                <td className="p-3 text-right">
                  <Link href={`/dashboard/payments/${p.id}`} className="text-blue-600 dark:text-blue-400 hover:underline text-xs font-medium">{tc("viewEdit")}</Link>
                </td>
              </tr>
            ))}
            {filtered.length === 0 && !error && (
              <tr><td className="p-3 text-gray-500" colSpan={10}>{t("noRecords")}</td></tr>
            )}
          </tbody>
          {filtered.length > 0 && (
            <tfoot>
              <tr className="border-t-2 border-gray-200 dark:border-gray-700 font-semibold dark:text-gray-100">
                <td className="p-3" colSpan={3}>{tc("total")}</td>
                <td className="p-3 text-right tabular-nums">{money(totals.subtotal)}</td>
                <td className="p-3 text-right tabular-nums">{money(totals.debit)}</td>
                <td className="p-3 text-right tabular-nums">{money(totals.credit)}</td>
                <td className="p-3 text-right tabular-nums">{money(totals.total)}</td>
                <td className="p-3" colSpan={3}></td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}
