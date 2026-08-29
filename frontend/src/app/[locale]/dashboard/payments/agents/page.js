"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { getPayments, getPaymentParties, setPaymentReconciled } from "@/lib/api";

function money(n) {
  return `$${Number(n || 0).toFixed(2)}`;
}

const MONEY_SORT_KEYS = new Set(["grossAmount", "bonus", "deductions", "commissionAmount"]);

function SortableTh({ label, k, sort, onSort, right }) {
  const active = sort.key === k;
  return (
    <th className={`p-0 font-medium ${right ? "text-right" : "text-left"}`}>
      <button
        type="button"
        onClick={() => onSort(k)}
        className={`w-full p-3 font-medium inline-flex items-center gap-1 ${right ? "justify-end" : "justify-start"} hover:text-gray-700 dark:hover:text-gray-200 transition-colors ${active ? "text-gray-700 dark:text-gray-200" : ""}`}
      >
        {label}
        <span className={`text-[10px] ${active ? "" : "opacity-0"}`}>{active && sort.dir === "asc" ? "▲" : "▼"}</span>
      </button>
    </th>
  );
}

function sortValue(p, key) {
  if (MONEY_SORT_KEYS.has(key)) return Number(p[key] || 0);
  if (key === "company") return ((p.paidTo || []).join(", ") || "").toLowerCase();
  if (key === "paymentMethod") return (p.paymentMethod || "").toLowerCase();
  return p[key] || "";
}

// El detalle de comisiones pagadas con las columnas de AppSheet (BD_PAYMENTAGENT): comisión,
// bono, descuento y total, por compañía — a un agente se le paga por COMPAÑÍA, no por persona
// (Digiclique junta a David Cruz, Ashley Diaz y Kayla Lopez), así que la fila nombra a la
// compañía y debajo a los agentes cubiertos. Mismo nivel de detalle que el Distributor Report,
// incluida la conciliación bancaria (Antonio, 29-ago-2026).
export default function AgentPaymentsReportPage() {
  const t = useTranslations("payments");
  const tc = useTranslations("common");
  const [payments, setPayments] = useState([]);
  const [parties, setParties] = useState([]);
  const [error, setError] = useState("");
  const [savingId, setSavingId] = useState(null);
  const [filters, setFilters] = useState({ party: "", dateFrom: "", dateTo: "", method: "", reconciled: "" });
  const [sort, setSort] = useState({ key: "paymentDate", dir: "desc" });

  useEffect(() => {
    getPayments({ type: "AGENT" }).then(setPayments).catch((e) => setError(e.message));
    getPaymentParties("AGENT")
      .then((r) => setParties(Array.isArray(r?.parties) ? r.parties : []))
      .catch(() => {});
  }, []);

  const methodOptions = useMemo(
    () => [...new Set(payments.map((p) => p.paymentMethod).filter(Boolean))].sort(),
    [payments]
  );

  const filtered = useMemo(() => {
    return payments
      .filter((p) => {
        // Filtrar por agente = "lotes donde a esa persona se le pagó algo", aunque el lote sea de
        // su compañía: parties trae a las personas, paidTo a quien cobró.
        if (filters.party && !(p.parties || []).includes(filters.party) && !(p.paidTo || []).includes(filters.party)) return false;
        const date = p.paymentDate || "";
        if (filters.dateFrom && date < filters.dateFrom) return false;
        if (filters.dateTo && date > filters.dateTo) return false;
        if (filters.method && p.paymentMethod !== filters.method) return false;
        if (filters.reconciled === "yes" && !p.reconciledAt) return false;
        if (filters.reconciled === "no" && p.reconciledAt) return false;
        return true;
      })
      .sort((a, b) => {
        const va = sortValue(a, sort.key);
        const vb = sortValue(b, sort.key);
        const cmp = typeof va === "number" ? va - vb : String(va).localeCompare(String(vb));
        return sort.dir === "asc" ? cmp : -cmp;
      });
  }, [payments, filters, sort]);

  const totals = useMemo(() => {
    const sum = (fn) => filtered.reduce((acc, p) => acc + fn(p), 0);
    const reconciled = filtered.filter((p) => p.reconciledAt);
    return {
      gross: sum((p) => Number(p.grossAmount || 0)),
      bonus: sum((p) => Number(p.bonus || 0)),
      discount: sum((p) => Number(p.deductions || 0)),
      total: sum((p) => Number(p.commissionAmount || 0)),
      reconciledCount: reconciled.length,
      reconciledTotal: reconciled.reduce((acc, p) => acc + Number(p.commissionAmount || 0), 0),
      pendingCount: filtered.length - reconciled.length,
      pendingTotal: sum((p) => Number(p.commissionAmount || 0)) - reconciled.reduce((acc, p) => acc + Number(p.commissionAmount || 0), 0),
    };
  }, [filtered]);

  function setFilter(field, value) {
    setFilters((prev) => ({ ...prev, [field]: value }));
  }

  function toggleSort(key) {
    setSort((prev) => {
      if (prev.key === key) return { key, dir: prev.dir === "asc" ? "desc" : "asc" };
      return { key, dir: MONEY_SORT_KEYS.has(key) || key === "paymentDate" ? "desc" : "asc" };
    });
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
        <h1 className="text-2xl font-semibold dark:text-gray-100 tracking-tight mt-2">{t("agentReport")}</h1>
      </div>

      {error && <p className="text-red-600 dark:text-red-400 text-sm">{error}</p>}

      <div className="bg-white dark:bg-gray-900 dark:border dark:border-gray-800 rounded-xl shadow-sm p-4 flex flex-wrap items-end gap-4">
        <div>
          <label htmlFor="ag-party" className="block text-xs mb-1 text-gray-500 dark:text-gray-400">{t("colAgent")}</label>
          <select id="ag-party" value={filters.party} onChange={(e) => setFilter("party", e.target.value)} className={`${filterClass} min-w-[190px]`}>
            <option value="">{t("allParties.AGENT")}</option>
            {parties.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="ag-from" className="block text-xs mb-1 text-gray-500 dark:text-gray-400">{t("dateFrom")}</label>
          <input id="ag-from" type="date" value={filters.dateFrom} onChange={(e) => setFilter("dateFrom", e.target.value)} className={filterClass} />
        </div>
        <div>
          <label htmlFor="ag-to" className="block text-xs mb-1 text-gray-500 dark:text-gray-400">{t("dateTo")}</label>
          <input id="ag-to" type="date" value={filters.dateTo} onChange={(e) => setFilter("dateTo", e.target.value)} className={filterClass} />
        </div>
        <div>
          <label htmlFor="ag-method" className="block text-xs mb-1 text-gray-500 dark:text-gray-400">{t("paymentMethod")}</label>
          <select id="ag-method" value={filters.method} onChange={(e) => setFilter("method", e.target.value)} className={`${filterClass} min-w-[190px]`}>
            <option value="">{t("allMethods")}</option>
            {methodOptions.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="ag-rec" className="block text-xs mb-1 text-gray-500 dark:text-gray-400">{t("reconciliation")}</label>
          <select id="ag-rec" value={filters.reconciled} onChange={(e) => setFilter("reconciled", e.target.value)} className={`${filterClass} min-w-[150px]`}>
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
              <SortableTh label="#" k="paymentNumber" sort={sort} onSort={toggleSort} />
              <SortableTh label={tc("date")} k="paymentDate" sort={sort} onSort={toggleSort} />
              <SortableTh label={t("colCompany")} k="company" sort={sort} onSort={toggleSort} />
              <SortableTh label={t("colCommission")} k="grossAmount" sort={sort} onSort={toggleSort} right />
              <SortableTh label={t("colBonus")} k="bonus" sort={sort} onSort={toggleSort} right />
              <SortableTh label={t("colDiscount")} k="deductions" sort={sort} onSort={toggleSort} right />
              <SortableTh label={tc("total")} k="commissionAmount" sort={sort} onSort={toggleSort} right />
              <SortableTh label={t("paymentMethod")} k="paymentMethod" sort={sort} onSort={toggleSort} />
              <th className="p-3 font-medium text-center">{t("reconciled")}</th>
              <th className="p-3 font-medium"></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((p) => {
              const company = (p.paidTo || []).join(", ");
              const personas = (p.parties || []).filter((x) => x && x !== company);
              return (
                <tr key={p.id} className={`border-b last:border-0 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800/60 transition-colors ${p.reconciledAt ? "bg-green-50/50 dark:bg-green-500/5" : ""}`}>
                  <td className="p-3 font-medium whitespace-nowrap dark:text-gray-200">{p.paymentNumber || "—"}</td>
                  <td className="p-3 text-gray-500 dark:text-gray-400 whitespace-nowrap">{p.paymentDate || "—"}</td>
                  <td className="p-3 max-w-[240px]">
                    <div className="truncate dark:text-gray-200" title={company}>{company || "—"}</div>
                    {/* Los agentes cubiertos por el lote, cuando la compañía junta a varios. */}
                    {personas.length > 0 && (
                      <div className="text-xs text-gray-400 dark:text-gray-500 truncate" title={personas.join(", ")}>{personas.join(", ")}</div>
                    )}
                  </td>
                  <td className="p-3 text-right tabular-nums dark:text-gray-200">{money(p.grossAmount)}</td>
                  <td className="p-3 text-right tabular-nums text-gray-500 dark:text-gray-400">{Number(p.bonus || 0) ? money(p.bonus) : "—"}</td>
                  <td className="p-3 text-right tabular-nums text-gray-500 dark:text-gray-400">{Number(p.deductions || 0) ? money(p.deductions) : "—"}</td>
                  <td className="p-3 text-right tabular-nums font-medium dark:text-gray-100">{money(p.commissionAmount)}</td>
                  <td className="p-3 max-w-[180px] truncate text-gray-500 dark:text-gray-400" title={p.paymentMethod}>{p.paymentMethod || "—"}</td>
                  <td className="p-3 text-center">
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
              );
            })}
            {filtered.length === 0 && !error && (
              <tr><td className="p-3 text-gray-500" colSpan={10}>{t("noRecords")}</td></tr>
            )}
          </tbody>
          {filtered.length > 0 && (
            <tfoot>
              <tr className="border-t-2 border-gray-200 dark:border-gray-700 font-semibold dark:text-gray-100">
                <td className="p-3" colSpan={3}>{tc("total")}</td>
                <td className="p-3 text-right tabular-nums">{money(totals.gross)}</td>
                <td className="p-3 text-right tabular-nums">{money(totals.bonus)}</td>
                <td className="p-3 text-right tabular-nums">{money(totals.discount)}</td>
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
