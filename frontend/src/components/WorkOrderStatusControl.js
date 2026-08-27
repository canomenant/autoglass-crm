"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { getWorkOrder, updateWorkOrder } from "@/lib/api";
import {
  CANCELLATION_REASONS,
  WORK_ORDER_STATUSES,
  getNextManualWorkOrderStatus,
  isAutomaticWorkOrderStatus,
} from "@/lib/workOrderStatuses";
import { getWorkOrderStatusDotClass } from "@/lib/workOrderStatusColors";
import WorkOrderStatusBadge from "./WorkOrderStatusBadge";

function ChevronIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4 flex-shrink-0 opacity-60">
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="w-4 h-4 flex-shrink-0">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

function ArrowIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4 flex-shrink-0">
      <line x1="5" y1="12" x2="19" y2="12" /><polyline points="12 5 19 12 12 19" />
    </svg>
  );
}

// El estado de la orden de trabajo: se ve, y se cambia, sin parecer un campo de formulario.
//
// A diferencia del resto de la sección, esto NO espera al botón de guardar: cambiar el estado es una
// acción, no editar un campo, y tratarlo como un campo más era lo que lo dejaba enterrado. Se
// escribe sólo el estado (y el motivo, al cancelar), así que ningún otro campo a medio editar se
// cuela en el guardado — pero por eso mismo se bloquea mientras haya cambios sin guardar en esta
// sección: al terminar se relee la orden del servidor y esos cambios se perderían.
//
// Assigned y Paid los pone el sistema (asignar técnico / saldo a cero, ver workorders.store).
// Siguen en el menú porque una persona siempre gana, pero van marcados y nunca son un botón de
// acción rápida: invitarían a saltarse justo el paso que los dispara.
export default function WorkOrderStatusControl({ wo, dirty, onSaved }) {
  const t = useTranslations("workOrders");
  const [open, setOpen] = useState(false);
  // Qué estado se está escribiendo ahora mismo, o null. Sirve de bandera de "ocupado" y de spinner
  // en el botón concreto que se pulsó.
  const [saving, setSaving] = useState(null);
  const [error, setError] = useState("");
  const [cancelling, setCancelling] = useState(false);
  const [reason, setReason] = useState("");
  const wrapperRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    function handleClickOutside(e) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target)) setOpen(false);
    }
    function handleKey(e) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKey);
    };
  }, [open]);

  const blockedReason = dirty ? t("saveBeforeStatusChange") : "";
  const busy = saving !== null;

  async function commit(status, extra = {}) {
    setSaving(status);
    setError("");
    try {
      await updateWorkOrder(wo.id, { status, ...extra });
      // Se relee del servidor en vez de confiar en lo enviado: el estado que queda puede no ser el
      // que se pidió (Paid se adelanta solo cuando el saldo llega a cero) y cancelar o reabrir toca
      // además cancelledAt y el motivo.
      onSaved(await getWorkOrder(wo.id));
      setCancelling(false);
      setReason("");
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(null);
    }
  }

  function choose(status) {
    setOpen(false);
    if (status === wo.status) return;
    if (status === "Cancelled") {
      setCancelling(true);
      setReason(wo.cancellationReason || "");
      return;
    }
    commit(status);
  }

  const nextStatus = getNextManualWorkOrderStatus(wo.status);
  const isCancelled = wo.status === "Cancelled";

  return (
    <div>
      <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">{t("status")}</label>

      <div className="flex flex-wrap items-center gap-2">
        <div ref={wrapperRef} className="relative">
          <button
            type="button"
            onClick={() => setOpen((prev) => !prev)}
            disabled={busy || !!blockedReason}
            aria-haspopup="listbox"
            aria-expanded={open}
            className="inline-flex items-center gap-2 rounded-full border border-gray-200 dark:border-gray-700 p-1 pr-3 hover:border-gray-300 dark:hover:border-gray-600 focus:ring-2 focus:ring-blue-500 outline-none transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <WorkOrderStatusBadge status={wo.status} size="lg" variant="strong" withDot />
            <span className="text-xs text-gray-500 dark:text-gray-400">{t("changeStatus")}</span>
            <ChevronIcon />
          </button>

          {open && (
            <div role="listbox" className="absolute z-30 mt-2 w-72 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl shadow-lg py-1">
              {WORK_ORDER_STATUSES.map((s) => {
                const active = s === wo.status;
                return (
                  <button
                    key={s}
                    type="button"
                    role="option"
                    aria-selected={active}
                    onClick={() => choose(s)}
                    className={`w-full flex items-center gap-2.5 px-3 py-2 text-sm text-left transition-colors ${
                      active ? "bg-gray-50 dark:bg-gray-800 font-medium" : "hover:bg-gray-50 dark:hover:bg-gray-800"
                    } dark:text-gray-100`}
                  >
                    <span className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${getWorkOrderStatusDotClass(s)}`} />
                    <span className="flex-1">{t(`statuses.${s}`)}</span>
                    {isAutomaticWorkOrderStatus(s) && (
                      <span className="text-[10px] uppercase tracking-wide text-gray-400 dark:text-gray-500">{t("automaticStatus")}</span>
                    )}
                    {active && <CheckIcon />}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Acción rápida: el siguiente paso que de verdad decide una persona, en un clic. */}
        {nextStatus && !cancelling && (
          <button
            type="button"
            onClick={() => commit(nextStatus)}
            disabled={busy || !!blockedReason}
            title={blockedReason || undefined}
            className="inline-flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-lg transition-colors px-4 py-2 text-sm shadow-sm disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap"
          >
            {saving === nextStatus ? t("savingStatus") : t("markAs", { status: t(`statuses.${nextStatus}`) })}
            {saving !== nextStatus && <ArrowIcon />}
          </button>
        )}

        {isCancelled ? (
          <button
            type="button"
            onClick={() => commit("Scheduled")}
            disabled={busy || !!blockedReason}
            title={blockedReason || undefined}
            className="border border-gray-300 dark:border-gray-600 dark:text-gray-100 rounded-lg px-4 py-2 text-sm hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap"
          >
            {saving === "Scheduled" ? t("savingStatus") : t("reopenOrder")}
          </button>
        ) : (
          !cancelling && (
            <button
              type="button"
              onClick={() => choose("Cancelled")}
              disabled={busy || !!blockedReason}
              title={blockedReason || undefined}
              className="border border-red-200 dark:border-red-500/40 text-red-700 dark:text-red-300 rounded-lg px-4 py-2 text-sm hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap"
            >
              {t("cancelOrder")}
            </button>
          )
        )}
      </div>

      {blockedReason && <p className="text-xs text-gray-500 dark:text-gray-400 mt-1.5">{blockedReason}</p>}
      {error && <p className="text-xs text-red-600 dark:text-red-400 mt-1.5">{error}</p>}

      {/* Cancelar pide el motivo ANTES de escribir nada. Antes el motivo era un campo marcado como
          obligatorio que aparecía después de haber cambiado ya el estado, y no lo comprobaba nadie:
          se podía dejar la orden cancelada sin motivo con sólo no rellenarlo. */}
      {cancelling && (
        <div className="mt-3 border-2 border-red-200 dark:border-red-500/40 bg-red-50 dark:bg-red-500/10 rounded-lg p-3">
          <label className="block text-xs font-medium text-red-700 dark:text-red-300 mb-1">
            {t("cancellationReason")} <span className="text-red-500">*</span>
          </label>
          <select
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className="w-full border border-red-200 dark:border-red-500/40 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-3 py-2 focus:ring-2 focus:ring-red-500 focus:border-red-500 outline-none transition-shadow text-sm"
          >
            <option value="">{t("selectCancellationReason")}</option>
            {CANCELLATION_REASONS.map((r) => <option key={r} value={r}>{t(`cancellationReasons.${r}`)}</option>)}
          </select>
          <div className="flex gap-2 mt-3">
            <button
              type="button"
              onClick={() => commit("Cancelled", { cancellationReason: reason })}
              disabled={!reason || busy}
              className="bg-red-600 hover:bg-red-700 text-white font-semibold rounded-lg transition-colors px-4 py-2 text-sm disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {saving === "Cancelled" ? t("savingStatus") : t("confirmCancelOrder")}
            </button>
            <button
              type="button"
              onClick={() => { setCancelling(false); setReason(""); }}
              disabled={busy}
              className="border border-gray-300 dark:border-gray-600 dark:text-gray-100 rounded-lg px-4 py-2 text-sm disabled:opacity-40"
            >
              {t("keepOrder")}
            </button>
          </div>
        </div>
      )}

      {isCancelled && wo.cancellationReason && !cancelling && (
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">
          {t("cancellationReason")}: <span className="font-medium">{t(`cancellationReasons.${wo.cancellationReason}`)}</span>
        </p>
      )}
    </div>
  );
}
