"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { convertQuote } from "@/lib/api";
import { canConvertToWorkOrder, isConvertedStatus } from "@/lib/quoteStatuses";

function ArrowIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4 flex-shrink-0">
      <line x1="5" y1="12" x2="19" y2="12" /><polyline points="12 5 19 12 12 19" />
    </svg>
  );
}

function CheckCircleIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-5 h-5 flex-shrink-0">
      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" />
    </svg>
  );
}

// La acción principal de la pantalla: pasar la cotización a orden de trabajo. Antes era un botón
// que sólo existía si el estado era exactamente "Approved" — desde un borrador no había ni botón ni
// explicación de por qué, así que la conversión parecía no existir.
//
// Los tres estados posibles se ven todos, ninguno desaparece en silencio:
//   - ya convertida  -> el enlace a la orden que salió de aquí,
//   - convertible    -> el botón,
//   - rechazada o cancelada -> el botón deshabilitado y el motivo escrito.
export default function ConvertToWorkOrderAction({ quote, workOrder, dirty, onConverted }) {
  const t = useTranslations("quotes");
  const [converting, setConverting] = useState(false);
  const [error, setError] = useState("");

  if (isConvertedStatus(quote.status) || workOrder) {
    return (
      <div className="flex items-center gap-2 text-green-700 dark:text-green-400">
        <CheckCircleIcon />
        <div className="text-sm">
          <div className="font-semibold">{t("alreadyConverted")}</div>
          {workOrder && (
            <Link href={`/dashboard/workorders/${workOrder.id}`} className="underline hover:no-underline">
              {t("viewWorkOrderNo", { no: workOrder.workOrderNo })}
            </Link>
          )}
        </div>
      </div>
    );
  }

  const convertible = canConvertToWorkOrder(quote.status);
  // Convertir crea la orden a partir de lo que hay GUARDADO. Con cambios sin guardar la orden
  // nacería con los datos viejos y sin ninguna señal de que eso pasó, así que se espera al guardado.
  const blockedReason = !convertible ? t("cannotConvertFromStatus") : dirty ? t("saveBeforeConverting") : "";

  async function handleConvert() {
    setConverting(true);
    setError("");
    try {
      onConverted(await convertQuote(quote.id));
    } catch (e) {
      // La cotización ya tenía orden (otra pestaña, un import): no es un error que el usuario
      // pueda arreglar, es el resultado que buscaba. Se muestra la orden que ya existe.
      if (e.details?.code === "QUOTE_ALREADY_CONVERTED" && e.details.workOrder) {
        onConverted(e.details.workOrder);
        return;
      }
      setError(e.message);
    } finally {
      setConverting(false);
    }
  }

  return (
    <div className="flex flex-col items-start sm:items-end gap-1">
      <button
        type="button"
        onClick={handleConvert}
        disabled={!!blockedReason || converting}
        title={blockedReason || undefined}
        className="inline-flex items-center gap-2 bg-green-600 hover:bg-green-700 text-white font-semibold rounded-lg transition-colors px-5 py-2.5 text-sm shadow-sm disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap"
      >
        {converting ? t("converting") : t("convertToWorkOrder")}
        {!converting && <ArrowIcon />}
      </button>
      {blockedReason && <span className="text-xs text-gray-500 dark:text-gray-400">{blockedReason}</span>}
      {error && <span className="text-xs text-red-600 dark:text-red-400">{error}</span>}
    </div>
  );
}
