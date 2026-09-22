"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { addPaymentTransaction, getPaymentMethods, removePaymentTransaction } from "@/lib/api";
import { filterByDirection } from "@/lib/paymentMethodDirection";

const money = (v) => `$${Number(v || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const redondeo = (v) => Math.round(Number(v || 0) * 100) / 100;

// Los cargos del banco con que se pagó el lote. Un lote puede salir en varios: Dist-0348
// ($2,797.64) se pagó con $1,500.00 el 14-sep y $1,297.64 el 16-sep en la tarjeta 0533 (Antonio,
// 16-sep-2026). Abajo se dice cuánto falta para cubrir el neto del lote, que es contra lo que se
// coteja el estado de cuenta.
export default function PaymentTransactions({ payment, canEdit, onChange }) {
  const t = useTranslations("payments.transactions");
  const [methods, setMethods] = useState([]);
  const [form, setForm] = useState(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => { getPaymentMethods().then(setMethods).catch(() => {}); }, []);

  const movimientos = [...(payment.transactions || [])].sort((a, b) => String(a.date || "").localeCompare(String(b.date || "")));
  const pagado = redondeo(movimientos.reduce((a, x) => a + Number(x.amount || 0), 0));
  const neto = redondeo(payment.amount);
  const falta = redondeo(neto - pagado);

  function abrir() {
    setError("");
    setForm({
      date: new Date().toISOString().slice(0, 10),
      paymentMethod: payment.paymentMethod || movimientos.at(-1)?.paymentMethod || "",
      amount: falta > 0 ? String(falta) : "",
      transactionReference: "",
    });
  }

  async function guardar() {
    setSaving(true);
    setError("");
    try {
      onChange(await addPaymentTransaction(payment.id, { ...form, amount: Number(form.amount) }));
      setForm(null);
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  async function quitar(x) {
    if (!confirm(t("removeConfirm", { amount: money(x.amount), date: x.date || "" }))) return;
    try {
      onChange(await removePaymentTransaction(payment.id, x.id));
    } catch (e) {
      setError(e.message);
    }
  }

  const input = "w-full border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500";

  return (
    <section className="bg-white dark:bg-gray-900 dark:border dark:border-gray-800 rounded-xl shadow-sm p-4 mb-6">
      <div className="flex items-center justify-between mb-3">
        <h2 className="font-semibold">{t("title")}</h2>
        {canEdit && !form && (
          <button type="button" onClick={abrir} className="text-sm text-blue-600 dark:text-blue-400 hover:underline">
            + {t("add")}
          </button>
        )}
      </div>

      {movimientos.length === 0 ? (
        <p className="text-sm text-gray-500 dark:text-gray-400">{t("empty")}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left border-b dark:border-gray-800 text-xs text-gray-400 uppercase">
                <th className="p-2">{t("date")}</th>
                <th className="p-2">{t("account")}</th>
                <th className="p-2">{t("reference")}</th>
                <th className="p-2 text-right">{t("amount")}</th>
                {canEdit && <th className="p-2"></th>}
              </tr>
            </thead>
            <tbody>
              {movimientos.map((x) => (
                <tr key={x.id} className="border-b last:border-0 dark:border-gray-800">
                  <td className="p-2 tabular-nums dark:text-gray-300">{x.date || "—"}</td>
                  <td className="p-2 dark:text-gray-300">{x.paymentMethod || "—"}</td>
                  <td className="p-2 text-xs text-gray-500 dark:text-gray-400">{[x.transactionReference, x.note].filter(Boolean).join(" · ") || "—"}</td>
                  <td className="p-2 text-right tabular-nums dark:text-gray-100">{money(x.amount)}</td>
                  {canEdit && (
                    <td className="p-2 text-right">
                      <button type="button" onClick={() => quitar(x)} className="text-xs text-red-500 hover:text-red-700">{t("remove")}</button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {movimientos.length > 0 && (
        Math.abs(falta) < 0.005 ? (
          <p className="mt-2 text-sm text-green-700 dark:text-green-400 font-medium">✓ {t("covered", { count: movimientos.length, total: money(pagado) })}</p>
        ) : (
          <p className="mt-2 text-sm text-amber-600 dark:text-amber-400">
            {falta > 0
              ? t("missing", { paid: money(pagado), net: money(neto), gap: money(falta) })
              : t("over", { paid: money(pagado), net: money(neto), gap: money(-falta) })}
          </p>
        )
      )}

      {form && (
        <div className="mt-4 border-t dark:border-gray-800 pt-3 grid grid-cols-1 sm:grid-cols-[150px_1fr_130px_1fr] gap-2 items-end">
          <label className="text-xs text-gray-500 dark:text-gray-400">
            {t("date")}
            <input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} className={input} />
          </label>
          <label className="text-xs text-gray-500 dark:text-gray-400">
            {t("account")}
            <select value={form.paymentMethod} onChange={(e) => setForm({ ...form, paymentMethod: e.target.value })} className={input}>
              <option value="">—</option>
              {form.paymentMethod && !methods.some((m) => m.name === form.paymentMethod) && (
                <option value={form.paymentMethod}>{form.paymentMethod}</option>
              )}
              {filterByDirection(methods, "out").map((m) => <option key={m.id} value={m.name}>{m.name}</option>)}
            </select>
          </label>
          <label className="text-xs text-gray-500 dark:text-gray-400">
            {t("amount")}
            <input type="number" step="0.01" min="0" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} className={input} />
          </label>
          <label className="text-xs text-gray-500 dark:text-gray-400">
            {t("reference")}
            <input type="text" value={form.transactionReference} onChange={(e) => setForm({ ...form, transactionReference: e.target.value })} className={input} />
          </label>
          <div className="sm:col-span-4 flex gap-2">
            <button type="button" onClick={guardar} disabled={saving || !(Number(form.amount) > 0) || !form.date}
              className="bg-blue-600 hover:bg-blue-700 text-white rounded-lg px-4 py-2 text-sm disabled:opacity-40">
              {t("save")}
            </button>
            <button type="button" onClick={() => setForm(null)} className="border border-gray-200 dark:border-gray-700 rounded-lg px-4 py-2 text-sm dark:text-gray-200">
              {t("cancel")}
            </button>
          </div>
        </div>
      )}
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
    </section>
  );
}
