"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { getPayableParties, getPayablePending, createPayablePayout, getPaymentMethods } from "@/lib/api";
import { money } from "./OrderSummaryUI";

// Una sola vista para los tres tipos. El modelo lo permite porque payable es una sola tabla: la
// diferencia entre pagarle a un tecnico, a un agente o a un distribuidor es el `kind` y los tres
// terminos extra que solo aplican al tecnico.
//
// Deliberadamente NO reusa PaymentBatchWizard: aquel selecciona work orders, y la deuda es por
// orden Y por parte — 490 work orders tienen mas de una obligacion de distribuidor y 44 le deben
// a dos distribuidores distintos, algo que una lista de work orders no puede expresar.

const AJUSTES_TECNICO = [
  { key: "bonus", signo: +1 },
  { key: "deductions", signo: -1 },
  { key: "cashAdvance", signo: -1 },
  { key: "partsDeduction", signo: -1 },
  { key: "partsReturn", signo: +1 },
];

const inputClass =
  "w-full border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-shadow";

export default function PayableBalances({ kind, onChanged, historicalCount = 0 }) {
  const t = useTranslations("payable");
  const tc = useTranslations("common");

  const [parties, setParties] = useState([]);
  const [party, setParty] = useState(null);
  const [obligations, setObligations] = useState([]);
  const [selected, setSelected] = useState(new Set());
  const [ajustes, setAjustes] = useState({ bonus: 0, deductions: 0, cashAdvance: 0, partsDeduction: 0, partsReturn: 0 });
  const [paymentMethod, setPaymentMethod] = useState("");
  const [paymentDate, setPaymentDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [methods, setMethods] = useState([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState("");

  const esTecnico = kind === "TECH";

  const loadParties = useCallback(() => {
    getPayableParties(kind).then((r) => setParties(r.parties || [])).catch((e) => setError(e.message));
  }, [kind]);

  useEffect(() => { loadParties(); }, [loadParties]);
  useEffect(() => { getPaymentMethods().then(setMethods).catch(() => {}); }, []);

  function abrir(p) {
    setParty(p);
    setSelected(new Set());
    setError("");
    setDone("");
    setAjustes({ bonus: 0, deductions: 0, cashAdvance: 0, partsDeduction: 0, partsReturn: 0 });
    getPayablePending(kind, p.party).then((r) => setObligations(r.obligations || [])).catch((e) => setError(e.message));
  }

  const subtotal = useMemo(
    () => obligations.filter((o) => selected.has(o.id)).reduce((a, o) => a + Number(o.amount || 0), 0),
    [obligations, selected]
  );
  const total = useMemo(
    () => (esTecnico ? AJUSTES_TECNICO.reduce((a, x) => a + x.signo * Number(ajustes[x.key] || 0), subtotal) : subtotal),
    [subtotal, ajustes, esTecnico]
  );

  function toggle(id) {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  async function crearLote() {
    if (!selected.size || saving) return;
    setSaving(true);
    setError("");
    try {
      const payout = await createPayablePayout(kind, {
        payableIds: [...selected],
        paymentMethod,
        paymentDate,
        ...(esTecnico ? ajustes : {}),
      });
      setDone(t("batchCreated", { number: payout.paymentNumber || payout.id, amount: money(total) }));
      // Recargar: las obligaciones incluidas ya no estan pendientes.
      setSelected(new Set());
      loadParties();
      onChanged?.();
      const r = await getPayablePending(kind, party.party);
      setObligations(r.obligations || []);
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  const totalPendiente = parties.reduce((a, p) => a + p.pendingAmount, 0);

  if (!party) {
    return (
      <div className="bg-white dark:bg-gray-900 dark:border dark:border-gray-800 rounded-xl shadow-sm p-4">
        <div className="flex items-baseline justify-between mb-3">
          <h2 className="text-sm font-semibold dark:text-gray-100">{t(`title.${kind}`)}</h2>
          <span className="text-sm text-gray-500 dark:text-gray-400">
            {t("totalPending", { amount: money(totalPendiente), count: parties.reduce((a, p) => a + p.pendingCount, 0) })}
          </span>
        </div>
        {error && <p className="text-sm text-red-600 dark:text-red-400 mb-2">{error}</p>}
        {parties.length === 0 && <p className="text-sm text-gray-400">{t("noBalances")}</p>}
        {historicalCount > 0 && (
          /* Una obligacion de $0 es registro historico, no deuda: se conserva pero no se cobra. */
          <p className="text-xs text-gray-400 dark:text-gray-500 mb-2">{t("historicalNote", { count: historicalCount })}</p>
        )}
        <div className="divide-y dark:divide-gray-800">
          {parties.map((p) => (
            <button
              key={p.party}
              type="button"
              onClick={() => abrir(p)}
              className="w-full flex items-center justify-between py-2 text-left hover:bg-gray-50 dark:hover:bg-gray-800 px-2 rounded"
            >
              <span className="text-sm dark:text-gray-100">{p.party}</span>
              <span className="flex items-center gap-4">
                <span className="text-xs text-gray-400">{t("obligations", { count: p.pendingCount })}</span>
                <span className="text-sm font-medium tabular-nums dark:text-gray-100">{money(p.pendingAmount)}</span>
              </span>
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white dark:bg-gray-900 dark:border dark:border-gray-800 rounded-xl shadow-sm p-4">
      <div className="flex items-center justify-between mb-3">
        <div>
          <button type="button" onClick={() => setParty(null)} className="text-xs text-blue-600 dark:text-blue-400 mb-1">
            ← {t("backToList")}
          </button>
          <h2 className="text-sm font-semibold dark:text-gray-100">{party.party}</h2>
        </div>
        <span className="text-sm text-gray-500 dark:text-gray-400">{money(party.pendingAmount)}</span>
      </div>

      {done && <p className="text-sm text-green-600 dark:text-green-400 mb-2">{done}</p>}
      {error && <p className="text-sm text-red-600 dark:text-red-400 mb-2">{error}</p>}

      <div className="max-h-72 overflow-y-auto border dark:border-gray-800 rounded-lg mb-3">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 dark:bg-gray-800 text-xs text-gray-500 dark:text-gray-400 sticky top-0">
            <tr>
              <th className="w-8 p-2"></th>
              <th className="text-left p-2 font-medium">{t("workOrder")}</th>
              <th className="text-left p-2 font-medium">{tc("date")}</th>
              <th className="text-left p-2 font-medium">{t("customer")}</th>
              <th className="text-right p-2 font-medium">{tc("amount")}</th>
            </tr>
          </thead>
          <tbody className="divide-y dark:divide-gray-800">
            {obligations.map((o) => (
              <tr key={o.id} className="hover:bg-gray-50 dark:hover:bg-gray-800/60">
                <td className="p-2">
                  <input type="checkbox" checked={selected.has(o.id)} onChange={() => toggle(o.id)} className="w-4 h-4" />
                </td>
                <td className="p-2 dark:text-gray-100">{o.workOrderNo || "—"}</td>
                <td className="p-2 text-gray-500 dark:text-gray-400">{o.workDate ? String(o.workDate).slice(0, 10) : "—"}</td>
                <td className="p-2 text-gray-500 dark:text-gray-400 truncate max-w-[16rem]">{o.customerName}</td>
                <td className="p-2 text-right tabular-nums dark:text-gray-100">{money(o.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="grid grid-cols-2 gap-3 mb-3">
        <div>
          <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">{t("paymentMethod")}</label>
          <select value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)} className={inputClass}>
            <option value="">{t("selectMethod")}</option>
            {methods.map((m) => <option key={m.id} value={m.name}>{m.name}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">{t("paymentDate")}</label>
          <input type="date" value={paymentDate} onChange={(e) => setPaymentDate(e.target.value)} className={inputClass} />
        </div>
      </div>

      {/* Los cinco terminos solo existen para el lote de tecnico. */}
      {esTecnico && (
        <div className="grid grid-cols-5 gap-2 mb-3">
          {AJUSTES_TECNICO.map(({ key, signo }) => (
            <div key={key}>
              <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">
                {signo > 0 ? "+ " : "− "}{t(`adjust.${key}`)}
              </label>
              <input
                type="number" step="0.01" value={ajustes[key]}
                onChange={(e) => setAjustes((a) => ({ ...a, [key]: Number(e.target.value) }))}
                className={inputClass}
              />
            </div>
          ))}
        </div>
      )}

      <div className="flex items-center justify-between border-t dark:border-gray-800 pt-3">
        <div className="text-sm text-gray-500 dark:text-gray-400">
          {t("selectedCount", { count: selected.size })} · {t("subtotal")} {money(subtotal)}
          {esTecnico && total !== subtotal && <> · <span className="font-medium dark:text-gray-100">{t("total")} {money(total)}</span></>}
        </div>
        <button
          type="button" onClick={crearLote} disabled={!selected.size || saving}
          className="bg-gray-900 hover:bg-gray-800 dark:bg-blue-600 dark:hover:bg-blue-700 text-white rounded-lg px-4 py-2 text-sm disabled:opacity-40"
        >
          {saving ? t("creating") : t("createBatch", { amount: money(total) })}
        </button>
      </div>
    </div>
  );
}
