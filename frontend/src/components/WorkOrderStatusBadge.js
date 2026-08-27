"use client";

import { useTranslations } from "next-intl";
import {
  getWorkOrderStatusColorClass,
  getWorkOrderStatusDotClass,
  getWorkOrderStatusStrongClass,
} from "@/lib/workOrderStatusColors";

const SIZES = {
  sm: "text-xs px-2 py-1 gap-1.5",
  md: "text-sm px-3 py-1.5 gap-2",
  lg: "text-sm font-semibold px-4 py-2 gap-2",
};

// Gemela de QuoteStatusBadge, con la paleta de las órdenes de trabajo. `variant="strong"` añade
// borde y, en Paid, fondo sólido — ese es el único que va en sólido, igual que Converted en las
// cotizaciones: el hito que se busca de un vistazo.
export default function WorkOrderStatusBadge({ status, size = "sm", variant = "soft", withDot = false, className = "" }) {
  const t = useTranslations("workOrders");
  const solid = variant === "strong" && status === "Paid";
  const colors = variant === "strong" ? `border ${getWorkOrderStatusStrongClass(status)}` : getWorkOrderStatusColorClass(status);

  return (
    <span className={`inline-flex items-center rounded-full font-medium whitespace-nowrap ${SIZES[size] || SIZES.sm} ${colors} ${className}`}>
      {withDot && (
        <span className={`w-2 h-2 rounded-full flex-shrink-0 ${solid ? "bg-white" : getWorkOrderStatusDotClass(status)}`} />
      )}
      {t(`statuses.${status}`)}
    </span>
  );
}
