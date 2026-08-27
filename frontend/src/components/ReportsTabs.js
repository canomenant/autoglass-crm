"use client";

import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";

// La barra de pestañas de Reports, en un solo sitio. Estaba copiada en cada página del módulo, y
// añadir una pestaña significaba tocarlas todas — con el Reporte Detallado ya fueron cinco ediciones
// idénticas, y con el mapa habrían sido seis.
const TABS = [
  { key: "overview", href: "/dashboard/reports", label: (t) => t.reports("overviewTab") },
  { key: "profitLoss", href: "/dashboard/reports/profit-loss", label: (t) => t.reports("profitLoss") },
  { key: "matrix", href: "/dashboard/reports/profit-loss-matrix", label: (t) => t.profitLoss("matrixTab") },
  { key: "partners", href: "/dashboard/reports/partners", label: (t) => t.reports("partnersTab") },
  { key: "detailed", href: "/dashboard/reports/detailed", label: (t) => t.detailedReport("tab") },
  { key: "map", href: "/dashboard/reports/map", label: (t) => t.jobsMap("tab") },
];

export default function ReportsTabs({ active }) {
  const t = {
    reports: useTranslations("reports"),
    profitLoss: useTranslations("profitLoss"),
    detailedReport: useTranslations("detailedReport"),
    jobsMap: useTranslations("jobsMap"),
  };

  return (
    <div className="flex items-center gap-4 border-b border-slate-200 dark:border-gray-800 text-sm overflow-x-auto print:hidden">
      {TABS.map((tab) =>
        tab.key === active ? (
          <span key={tab.key} className="px-1 py-2 font-medium text-slate-900 dark:text-gray-100 border-b-2 border-blue-600 whitespace-nowrap">
            {tab.label(t)}
          </span>
        ) : (
          <Link key={tab.key} href={tab.href} className="px-1 py-2 text-gray-500 hover:text-gray-900 dark:hover:text-gray-200 whitespace-nowrap">
            {tab.label(t)}
          </Link>
        )
      )}
    </div>
  );
}
