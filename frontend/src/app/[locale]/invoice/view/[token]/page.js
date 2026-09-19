"use client";

import { useEffect, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import Image from "next/image";
import { getPublicInvoice } from "@/lib/api";

// Factura pública (la ve el cliente por link, sin login). Antonio, 19-sep-2026:
//  - SIEMPRE en blanco como papel: sin clases dark:, el tema del navegador del cliente no manda.
//  - Los datos de la empresa (dirección, teléfono, licencia, garantía, términos) salen de
//    Settings → Company Profile y viajan dentro de invoice.company.
//  - Nunca el costo real de la parte: en particulares no hay desglose Parts/Labor ni impuesto
//    aparte (va dentro del renglón); en aseguranza sí, porque son precios de lista NAGS.

const PERSONAL_SECTIONS = ["customer", "vehicle", "workOrder", "parts", "labor", "calibration", "longTrip", "tax", "total", "paid", "balance", "customerNotes"];
const INSURANCE_SECTIONS = ["insuranceCompany", "policyNumber", "claimNumber", "vehicle", "labor", "calibration", "flatRateKit", "claimTotal", "deductible", "insuranceResponsibility", "customerResponsibility", "totalClaimValue", "customerNotes"];

function activeSections(invoice) {
  if (invoice.template === "Custom") {
    return new Set(Object.entries(invoice.customSections || {}).filter(([, v]) => v).map(([k]) => k));
  }
  return new Set(invoice.template === "Insurance" ? INSURANCE_SECTIONS : PERSONAL_SECTIONS);
}

// Teléfonos como (###) ###-#### (Antonio, 19-sep-2026); lo que no sea un número de 10 dígitos se deja igual.
function phone(v) {
  const d = String(v || "").replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "");
  return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : String(v || "");
}

// Google Places guarda la dirección con el país al final (", EE. UU." o ", USA"); en la factura sobra.
function address(v) {
  return String(v || "").replace(/,?\s*(EE\.?\s*UU\.?|USA|United States|Estados Unidos)\s*$/i, "").trim();
}

function money(n) {
  return `$${Number(n || 0).toFixed(2)}`;
}

function Row({ label, value, emphasis }) {
  return (
    <div className={`flex justify-between ${emphasis ? "font-semibold text-base pt-2 border-t border-gray-300" : ""}`}>
      <span className={emphasis ? "" : "text-gray-500"}>{label}</span>
      <span>{value}</span>
    </div>
  );
}

function Dato({ label, value }) {
  if (!value) return null;
  return (
    <div className="flex gap-2">
      <span className="text-gray-400 w-16 shrink-0">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}

export default function PublicInvoicePage() {
  const { token } = useParams();
  const searchParams = useSearchParams();
  const t = useTranslations("invoices");
  const [invoice, setInvoice] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    getPublicInvoice(token).then(setInvoice).catch((e) => setError(e.message));
  }, [token]);

  useEffect(() => {
    if (invoice && searchParams.get("print") === "1") {
      setTimeout(() => window.print(), 400);
    }
  }, [invoice, searchParams]);

  if (error) return <div className="min-h-screen bg-gray-100 flex items-center justify-center text-red-600 text-sm">{error}</div>;
  if (!invoice) return <div className="min-h-screen bg-gray-100 flex items-center justify-center text-gray-500 text-sm">{"..."}</div>;

  const company = invoice.company || {};
  const sections = activeSections(invoice);
  // El desglose Parts/Labor de la cotización solo tiene sentido en aseguranza (precios NAGS de lista).
  // En una factura de particular "Parts $162.61" es exactamente el costo del vidrio.
  if (invoice.template !== "Insurance") for (const k of ["parts", "labor", "calibration", "longTrip"]) sections.delete(k);
  const breakdown = invoice.breakdown || {};
  const v = invoice.vehicle || {};
  const vehicleText = [v.year, v.make, v.model].filter(Boolean).join(" ");
  // Muchas órdenes traen la dirección completa en una línea (Google Places) y solo el estado aparte:
  // sin ciudad ni ZIP, una segunda línea "CA" sola no dice nada.
  const customerCityLine = (invoice.customerCity || invoice.customerZip)
    ? [invoice.customerCity, [invoice.customerState, invoice.customerZip].filter(Boolean).join(" ")].filter(Boolean).join(", ")
    : "";
  const companyCityLine = (company.city || company.zip) ? [company.city, [company.state, company.zip].filter(Boolean).join(" ")].filter(Boolean).join(", ") : "";
  const companyContact = [company.phone, company.altPhone].filter(Boolean).map(phone).join(" · ");
  // El sello PAID va por lo cobrado, no por el estado interno: un borrador ya pagado se ve pagado.
  const isPaid = invoice.status !== "Void" && (invoice.status === "Paid" || (Number(invoice.total) > 0 && Number(invoice.balance) <= 0));
  const warrantyHref = company.warrantyUrl || (typeof window !== "undefined" ? `${window.location.origin}/warranty` : "/warranty");
  const payments = (invoice.payments || []).filter((p) => Number(p.amount) > 0);

  return (
    <div className="min-h-screen bg-gray-100 text-gray-900 py-8 px-4 print:bg-white print:p-0">
      <div className="max-w-3xl mx-auto bg-white rounded-xl shadow-sm print:shadow-none print:rounded-none p-8 relative">
        <div className="flex justify-end mb-6 print:hidden">
          <button onClick={() => window.print()} className="bg-gray-900 hover:bg-gray-800 text-white rounded-lg transition-colors px-4 py-2 text-sm">
            {t("printSave")}
          </button>
        </div>

        {/* Encabezado: logo grande + datos de la empresa | INVOICE, número, fecha, sello PAID */}
        <div className="flex justify-between items-start gap-6 mb-8 border-b-2 border-gray-900 pb-6">
          <div className="flex items-start gap-4">
            <div className="w-40 shrink-0">
              {/* logo-print.png: sin fondo negro, blanco → carbón (Antonio eligió la opción B, 19-sep-2026).
                  Es el logo para todo papel que se imprime; el CRM (menú, login) sigue con logo.png. */}
              <Image src="/logo-print.png" alt={company.name || "Reyes Auto Glass Group"} width={1027} height={846} className="w-full h-auto" priority />
            </div>
            <div className="text-sm pt-1">
              <div className="font-bold text-lg leading-tight">{company.name || "Reyes Auto Glass Group"}</div>
              {company.tagline && <div className="text-xs text-gray-500 mb-1">{company.tagline}</div>}
              {company.address && <div>{company.address}</div>}
              {companyCityLine && <div>{companyCityLine}</div>}
              {companyContact && <div>{companyContact}</div>}
              {company.email && <div>{company.email}</div>}
              {company.website && <div className="text-gray-500">{company.website}</div>}
              {company.licenseNumber && <div className="text-xs text-gray-500 mt-1">{company.licenseLabel} {company.licenseNumber}</div>}
            </div>
          </div>
          <div className="text-right shrink-0">
            <h1 className="text-3xl font-bold tracking-tight">{t("invoice").toUpperCase()}</h1>
            <div className="text-sm text-gray-500 font-medium">{invoice.invoiceNumber}</div>
            <div className="text-sm mt-3"><span className="text-gray-400">{t("invoiceDate")}: </span>{invoice.invoiceDate}</div>
            {invoice.dueDate && <div className="text-sm"><span className="text-gray-400">{t("dueDate")}: </span>{invoice.dueDate}</div>}
            {sections.has("workOrder") && <div className="text-sm"><span className="text-gray-400">{t("workOrder")}: </span>{invoice.workOrderNo}</div>}
            {isPaid && (
              <div className="inline-block mt-3 border-4 border-green-600 text-green-600 font-black text-xl tracking-widest px-3 py-1 rounded -rotate-6">
                {t("paidStamp")}
              </div>
            )}
            {invoice.status === "Void" && (
              <div className="inline-block mt-3 border-4 border-gray-500 text-gray-500 font-black text-xl tracking-widest px-3 py-1 rounded -rotate-6">
                {t("statuses.Void").toUpperCase()}
              </div>
            )}
          </div>
        </div>

        {/* Cliente | Vehículo */}
        <div className="grid grid-cols-2 gap-6 mb-8 text-sm">
          <div>
            {sections.has("customer") && (
              <>
                <div className="text-xs text-gray-400 uppercase tracking-wider mb-1">{t("billToLabel")}</div>
                <div className="font-semibold text-base">{invoice.customerName}</div>
                {invoice.customerAddress && <div>{address(invoice.customerAddress)}</div>}
                {customerCityLine && <div>{customerCityLine}</div>}
                {invoice.customerPhone && <div>{phone(invoice.customerPhone)}</div>}
                {invoice.customerEmail && <div>{invoice.customerEmail}</div>}
              </>
            )}
            {sections.has("insuranceCompany") && breakdown.insuranceCompanyName && (
              <div className="mt-3">
                <div className="text-xs text-gray-400 uppercase tracking-wider mb-1">{t("insuranceCompany")}</div>
                <div className="font-medium">{breakdown.insuranceCompanyName}</div>
              </div>
            )}
            {sections.has("policyNumber") && breakdown.policyNumber && <div>{t("policyNumber")}: {breakdown.policyNumber}</div>}
            {sections.has("claimNumber") && invoice.claimNumber && <div>{t("claimNumber")}: {invoice.claimNumber}</div>}
          </div>
          {sections.has("vehicle") && (vehicleText || v.vin || v.plate) && (
            <div>
              <div className="text-xs text-gray-400 uppercase tracking-wider mb-1">{t("vehicle")}</div>
              {vehicleText && <div className="font-semibold text-base">{vehicleText}</div>}
              <div className="space-y-0.5 mt-1">
                <Dato label={t("bodyType")} value={v.bodyType} />
                <Dato label={t("vin")} value={v.vin} />
                <Dato label={t("plate")} value={v.plate} />
                {invoice.technician && <Dato label={t("technician")} value={invoice.technician} />}
              </div>
            </div>
          )}
        </div>

        {(sections.has("parts") || sections.has("labor") || sections.has("calibration") || sections.has("longTrip") ||
          sections.has("flatRateKit") || sections.has("claimTotal") || sections.has("deductible") ||
          sections.has("insuranceResponsibility") || sections.has("customerResponsibility") || sections.has("totalClaimValue")) && (
          <div className="mb-6">
            <div className="text-xs text-gray-400 uppercase tracking-wider mb-2 border-b-2 border-gray-200 pb-1">{t("orderDetails")}</div>
            <div className="space-y-1.5 text-sm">
              {sections.has("parts") && <Row label={t("parts")} value={money(breakdown.partsAmount)} />}
              {sections.has("labor") && <Row label={t("labor")} value={money(breakdown.laborAmount)} />}
              {sections.has("calibration") && <Row label={t("calibration")} value={money(breakdown.calibration)} />}
              {sections.has("longTrip") && <Row label={t("longTrip")} value={money(breakdown.longTripFee)} />}
              {sections.has("flatRateKit") && <Row label={t("flatRateKit")} value={money(breakdown.flatRateKit)} />}
              {sections.has("claimTotal") && <Row label={t("claimTotal")} value={money(breakdown.claimTotal)} />}
              {sections.has("claimTotal") && breakdown.insuranceAdjustmentAmount !== 0 && (
                <Row label={t("insuranceAdjustment")} value={money(breakdown.insuranceAdjustmentAmount)} />
              )}
              {sections.has("deductible") && <Row label={t("deductible")} value={money(breakdown.deductible)} />}
              {sections.has("insuranceResponsibility") && <Row label={t("insuranceResponsibility")} value={money(breakdown.insuranceResponsibility)} />}
              {sections.has("customerResponsibility") && <Row label={t("customerResponsibility")} value={money(breakdown.customerResponsibility)} emphasis />}
              {sections.has("totalClaimValue") && <Row label={t("totalClaimValue")} value={money(breakdown.totalClaimValue)} emphasis />}
            </div>
          </div>
        )}

        {(sections.has("total") || sections.has("paid") || sections.has("balance")) && (
          <>
            <table className="w-full text-sm mb-6">
              <thead>
                <tr className="text-left border-b-2 border-gray-900">
                  <th className="py-2">{t("description")}</th>
                  <th className="py-2 text-right">{t("quantity")}</th>
                  <th className="py-2 text-right">{t("unitPrice")}</th>
                  <th className="py-2 text-right">{t("total")}</th>
                </tr>
              </thead>
              <tbody>
                {invoice.items.map((item) => (
                  <tr key={item.id} className="border-b border-gray-200">
                    <td className="py-2">{item.description}</td>
                    <td className="py-2 text-right">{item.quantity}</td>
                    <td className="py-2 text-right">{money(item.unitPrice)}</td>
                    <td className="py-2 text-right">{money(Number(item.quantity || 0) * Number(item.unitPrice || 0))}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div className="flex justify-between items-start gap-6 mb-8">
              {/* Pagos recibidos: fecha y método, para que el cliente vea con qué se saldó. */}
              <div className="text-sm text-gray-600 flex-1">
                {payments.length > 0 && sections.has("paid") && (
                  <>
                    <div className="text-xs text-gray-400 uppercase tracking-wider mb-1">{t("paymentsReceived")}</div>
                    {payments.map((p) => (
                      <div key={p.id}>{[p.paymentDate, p.paymentMethod].filter(Boolean).join(" · ")} — {money(p.amount)}</div>
                    ))}
                  </>
                )}
              </div>
              <div className="w-60 space-y-1 text-sm">
                {/* Todo incluido: sin subtotal ni impuesto aparte (van dentro del renglón), con la leyenda
                    de impuesto incluido. Mostrar el impuesto delataría el costo de la parte. */}
                {!invoice.taxIncluded && (
                  <>
                    <div className="flex justify-between"><span className="text-gray-500">{t("subtotal")}</span><span>{money(invoice.subtotal)}</span></div>
                    <div className="flex justify-between"><span className="text-gray-500">{t("tax")}</span><span>{money(invoice.tax)}</span></div>
                  </>
                )}
                {Number(invoice.discount) > 0 && (
                  <div className="flex justify-between"><span className="text-gray-500">{t("discount")}</span><span>-{money(invoice.discount)}</span></div>
                )}
                {sections.has("total") && <Row label={t("total")} value={money(invoice.total)} emphasis />}
                {sections.has("paid") && <Row label={t("amountPaid")} value={money(invoice.amountPaid)} />}
                {sections.has("balance") && (
                  <div className={`flex justify-between font-semibold ${Number(invoice.balance) > 0 ? "text-red-700" : "text-green-700"}`}>
                    <span>{t("balance")}</span><span>{money(invoice.balance)}</span>
                  </div>
                )}
                {invoice.taxIncluded && <p className="text-xs text-gray-500 pt-1 text-right">{t("taxIncludedNote")}</p>}
              </div>
            </div>
          </>
        )}

        {sections.has("customerNotes") && invoice.notes && (
          <div className="mb-6 text-sm">
            <div className="text-xs text-gray-400 uppercase tracking-wider mb-1">{t("notesLabel")}</div>
            <p className="whitespace-pre-wrap">{invoice.notes}</p>
          </div>
        )}

        {/* Pie: garantía, instrucciones de pago, términos, gracias */}
        <div className="border-t-2 border-gray-900 pt-5 text-xs text-gray-600 space-y-3">
          <div className="flex flex-wrap gap-x-6 gap-y-1">
            <div>
              <span className="font-semibold text-gray-800">{t("warranty")}: </span>
              {company.warrantyTitle && <span>{company.warrantyTitle} — </span>}
              <a href={warrantyHref} target="_blank" rel="noreferrer" className="text-blue-700 underline">{t("warrantyLink")}</a>
            </div>
          </div>
          {company.paymentInstructions && (
            <div>
              <div className="font-semibold text-gray-800 mb-0.5">{t("paymentInstructions")}</div>
              <p className="whitespace-pre-wrap">{company.paymentInstructions}</p>
            </div>
          )}
          <div>
            <div className="font-semibold text-gray-800 mb-0.5">{t("termsTitle")}</div>
            <p className="whitespace-pre-wrap">{company.invoiceTerms || t("termsBody")}</p>
          </div>
          <div className="flex flex-wrap justify-between gap-2 pt-2 border-t border-gray-200 text-gray-500">
            <span>{company.invoiceFooter}</span>
            <span>{[company.name, phone(company.phone), company.email].filter(Boolean).join(" · ")}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
