"use client";

// Página pública de garantía: el texto que Antonio capture en Settings → Company Profile. La
// factura enlaza aquí cuando no hay una página de garantía en el sitio web (warrantyUrl vacío).
// Siempre en blanco, como papel, sin importar el tema del navegador del cliente (por eso no lleva
// clases dark: y fija sus propios colores).

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { getPublicCompanyProfile } from "@/lib/api";

export default function WarrantyPage() {
  const t = useTranslations("invoices");
  const [company, setCompany] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    getPublicCompanyProfile().then(setCompany).catch((e) => setError(e.message));
  }, []);

  if (error) return <div className="min-h-screen bg-gray-100 flex items-center justify-center text-red-600 text-sm">{error}</div>;
  if (!company) return <div className="min-h-screen bg-gray-100 flex items-center justify-center text-gray-500 text-sm">{"..."}</div>;

  const ciudad = (company.city || company.zip) ? [company.city, [company.state, company.zip].filter(Boolean).join(" ")].filter(Boolean).join(", ") : "";
  const direccion = [company.address, ciudad].filter(Boolean).join(", ");

  return (
    <div className="min-h-screen bg-gray-100 py-8 px-4 text-gray-900">
      <div className="max-w-3xl mx-auto bg-white rounded-xl shadow-sm p-8">
        <div className="flex items-center gap-4 mb-6 border-b-2 border-gray-900 pb-4">
          <img src="/logo-print.png" alt={company.name} className="w-28 h-auto" />
          <div>
            <div className="font-bold text-lg">{company.name}</div>
            {direccion && <div className="text-xs text-gray-500">{direccion}</div>}
            <div className="text-xs text-gray-500">{[company.phone, company.email].filter(Boolean).join(" · ")}</div>
          </div>
        </div>
        <h1 className="text-2xl font-bold mb-4">{company.warrantyTitle || t("warranty")}</h1>
        {company.warrantyText ? (
          <div className="text-sm whitespace-pre-wrap leading-relaxed">{company.warrantyText}</div>
        ) : (
          <p className="text-sm text-gray-500">{t("warrantyEmpty")}</p>
        )}
        {company.licenseNumber && (
          <p className="text-xs text-gray-500 mt-8 border-t pt-4">{company.licenseLabel} {company.licenseNumber}</p>
        )}
      </div>
    </div>
  );
}
