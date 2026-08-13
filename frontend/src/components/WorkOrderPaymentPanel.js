"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { getPaymentMethods, updateWorkOrder, getWorkOrderPaymentLink } from "@/lib/api";
import CurrencyInput from "./CurrencyInput";
import SearchableSelect from "./SearchableSelect";

function money(n) {
  return `$${Number(n || 0).toFixed(2)}`;
}

export default function WorkOrderPaymentPanel({ workOrder, onChange }) {
  const t = useTranslations("workOrders");
  const tc = useTranslations("common");
  const [paymentMethods, setPaymentMethods] = useState([]);
  const [form, setForm] = useState({
    method: workOrder.payment?.method || "",
    amount: workOrder.payment?.amount || 0,
    paid: !!workOrder.payment?.paid,
    cashComeback: workOrder.payment?.cashComeback || 0,
    authorizationId: workOrder.payment?.authorizationId || "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [copyingLink, setCopyingLink] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);

  useEffect(() => {
    getPaymentMethods().then(setPaymentMethods).catch(() => {});
  }, []);

  useEffect(() => {
    setForm({
      method: workOrder.payment?.method || "",
      amount: workOrder.payment?.amount || 0,
      paid: !!workOrder.payment?.paid,
      cashComeback: workOrder.payment?.cashComeback || 0,
      authorizationId: workOrder.payment?.authorizationId || "",
    });
  }, [workOrder.id, workOrder.payment?.amount, workOrder.payment?.paid, workOrder.payment?.method, workOrder.payment?.cashComeback, workOrder.payment?.authorizationId]);

  const remainingBalance = Number(workOrder.totalSale || 0) - Number(form.amount || 0);
  const paymentMethodOptions = useMemo(() => paymentMethods.map((m) => ({ value: m.name, label: m.name })), [paymentMethods]);

  function set(field, value) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  async function handleSave() {
    setSaving(true);
    setError("");
    try {
      const updated = await updateWorkOrder(workOrder.id, { payment: form });
      onChange(updated);
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleCopyPaymentLink() {
    setCopyingLink(true);
    setError("");
    setLinkCopied(false);
    try {
      const { token } = await getWorkOrderPaymentLink(workOrder.id);
      const url = `${window.location.origin}/pay/${token}`;
      await navigator.clipboard.writeText(url);
      setLinkCopied(true);
    } catch (e) {
      setError(e.message);
    } finally {
      setCopyingLink(false);
    }
  }

  const history = [...(workOrder.paymentHistory || [])].reverse();

  return (
    <section className="bg-white dark:bg-gray-900 dark:border dark:border-gray-800 rounded-xl shadow-sm p-4">
      <h2 className="font-semibold mb-3">{t("paymentInfo")}</h2>

      {error && <p className="text-red-600 dark:text-red-400 text-sm mb-3">{error}</p>}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="block text-sm mb-1 text-gray-600 dark:text-gray-300">{t("paymentMethod")}</label>
          <SearchableSelect
            value={form.method}
            onChange={(v) => set("method", v)}
            options={paymentMethodOptions}
            placeholder={t("selectPaymentMethod")}
          />
        </div>
        <div>
          <label className="block text-sm mb-1 text-gray-600 dark:text-gray-300">{t("amountPaid")}</label>
          <CurrencyInput value={form.amount} onChange={(v) => set("amount", v)} />
        </div>
        <div>
          <label className="block text-sm mb-1 text-gray-600 dark:text-gray-300">{t("cashComeback")}</label>
          <CurrencyInput value={form.cashComeback} onChange={(v) => set("cashComeback", v)} />
        </div>
        <div>
          <label className="block text-sm mb-1 text-gray-600 dark:text-gray-300">{t("authorizationId")}</label>
          <input
            value={form.authorizationId}
            onChange={(e) => set("authorizationId", e.target.value)}
            className="w-full border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-shadow"
          />
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 mt-4 pt-4 border-t dark:border-gray-800">
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={form.paid} onChange={(e) => set("paid", e.target.checked)} />
          {t("paid")}
        </label>
        <div className={`text-sm font-semibold ${remainingBalance > 0 ? "text-red-600 dark:text-red-400" : "text-green-600 dark:text-green-400"}`}>
          {t("remainingBalance")}: {money(remainingBalance)}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 mt-4">
        <button onClick={handleSave} disabled={saving} className="bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors px-6 py-2 disabled:opacity-40">
          {tc("saveChanges")}
        </button>
        {remainingBalance > 0 && (
          <button onClick={handleCopyPaymentLink} disabled={copyingLink} className="border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 rounded-lg transition-colors px-4 py-2 text-sm disabled:opacity-40">
            {linkCopied ? t("paymentLinkCopied") : t("copyPaymentLink")}
          </button>
        )}
      </div>

      {history.length > 0 && (
        <div className="mt-6 pt-4 border-t dark:border-gray-800">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-2">{t("paymentHistory")}</h3>
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left border-b dark:border-gray-800 text-gray-400">
                <th className="py-1 pr-2">{tc("date")}</th>
                <th className="py-1 pr-2">{t("paymentMethod")}</th>
                <th className="py-1 pr-2">{tc("amount")}</th>
                <th className="py-1 pr-2">{t("paid")}</th>
                <th className="py-1">{t("performedBy")}</th>
              </tr>
            </thead>
            <tbody>
              {history.map((h, i) => (
                <tr key={i} className="border-b last:border-0 dark:border-gray-800">
                  <td className="py-1 pr-2">{new Date(h.timestamp).toLocaleString()}</td>
                  <td className="py-1 pr-2">{h.method || "—"}</td>
                  <td className="py-1 pr-2">{money(h.amount)}</td>
                  <td className="py-1 pr-2">{h.paid ? "✓" : "—"}</td>
                  <td className="py-1">{h.actor}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
