"use client";

import { useTranslations } from "next-intl";
import { getQuoteStatusColorClass, getQuoteStatusDotClass, getQuoteStatusStrongClass } from "@/lib/quoteStatusColors";

const SIZES = {
  sm: "text-xs px-2 py-1 gap-1.5",
  md: "text-sm px-3 py-1.5 gap-2",
  lg: "text-sm font-semibold px-4 py-2 gap-2",
};

// La pastilla de estado de una cotización. `variant="strong"` añade borde y, en Converted, fondo
// sólido: es la que se usa donde el estado tiene que verse antes que nada (cabecera de la
// cotización). `soft` es la de siempre, para tablas.
export default function QuoteStatusBadge({ status, size = "sm", variant = "soft", withDot = false, className = "" }) {
  const t = useTranslations("quotes");
  const colors = variant === "strong" ? `border ${getQuoteStatusStrongClass(status)}` : getQuoteStatusColorClass(status);

  return (
    <span className={`inline-flex items-center rounded-full font-medium whitespace-nowrap ${SIZES[size] || SIZES.sm} ${colors} ${className}`}>
      {withDot && (
        <span
          className={`w-2 h-2 rounded-full flex-shrink-0 ${
            variant === "strong" && status === "Converted" ? "bg-white" : getQuoteStatusDotClass(status)
          }`}
        />
      )}
      {t(`statuses.${status}`)}
    </span>
  );
}
