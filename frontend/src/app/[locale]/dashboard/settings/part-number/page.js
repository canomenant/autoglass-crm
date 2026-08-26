"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import SettingsIcon from "@/components/SettingsIcon";
import {
  getPartNumbers,
  createPartNumber,
  updatePartNumber,
  deletePartNumber,
} from "@/lib/api";

function EditIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
      <line x1="4" y1="7" x2="20" y2="7" />
      <path d="M6 7V4.5A1.5 1.5 0 0 1 7.5 3h9A1.5 1.5 0 0 1 18 4.5V7" />
      <path d="M19 7l-.9 12.1a2 2 0 0 1-2 1.9H7.9a2 2 0 0 1-2-1.9L5 7" />
      <line x1="10" y1="11" x2="10" y2="16" />
      <line x1="14" y1="11" x2="14" y2="16" />
    </svg>
  );
}

export default function PartNumberPage() {
  const t = useTranslations("settingsCatalog.partNumber");
  const tc = useTranslations("common");
  const [items, setItems] = useState([]);
  const [error, setError] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({ partNumber: "", jobType: "", nagsDescription: "" });
  const [query, setQuery] = useState("");
  // "Solo las que faltan": 4.568 sin descripcion y 156 con el texto literal NULL/NULO. Es el modo
  // para lo que preguntaste — encontrar las que estan mal y corregirlas.
  const [onlyMissing, setOnlyMissing] = useState(false);

  // Con 10.408 piezas, pintarlas todas ahoga la pagina y no hay forma de encontrar una. Se limita
  // lo que se dibuja; el buscador y el filtro son los que acotan.
  const MAX_ROWS = 200;

  function load() {
    getPartNumbers().then(setItems).catch((e) => setError(e.message));
  }

  useEffect(load, []);

  // Una descripcion "falta" si esta vacia o si es el texto literal NULL/NULO que dejo el import.
  const faltaDescripcion = (d) => {
    const s = String(d || "").trim().toUpperCase();
    return s === "" || s === "NULL" || s === "NULO";
  };
  const totalFaltantes = useMemo(() => items.filter((i) => faltaDescripcion(i.nagsDescription)).length, [items]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    // Se squashea igual que el buscador de piezas del presupuesto: "DW02475GTN" y "dw-02475 gtn"
    // encuentran la misma pieza.
    const squash = (s) => String(s || "").toLowerCase().replace(/[\s\-._/]+/g, "");
    const qs = squash(q);
    return items.filter((i) => {
      if (onlyMissing && !faltaDescripcion(i.nagsDescription)) return false;
      if (!q) return true;
      const enPart = squash(i.partNumber).includes(qs);
      const enDesc = String(i.nagsDescription || "").toLowerCase().includes(q);
      const enJob = String(i.jobType || "").toLowerCase().includes(q);
      return enPart || enDesc || enJob;
    });
  }, [items, query, onlyMissing]);

  const visible = filtered.slice(0, MAX_ROWS);

  function openNew() {
    setEditing(null);
    setForm({ partNumber: "", jobType: "", nagsDescription: "" });
    setModalOpen(true);
  }

  function openEdit(item) {
    setEditing(item);
    // El texto literal "NULL"/"NULO" del import se muestra como vacio en el formulario, para no
    // tener que borrarlo a mano antes de escribir la descripcion correcta.
    const desc = faltaDescripcion(item.nagsDescription) ? "" : item.nagsDescription;
    setForm({ partNumber: item.partNumber, jobType: item.jobType || "", nagsDescription: desc });
    setModalOpen(true);
  }

  async function handleSave(e) {
    e.preventDefault();
    try {
      if (editing) {
        await updatePartNumber(editing.id, form);
      } else {
        await createPartNumber(form);
      }
      setModalOpen(false);
      load();
    } catch (e) {
      setError(e.message);
    }
  }

  async function handleDelete(id) {
    if (!confirm(tc("confirmDelete"))) return;
    try {
      await deletePartNumber(id);
      load();
    } catch (e) {
      setError(e.message);
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Link href="/dashboard/settings" className="w-9 h-9 flex items-center justify-center rounded-lg bg-white shadow text-gray-500">
            ‹
          </Link>
          <SettingsIcon name="barcode" className="w-6 h-6 text-gray-800" />
          <div>
            <h1 className="text-xl font-bold leading-tight">{t("title")}</h1>
            <p className="text-sm text-gray-500">{t("subtitle")}</p>
          </div>
        </div>
        <button onClick={openNew} className="bg-gray-900 hover:bg-gray-800 dark:bg-blue-600 dark:hover:bg-blue-700 text-white rounded-full transition-colors px-5 py-2.5 text-sm font-medium">
          {tc("newRecordButton")}
        </button>
      </div>

      {error && <p className="text-red-600 dark:text-red-400 text-sm mb-4">{error}</p>}

      {/* Buscador + filtro. Con 10.408 piezas es la unica forma de llegar a una concreta. */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-3 mb-4">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("searchPlaceholder")}
          className="flex-1 border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-shadow"
        />
        <label className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300 whitespace-nowrap">
          <input type="checkbox" checked={onlyMissing} onChange={(e) => setOnlyMissing(e.target.checked)} className="w-4 h-4" />
          {t("onlyMissing", { count: totalFaltantes })}
        </label>
      </div>

      <p className="text-xs text-gray-400 dark:text-gray-500 mb-2">
        {filtered.length > MAX_ROWS
          ? t("showingCapped", { shown: MAX_ROWS, total: filtered.length })
          : t("showingCount", { count: filtered.length })}
      </p>

      <div className="bg-white dark:bg-gray-900 dark:border dark:border-gray-800 rounded-xl shadow-sm overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left border-b dark:border-gray-800 text-xs text-gray-400 uppercase tracking-wide">
              <th className="p-4">#</th>
              <th className="p-4">{t("column")}</th>
              <th className="p-4">{t("jobType")}</th>
              <th className="p-4">{t("nagsDescription")}</th>
              <th className="p-4 text-right">{tc("behavior")}</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((item, i) => (
              <tr key={item.id} className="border-b last:border-0 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800/60 transition-colors align-top">
                <td className="p-4 font-medium text-orange-600">{i + 1}</td>
                <td className="p-4 text-orange-600 whitespace-nowrap">{item.partNumber}</td>
                <td className="p-4 text-gray-700 dark:text-gray-300 whitespace-nowrap">{item.jobType}</td>
                {/* Las que faltan se marcan en vez de mostrar un vacio o el texto "NULL", para que
                    se distinga a simple vista cual hay que corregir. */}
                <td className="p-4 max-w-xl">
                  {faltaDescripcion(item.nagsDescription) ? (
                    <span className="text-xs italic text-amber-600 dark:text-amber-400">{t("missingBadge")}</span>
                  ) : (
                    <span className="text-gray-700 dark:text-gray-300">{item.nagsDescription}</span>
                  )}
                </td>
                <td className="p-4">
                  <div className="flex justify-end gap-2">
                    <button onClick={() => openEdit(item)} className="w-8 h-8 flex items-center justify-center rounded-lg bg-gray-100 text-gray-600">
                      <EditIcon />
                    </button>
                    <button onClick={() => handleDelete(item.id)} className="w-8 h-8 flex items-center justify-center rounded-lg bg-red-50 text-red-500">
                      <TrashIcon />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {filtered.length === 0 && !error && (
              <tr><td className="p-4 text-gray-500" colSpan={5}>{query || onlyMissing ? t("noMatches") : tc("noRecords")}</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {modalOpen && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <form onSubmit={handleSave} className="bg-white dark:bg-gray-800 dark:border dark:border-gray-700 rounded-xl shadow-xl p-6 w-full max-w-lg space-y-4">
            <h2 className="text-lg font-semibold">{editing ? tc("editRecord") : tc("newRecord")}</h2>
            <div>
              <label className="block text-sm mb-1 text-gray-600 dark:text-gray-300">{t("column")}</label>
              <input
                value={form.partNumber}
                onChange={(e) => setForm({ ...form, partNumber: e.target.value })}
                className="w-full border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-shadow"
                required
              />
            </div>
            <div>
              <label className="block text-sm mb-1 text-gray-600 dark:text-gray-300">{t("jobType")}</label>
              <input
                value={form.jobType}
                onChange={(e) => setForm({ ...form, jobType: e.target.value })}
                className="w-full border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-shadow"
              />
            </div>
            <div>
              <label className="block text-sm mb-1 text-gray-600 dark:text-gray-300">{t("nagsDescription")}</label>
              <textarea
                value={form.nagsDescription}
                onChange={(e) => setForm({ ...form, nagsDescription: e.target.value })}
                className="w-full border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-shadow"
                rows={4}
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={() => setModalOpen(false)} className="px-4 py-2 rounded text-sm">
                {tc("cancel")}
              </button>
              <button type="submit" className="bg-gray-900 hover:bg-gray-800 dark:bg-blue-600 dark:hover:bg-blue-700 text-white rounded-lg transition-colors px-4 py-2 text-sm">
                {tc("save")}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
