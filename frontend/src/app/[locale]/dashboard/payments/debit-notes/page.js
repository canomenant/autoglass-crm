"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { getDebitNotes, getDebitNotesDashboard, applyDebitNote, voidDebitNote } from "@/lib/api";

const ENTITY_TYPES = ["DISTRIBUTOR", "TECHNICIAN", "AGENT"];
const STATUSES = ["Active", "Applied", "Void", "Cancelled"];

const STATUS_COLORS = {
  Active: "bg-amber-100 text-amber-700",
  Applied: "bg-green-100 text-green-700",
  Void: "bg-gray-200 text-gray-600",
  Cancelled: "bg-gray-200 text-gray-600",
};

function money(n) {
  return `$${Number(n || 0).toFixed(2)}`;
}


// Chip enlazable para las columnas de relacion (a que pago suma, que credito la cerro, etc.).
function RelChip({ href, tone, children }) {
  const tones = {
    blue: "bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-500/10 dark:text-blue-300 dark:border-blue-500/30",
    green: "bg-green-50 text-green-700 border-green-200 dark:bg-green-500/10 dark:text-green-300 dark:border-green-500/30",
    purple: "bg-purple-50 text-purple-700 border-purple-200 dark:bg-purple-500/10 dark:text-purple-300 dark:border-purple-500/30",
    amber: "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-500/10 dark:text-amber-300 dark:border-amber-500/30",
    gray: "bg-gray-100 text-gray-600 border-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:border-gray-700",
  };
  const cls = `inline-flex items-center text-xs font-medium border rounded-full px-2 py-0.5 whitespace-nowrap ${tones[tone] || tones.gray}`;
  if (href) return <Link href={href} className={`${cls} hover:underline`}>{children}</Link>;
  return <span className={cls}>{children}</span>;
}

function StatusBadge({ status }) {
  return <span className={`text-xs font-medium rounded-full px-2 py-1 ${STATUS_COLORS[status] || "bg-gray-100 text-gray-600"}`}>{status}</span>;
}

function toCsv(rows) {
  const header = ["Note No", "Entity Type", "Entity", "Part", "Invoice #", "Amount", "Reason", "Applied In", "Outcome", "Status", "Issue Date"];
  const lines = rows.map((n) =>
    [
      n.noteNumber, n.entityType, n.entityName, n.partNumber, n.invoiceNumber, n.amount, n.reason,
      n.relatedPaymentNumber || "",
      n.resolution === "TECH" ? (n.chargePaymentNumber || n.technician || "TECH") : n.resolution === "RETURNED" ? (n.resolvedBy?.noteNumber || "RETURNED") : n.resolution || "",
      n.status, n.issueDate,
    ]
      .map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`)
      .join(",")
  );
  return [header.join(","), ...lines].join("\n");
}

export default function DebitNotesPage() {
  const t = useTranslations("notes");
  const tp = useTranslations("payments");
  const tc = useTranslations("common");
  const [notes, setNotes] = useState([]);
  const [kpis, setKpis] = useState(null);
  const [error, setError] = useState("");
  const [filters, setFilters] = useState({ search: "", entityType: "", status: "", dateFrom: "", dateTo: "" });
  const [cycle, setCycle] = useState("");

  function cicloAbierto(n) {
    if (!n.resolution) return true;
    if (n.resolution === "TECH" && !n.chargePayoutId) return true;
    if (n.resolution === "RETURNED" && !n.resolvedBy) return true;
    return false;
  }

  function load() {
    getDebitNotes(filters).then(setNotes).catch((e) => setError(e.message));
    getDebitNotesDashboard().then(setKpis).catch(() => {});
  }

  useEffect(load, [filters.entityType, filters.status, filters.dateFrom, filters.dateTo]);
  useEffect(() => {
    const timeout = setTimeout(load, 300);
    return () => clearTimeout(timeout);
  }, [filters.search]);

  async function handleApply(id) {
    if (!confirm(t("confirmApply"))) return;
    try {
      await applyDebitNote(id);
      load();
    } catch (e) {
      setError(e.message);
    }
  }

  async function handleVoid(id) {
    if (!confirm(t("confirmVoid"))) return;
    const reason = prompt(t("voidReasonPrompt")) || "";
    try {
      await voidDebitNote(id, reason);
      load();
    } catch (e) {
      setError(e.message);
    }
  }

  function handleExportCsv() {
    // Exporta lo que se está VIENDO: con el filtro de ciclo puesto, exportar todo era mentirle
    // al archivo.
    const csv = toCsv(visibleNotes);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "debit-notes.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  const visibleNotes = useMemo(() => {
    if (!cycle) return notes;
    return notes.filter((n) => (cycle === "open" ? cicloAbierto(n) : !cicloAbierto(n)));
  }, [notes, cycle]);

  const kpiCards = useMemo(() => {
    if (!kpis) return [];
    return [
      { label: t("kpiActive"), value: kpis.active },
      { label: t("kpiAppliedThisMonth"), value: money(kpis.appliedThisMonth) },
      { label: t("kpiOutstanding"), value: money(kpis.outstanding) },
    ];
  }, [kpis, t]);

  return (
    <div>
      <Link href="/dashboard/payments" className="text-sm text-gray-500">← {tp("backToPayments")}</Link>

      <div className="flex items-center justify-between my-4">
        <div>
          <h1 className="text-2xl font-semibold dark:text-gray-100 tracking-tight">{t("debitNotesTitle")}</h1>
          <p className="text-sm text-gray-500">{t("debitNotesSubtitle")}</p>
        </div>
        <div className="flex gap-2">
          <button onClick={handleExportCsv} className="border rounded px-4 py-2 text-sm">{tp("exportCsv")}</button>
          <Link href="/dashboard/payments/debit-notes/create" className="bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors px-4 py-2 text-sm">
            {t("newDebitNote")}
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        {kpiCards.map((kpi) => (
          <div key={kpi.label} className="bg-white dark:bg-gray-900 dark:border dark:border-gray-800 rounded-xl shadow-sm p-4">
            <div className="text-xs text-gray-500">{kpi.label}</div>
            <div className="text-xl font-bold">{kpi.value}</div>
          </div>
        ))}
      </div>

      <div className="bg-white dark:bg-gray-900 dark:border dark:border-gray-800 rounded-xl shadow-sm p-4 mb-4 grid grid-cols-1 md:grid-cols-6 gap-3">
        <input
          value={filters.search}
          onChange={(e) => setFilters((f) => ({ ...f, search: e.target.value }))}
          placeholder={t("searchPlaceholder")}
          className="border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-shadow text-sm md:col-span-2"
        />
        <select value={filters.entityType} onChange={(e) => setFilters((f) => ({ ...f, entityType: e.target.value }))} className="border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-shadow text-sm">
          <option value="">{t("allEntityTypes")}</option>
          {ENTITY_TYPES.map((et) => <option key={et} value={et}>{t(`entityTypes.${et}`)}</option>)}
        </select>
        <select value={filters.status} onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value }))} className="border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-shadow text-sm">
          <option value="">{tp("allStatuses")}</option>
          {STATUSES.map((s) => <option key={s} value={s}>{t(`statuses.${s}`)}</option>)}
        </select>
        <select value={cycle} onChange={(e) => setCycle(e.target.value)} className="border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-shadow text-sm">
          <option value="">{t("cycleAll")}</option>
          <option value="open">{t("cycleOpen")}</option>
          <option value="closed">{t("cycleClosed")}</option>
        </select>
        <div className="flex gap-2">
          <input type="date" value={filters.dateFrom} onChange={(e) => setFilters((f) => ({ ...f, dateFrom: e.target.value }))} className="border rounded px-2 py-2 text-sm w-1/2" />
          <input type="date" value={filters.dateTo} onChange={(e) => setFilters((f) => ({ ...f, dateTo: e.target.value }))} className="border rounded px-2 py-2 text-sm w-1/2" />
        </div>
      </div>

      {error && <p className="text-red-600 dark:text-red-400 text-sm mb-4">{error}</p>}

      <div className="bg-white dark:bg-gray-900 dark:border dark:border-gray-800 rounded-xl shadow-sm overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left border-b dark:border-gray-800">
              <th className="p-3">{t("noteNo")}</th>
              <th className="p-3">{t("entityType")}</th>
              <th className="p-3">{t("entity")}</th>
              <th className="p-3">{t("part")}</th>
              <th className="p-3">{t("issueDate")}</th>
              <th className="p-3">{t("distributorInvoiceShort")}</th>
              <th className="p-3">{tc("amount")}</th>
              <th className="p-3">{t("reason")}</th>
              <th className="p-3">{t("relAppliedIn")}</th>
              <th className="p-3">{t("relOutcome")}</th>
              <th className="p-3">{tp("status")}</th>
              <th className="p-3"></th>
            </tr>
          </thead>
          <tbody>
            {visibleNotes.map((n) => (
              <tr key={n.id} className="border-b last:border-0 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800/60 transition-colors">
                <td className="p-3 font-medium">{n.noteNumber}</td>
                <td className="p-3">{t(`entityTypes.${n.entityType}`)}</td>
                <td className="p-3">{n.entityName || "—"}</td>
                <td className="p-3">
                  <span className="font-mono text-xs">{n.partNumber || "—"}</span>
                  {n.partDescription && <span className="block text-xs text-gray-400 dark:text-gray-500 max-w-[220px] truncate">{n.partDescription}</span>}
                </td>
                <td className="p-3 text-xs tabular-nums text-gray-500 dark:text-gray-400 whitespace-nowrap">{n.issueDate ? String(n.issueDate).slice(0, 10) : "—"}</td>
                <td className="p-3 text-xs text-gray-500 dark:text-gray-400">{n.invoiceNumber || "—"}</td>
                <td className="p-3">{money(n.amount)}</td>
                <td className="p-3">{n.reason}</td>
                <td className="p-3">
                  {n.relatedPaymentNumber ? (
                    <RelChip tone="blue" href={`/dashboard/payments/${n.relatedPaymentId}`}>{n.relatedPaymentNumber}</RelChip>
                  ) : (
                    <span className="text-gray-400">—</span>
                  )}
                </td>
                <td className="p-3">
                  {/* El destino de la parte: quien absorbio el cargo o en que va el ciclo. */}
                  {n.resolution === "TECH" ? (
                    n.chargePayoutId ? (
                      <RelChip tone="purple" href={`/dashboard/payments/${n.chargePayoutId}`}>{n.chargePaymentNumber || n.technician}</RelChip>
                    ) : (
                      <RelChip tone="amber">{n.technician} · {t("relPending")}</RelChip>
                    )
                  ) : n.resolution === "RETURNED" ? (
                    n.resolvedBy ? (
                      <RelChip tone="green" href={`/dashboard/payments/credit-notes/${n.resolvedBy.id}`}>{n.resolvedBy.noteNumber}</RelChip>
                    ) : (
                      <RelChip tone="amber">{t("relReturnedWaiting")}</RelChip>
                    )
                  ) : n.resolution === "INSTALLED" ? (
                    <RelChip tone="blue">{t("resolutionInstalled")}{n.resolutionWorkOrderNo ? ` · ${n.resolutionWorkOrderNo}` : ""}</RelChip>
                  ) : n.resolution === "LOSS" ? (
                    <RelChip tone="gray">{t("resolutionLoss")}</RelChip>
                  ) : (
                    <RelChip tone="amber">{t("relOpenChip")}</RelChip>
                  )}
                </td>
                <td className="p-3"><StatusBadge status={n.status} /></td>
                <td className="p-3">
                  <div className="flex items-center justify-end gap-3">
                    {/* Apply solo cuando puede funcionar: sin pago enlazado terminaba siempre en
                        error (y antes del arreglo, en un Applied mentiroso). El enlace se pone en
                        View/Edit. */}
                    {n.status === "Active" && n.relatedPaymentId && (
                      <button onClick={() => handleApply(n.id)} className="text-blue-600 text-xs">{t("apply")}</button>
                    )}
                    {n.status !== "Void" && n.status !== "Cancelled" && (
                      <button onClick={() => handleVoid(n.id)} className="text-red-500 text-xs">{t("voidNote")}</button>
                    )}
                    <Link href={`/dashboard/payments/debit-notes/${n.id}`} className="text-gray-600 text-xs">{tc("viewEdit")}</Link>
                  </div>
                </td>
              </tr>
            ))}
            {visibleNotes.length === 0 && !error && (
              <tr><td className="p-3 text-gray-500" colSpan={12}>{t("noRecords")}</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
