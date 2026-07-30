"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { getInvoices, createInvoiceFromWorkOrder, sendInvoice } from "@/lib/api";

const STATUS_COLORS = {
  Draft: "bg-gray-200 text-gray-600",
  Sent: "bg-blue-100 text-blue-700",
  Viewed: "bg-purple-100 text-purple-700",
  Partially_Paid: "bg-amber-100 text-amber-700",
  Paid: "bg-green-100 text-green-700",
  Overdue: "bg-red-100 text-red-700",
  Void: "bg-gray-200 text-gray-600",
};

function money(n) {
  return `$${Number(n || 0).toFixed(2)}`;
}

export default function InvoicePanel({ workOrder }) {
  const t = useTranslations("invoices");
  const [invoice, setInvoice] = useState(undefined);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  function load() {
    getInvoices({ workOrderId: workOrder.id })
      .then((list) => setInvoice(list[0] || null))
      .catch((e) => setError(e.message));
  }

  useEffect(() => {
    if (workOrder?.id) load();
  }, [workOrder?.id]);

  async function handleCreate() {
    try {
      const created = await createInvoiceFromWorkOrder(workOrder.id);
      setInvoice(created);
    } catch (e) {
      setError(e.message);
    }
  }

  async function handleSend() {
    try {
      const updated = await sendInvoice(invoice.id);
      setInvoice(updated);
    } catch (e) {
      setError(e.message);
    }
  }

  function publicUrl() {
    return `${window.location.origin}/invoice/view/${invoice.publicToken}`;
  }

  function handleCopyLink() {
    navigator.clipboard.writeText(publicUrl()).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  function handleDownloadPdf() {
    window.open(`${publicUrl()}?print=1`, "_blank");
  }

  if (invoice === undefined) return null;

  return (
    <section className="bg-white dark:bg-gray-900 dark:border dark:border-gray-800 rounded-xl shadow-sm p-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className="font-semibold">{t("title")}</h2>
        {!invoice && (
          <button type="button" onClick={handleCreate} className="bg-gray-900 hover:bg-gray-800 dark:bg-blue-600 dark:hover:bg-blue-700 text-white rounded-lg transition-colors px-4 py-2 text-sm">
            {t("createInvoice")}
          </button>
        )}
      </div>

      {error && <p className="text-red-600 dark:text-red-400 text-sm mb-3">{error}</p>}

      {!invoice ? (
        <p className="text-sm text-gray-500">{t("noInvoiceYet")}</p>
      ) : (
        <div className="flex flex-wrap items-center gap-4">
          <div>
            <div className="text-xs text-gray-500">{t("invoiceNumber")}</div>
            <div className="font-semibold">{invoice.invoiceNumber}</div>
          </div>
          <div>
            <div className="text-xs text-gray-500">{t("status")}</div>
            <span className={`text-xs font-medium rounded-full px-2 py-1 ${STATUS_COLORS[invoice.status] || "bg-gray-100 text-gray-600"}`}>
              {t(`statuses.${invoice.status}`)}
            </span>
          </div>
          <div>
            <div className="text-xs text-gray-500">{t("balance")}</div>
            <div className="font-semibold">{money(invoice.balance)}</div>
          </div>
          <div className="flex flex-wrap gap-2 ml-auto">
            <Link href={`/dashboard/invoices/${invoice.id}`} className="border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-shadow text-xs">
              {t("viewEdit")}
            </Link>
            <button type="button" onClick={handleDownloadPdf} className="border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-shadow text-xs">
              {t("downloadPdf")}
            </button>
            <button type="button" onClick={handleCopyLink} className="border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-shadow text-xs">
              {copied ? t("linkCopied") : t("copyLink")}
            </button>
            {invoice.status === "Draft" && (
              <button type="button" onClick={handleSend} className="bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors px-3 py-2 text-xs">
                {t("sendInvoice")}
              </button>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
