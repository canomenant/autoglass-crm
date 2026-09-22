"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { getPaymentMethods, createPaymentMethod, updatePaymentMethod, deletePaymentMethod } from "@/lib/api";
import { DIRECTIONS } from "@/lib/paymentMethodDirection";
import SettingsIcon from "@/components/SettingsIcon";

// El catálogo de métodos de pago, con una columna que el resto de los catálogos no necesita: para
// qué sirve cada uno. El cobro de la orden ofrecía las cuentas con las que la empresa PAGA
// —Capital One ****4360, Chase, las Business Card— y ningún cliente ha pagado nunca con ellas
// (Antonio, 21-sep-2026). Por eso esta pantalla ya no usa SimpleCatalogPage.
const TONO = {
  in: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300",
  out: "bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300",
  both: "bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-200",
};

const INPUT =
  "w-full border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-shadow";

export default function PaymentMethodPage() {
  const t = useTranslations("settingsCatalog.paymentMethod");
  const tc = useTranslations("common");
  const td = useTranslations("paymentMethodDirection");
  const [items, setItems] = useState([]);
  const [error, setError] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [name, setName] = useState("");
  const [direction, setDirection] = useState("both");

  function load() {
    getPaymentMethods().then(setItems).catch((e) => setError(e.message));
  }
  useEffect(load, []);

  function openNew() {
    setEditing(null);
    setName("");
    setDirection("both");
    setModalOpen(true);
  }

  function openEdit(item) {
    setEditing(item);
    setName(item.name);
    setDirection(item.direction || "both");
    setModalOpen(true);
  }

  async function handleSave(e) {
    e.preventDefault();
    try {
      if (editing) await updatePaymentMethod(editing.id, { name, direction });
      else await createPaymentMethod({ name, direction });
      setModalOpen(false);
      load();
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleDelete(id) {
    if (!confirm(tc("confirmDelete"))) return;
    try {
      await deletePaymentMethod(id);
      load();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Link href="/dashboard/settings" className="w-9 h-9 flex items-center justify-center rounded-lg bg-white shadow text-gray-500">‹</Link>
          <SettingsIcon name="credit-card" className="w-6 h-6 text-gray-800" />
          <div>
            <h1 className="text-xl font-bold leading-tight">{t("title")}</h1>
            <p className="text-sm text-gray-500">{td("subtitle")}</p>
          </div>
        </div>
        <button onClick={openNew} className="bg-gray-900 hover:bg-gray-800 dark:bg-blue-600 dark:hover:bg-blue-700 text-white rounded-full transition-colors px-5 py-2.5 text-sm font-medium">
          {tc("newRecordButton")}
        </button>
      </div>

      {error && <p className="text-red-600 dark:text-red-400 text-sm mb-4">{error}</p>}

      <div className="bg-white dark:bg-gray-900 dark:border dark:border-gray-800 rounded-xl shadow-sm overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left border-b dark:border-gray-800 text-xs text-gray-400 uppercase tracking-wide">
              <th className="p-4">#</th>
              <th className="p-4">{t("column")}</th>
              <th className="p-4">{td("column")}</th>
              <th className="p-4 text-right">{tc("behavior")}</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item, i) => (
              <tr key={item.id} className="border-b last:border-0 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800/60 transition-colors">
                <td className="p-4 font-medium text-gray-400">{i + 1}</td>
                <td className="p-4 dark:text-gray-100">{item.name}</td>
                <td className="p-4">
                  <span className={`inline-block text-xs font-medium rounded-full px-2.5 py-1 ${TONO[item.direction || "both"]}`}>
                    {td(`options.${item.direction || "both"}`)}
                  </span>
                </td>
                <td className="p-4">
                  <div className="flex justify-end gap-2">
                    <button onClick={() => openEdit(item)} className="rounded-lg bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 px-3 py-1.5 text-xs">
                      {tc("editRecord")}
                    </button>
                    <button onClick={() => handleDelete(item.id)} className="rounded-lg bg-red-50 dark:bg-red-900/30 text-red-500 px-3 py-1.5 text-xs">
                      {tc("delete")}
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {items.length === 0 && !error && (
              <tr><td className="p-4 text-gray-500" colSpan={4}>{tc("noRecords")}</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {modalOpen && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <form onSubmit={handleSave} className="bg-white dark:bg-gray-800 dark:border dark:border-gray-700 rounded-xl shadow-xl p-6 w-full max-w-sm space-y-4">
            <h2 className="text-lg font-semibold dark:text-gray-100">{editing ? tc("editRecord") : tc("newRecord")}</h2>
            <div>
              <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">{t("column")}</label>
              <input value={name} onChange={(e) => setName(e.target.value)} required className={INPUT} />
            </div>
            <div>
              <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">{td("column")}</label>
              <select value={direction} onChange={(e) => setDirection(e.target.value)} className={INPUT}>
                {DIRECTIONS.map((d) => (
                  <option key={d} value={d}>{td(`options.${d}`)}</option>
                ))}
              </select>
              <p className="text-[11px] text-gray-400 mt-1">{td(`hint.${direction}`)}</p>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={() => setModalOpen(false)} className="text-sm text-gray-500 px-3 py-2">{tc("cancel")}</button>
              <button type="submit" className="bg-blue-600 hover:bg-blue-700 text-white rounded-lg px-4 py-2 text-sm">{tc("save")}</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
