"use client";

import { useEffect, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import Image from "next/image";
import { getPublicInvoice } from "@/lib/api";

const PERSONAL_SECTIONS = ["customer", "vehicle", "workOrder", "parts", "labor", "calibration", "longTrip", "tax", "total", "paid", "balance", "customerNotes"];
const INSURANCE_SECTIONS = ["insuranceCompany", "policyNumber", "claimNumber", "vehicle", "labor", "calibration", "flatRateKit", "claimTotal", "deductible", "insuranceResponsibility", "customerResponsibility", "totalClaimValue", "customerNotes"];

function activeSections(invoice) {
  if (invoice.template === "Custom") {
    return new Set(Object.entries(invoice.customSections || {}).filter(([, v]) => v).map(([k]) => k));
  }
  return new Set(invoice.template === "Insurance" ? INSURANCE_SECTIONS : PERSONAL_SECTIONS);
}

function money(n) {
  return `$${Number(n || 0).toFixed(2)}`;
}

function Row({ label, value, emphasis }) {
  return (
    <div className={`flex justify-between ${emphasis ? "font-semibold text-base pt-2 border-t" : ""}`}>
      <span className={emphasis ? "" : "text-gray-500"}>{label}</span>
      <span>{value}</span>
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

  if (error) return <div className="min-h-screen flex items-center justify-center text-red-600 dark:text-red-400 text-sm">{error}</div>;
  if (!invoice) return <div className="min-h-screen flex items-center justify-center text-gray-500 text-sm">{"..."}</div>;

  const publicUrl = typeof window !== "undefined" ? window.location.href.split("?")[0] : "";
  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=120x120&data=${encodeURIComponent(publicUrl)}`;
  const sections = activeSections(invoice);
  const breakdown = invoice.breakdown || {};
  const vehicleText = [invoice.vehicle?.year, invoice.vehicle?.make, invoice.vehicle?.model].filter(Boolean).join(" ");

  return (
    <div className="min-h-screen bg-gray-100 py-8 px-4 print:bg-white print:p-0">
      <div className="max-w-3xl mx-auto bg-white dark:bg-gray-900 dark:border dark:border-gray-800 rounded-xl shadow-sm print:shadow-none print:rounded-none p-8">
        <div className="flex justify-between items-start mb-8 print:hidden">
          <div />
          <button onClick={() => window.print()} className="bg-gray-900 hover:bg-gray-800 dark:bg-blue-600 dark:hover:bg-blue-700 text-white rounded-lg transition-colors px-4 py-2 text-sm">
            {t("printSave")}
          </button>
        </div>

        <div className="flex justify-between items-start mb-8">
          <div className="w-32">
            <Image src="/logo.png" alt="Reyes Auto Glass Group" width={200} height={200} className="w-full h-auto" />
          </div>
          <div className="text-right">
            <h1 className="text-2xl font-bold">{t("invoice")}</h1>
            <div className="text-sm text-gray-500">{invoice.invoiceNumber}</div>
            <span className="inline-block mt-1 text-xs font-medium rounded-full px-2 py-1 bg-gray-100 text-gray-700">
              {t(`statuses.${invoice.status}`)}
            </span>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-6 mb-8 text-sm">
          <div>
            {sections.has("customer") && (
              <>
                <div className="text-xs text-gray-400 uppercase mb-1">{t("billToLabel")}</div>
                <div className="font-medium">{invoice.customerName}</div>
                <div>{invoice.customerPhone}</div>
                <div>{invoice.customerEmail}</div>
              </>
            )}
            {sections.has("insuranceCompany") && breakdown.insuranceCompanyName && (
              <div className="mt-2">
                <div className="text-xs text-gray-400 uppercase mb-1">{t("insuranceCompany")}</div>
                <div className="font-medium">{breakdown.insuranceCompanyName}</div>
              </div>
            )}
            {sections.has("policyNumber") && breakdown.policyNumber && <div>{t("policyNumber")}: {breakdown.policyNumber}</div>}
            {sections.has("claimNumber") && invoice.claimNumber && <div>{t("claimNumber")}: {invoice.claimNumber}</div>}
          </div>
          <div className="text-right">
            <div><span className="text-gray-400">{t("invoiceDate")}: </span>{invoice.invoiceDate}</div>
            {invoice.dueDate && <div><span className="text-gray-400">{t("dueDate")}: </span>{invoice.dueDate}</div>}
            {sections.has("workOrder") && <div><span className="text-gray-400">{t("workOrder")}: </span>{invoice.workOrderNo}</div>}
            {sections.has("vehicle") && vehicleText && (
              <div><span className="text-gray-400">{t("vehicle")}: </span>{vehicleText}</div>
            )}
          </div>
        </div>

        {(sections.has("parts") || sections.has("labor") || sections.has("calibration") || sections.has("longTrip") ||
          sections.has("flatRateKit") || sections.has("claimTotal") || sections.has("deductible") ||
          sections.has("insuranceResponsibility") || sections.has("customerResponsibility") || sections.has("totalClaimValue")) && (
          <div className="mb-6">
            <div className="text-xs text-gray-400 uppercase mb-2 border-b-2 dark:border-gray-800 pb-1">{t("orderDetails")}</div>
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
                <tr className="text-left border-b-2 dark:border-gray-800">
                  <th className="py-2">{t("description")}</th>
                  <th className="py-2 text-right">{t("quantity")}</th>
                  <th className="py-2 text-right">{t("unitPrice")}</th>
                  <th className="py-2 text-right">{t("total")}</th>
                </tr>
              </thead>
              <tbody>
                {invoice.items.map((item) => (
                  <tr key={item.id} className="border-b">
                    <td className="py-2">{item.description}</td>
                    <td className="py-2 text-right">{item.quantity}</td>
                    <td className="py-2 text-right">{money(item.unitPrice)}</td>
                    <td className="py-2 text-right">{money(Number(item.quantity || 0) * Number(item.unitPrice || 0))}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div className="flex justify-end mb-8">
              <div className="w-56 space-y-1 text-sm">
                <div className="flex justify-between"><span className="text-gray-500">{t("subtotal")}</span><span>{money(invoice.subtotal)}</span></div>
                <div className="flex justify-between"><span className="text-gray-500">{t("tax")}</span><span>{money(invoice.tax)}</span></div>
                <div className="flex justify-between"><span className="text-gray-500">{t("discount")}</span><span>-{money(invoice.discount)}</span></div>
                {sections.has("total") && <Row label={t("total")} value={money(invoice.total)} emphasis />}
                {sections.has("paid") && <Row label={t("amountPaid")} value={money(invoice.amountPaid)} />}
                {sections.has("balance") && <div className="flex justify-between font-semibold text-green-700"><span>{t("balance")}</span><span>{money(invoice.balance)}</span></div>}
              </div>
            </div>
          </>
        )}

        {sections.has("customerNotes") && invoice.notes && (
          <div className="mb-6 text-sm">
            <div className="text-xs text-gray-400 uppercase mb-1">{t("notesLabel")}</div>
            <p className="whitespace-pre-wrap">{invoice.notes}</p>
          </div>
        )}

        <div className="flex justify-between items-end border-t pt-6">
          <div className="text-xs text-gray-500 max-w-sm">
            <div className="font-semibold mb-1">{t("termsTitle")}</div>
            <p>{t("termsBody")}</p>
          </div>
          <img src={qrUrl} alt="QR" width={90} height={90} />
        </div>
      </div>
    </div>
  );
}
