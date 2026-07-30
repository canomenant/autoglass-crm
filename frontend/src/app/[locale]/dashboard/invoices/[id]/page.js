"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import {
  getInvoice,
  updateInvoice,
  sendInvoice,
  recordInvoicePayment,
  voidInvoice,
  getInsuranceCompanies,
  getCurrentUser,
} from "@/lib/api";

const TEMPLATES = ["Personal", "Insurance", "Custom"];
const SECTION_KEYS = [
  "customer", "vehicle", "workOrder",
  "insuranceCompany", "policyNumber", "claimNumber",
  "parts", "labor", "calibration", "longTrip", "tax",
  "flatRateKit", "claimTotal", "deductible", "insuranceResponsibility", "customerResponsibility", "totalClaimValue",
  "total", "paid", "balance",
  "customerNotes",
];

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

export default function InvoiceEditorPage() {
  const { id } = useParams();
  const t = useTranslations("invoices");
  const tc = useTranslations("common");
  const [invoice, setInvoice] = useState(null);
  const [companies, setCompanies] = useState([]);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [copied, setCopied] = useState(false);
  const [paymentForm, setPaymentForm] = useState({ paymentDate: "", paymentMethod: "", referenceNumber: "", amount: 0, notes: "" });

  function load() {
    getInvoice(id).then(setInvoice).catch((e) => setError(e.message));
  }

  useEffect(load, [id]);
  useEffect(() => {
    getInsuranceCompanies().then(setCompanies).catch(() => {});
  }, []);

  function set(field, value) {
    setInvoice((prev) => ({ ...prev, [field]: value }));
  }

  function setSplit(field, value) {
    setInvoice((prev) => ({ ...prev, splitBilling: { ...prev.splitBilling, [field]: value } }));
  }

  function setCustomSection(key, value) {
    setInvoice((prev) => ({ ...prev, customSections: { ...prev.customSections, [key]: value } }));
  }

  function updateItem(index, patch) {
    setInvoice((prev) => ({
      ...prev,
      items: prev.items.map((it, i) => (i === index ? { ...it, ...patch } : it)),
    }));
  }

  function addItem() {
    setInvoice((prev) => ({
      ...prev,
      items: [...prev.items, { id: `tmp-${Date.now()}`, description: "", quantity: 1, unitPrice: 0 }],
    }));
  }

  function removeItem(index) {
    setInvoice((prev) => ({ ...prev, items: prev.items.filter((_, i) => i !== index) }));
  }

  async function handleSave() {
    try {
      const updated = await updateInvoice(id, invoice);
      setInvoice(updated);
      setMessage(t("updated"));
    } catch (e) {
      setError(e.message);
    }
  }

  async function handleSend() {
    try {
      setInvoice(await sendInvoice(id));
    } catch (e) {
      setError(e.message);
    }
  }

  async function handleVoid() {
    if (!confirm(t("confirmVoid"))) return;
    const reason = prompt(t("voidReasonPrompt")) || "";
    try {
      setInvoice(await voidInvoice(id, reason));
    } catch (e) {
      setError(e.message);
    }
  }

  async function handleRecordPayment(e) {
    e.preventDefault();
    try {
      const updated = await recordInvoicePayment(id, paymentForm);
      setInvoice(updated);
      setPaymentForm({ paymentDate: "", paymentMethod: "", referenceNumber: "", amount: 0, notes: "" });
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

  if (error) return <p className="text-red-600 dark:text-red-400 text-sm">{error}</p>;
  if (!invoice) return <p className="text-gray-500 text-sm">{tc("loading")}</p>;

  const isAdmin = getCurrentUser()?.role === "ADMIN";
  const subtotal = invoice.items.reduce((s, it) => s + Number(it.quantity || 0) * Number(it.unitPrice || 0), 0);
  const total = Math.max(0, subtotal + Number(invoice.tax || 0) - Number(invoice.discount || 0));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <Link href={`/dashboard/workorders/${invoice.workOrderId}`} className="text-sm text-gray-500">← {invoice.workOrderNo}</Link>
          <h1 className="text-2xl font-semibold dark:text-gray-100 tracking-tight flex items-center gap-3">
            {invoice.invoiceNumber}
            <span className={`text-xs font-medium rounded-full px-2 py-1 ${STATUS_COLORS[invoice.status] || "bg-gray-100 text-gray-600"}`}>
              {t(`statuses.${invoice.status}`)}
            </span>
          </h1>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => window.open(`${window.location.origin}/invoice/view/${invoice.publicToken}?print=1`, "_blank")} className="border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-shadow text-sm">
            {t("downloadPdf")}
          </button>
          <button type="button" onClick={handleCopyLink} className="border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-shadow text-sm">
            {copied ? t("linkCopied") : t("copyLink")}
          </button>
          {invoice.status === "Draft" && (
            <button type="button" onClick={handleSend} className="bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors px-3 py-2 text-sm">{t("sendInvoice")}</button>
          )}
          {invoice.status !== "Void" && (
            <button type="button" onClick={handleVoid} className="border border-red-300 text-red-600 rounded px-3 py-2 text-sm">{t("voidInvoice")}</button>
          )}
        </div>
      </div>

      {message && <p className="text-green-600 dark:text-green-400 text-sm">{message}</p>}

      <section className="bg-white dark:bg-gray-900 dark:border dark:border-gray-800 rounded-xl shadow-sm p-4 grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="block text-sm mb-1 text-gray-600 dark:text-gray-300">{tc("name")}</label>
          <input value={invoice.customerName} onChange={(e) => set("customerName", e.target.value)} className="w-full border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-shadow" />
        </div>
        <div>
          <label className="block text-sm mb-1 text-gray-600 dark:text-gray-300">{tc("phone")}</label>
          <input value={invoice.customerPhone} onChange={(e) => set("customerPhone", e.target.value)} className="w-full border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-shadow" />
        </div>
        <div>
          <label className="block text-sm mb-1 text-gray-600 dark:text-gray-300">{tc("email")}</label>
          <input value={invoice.customerEmail} onChange={(e) => set("customerEmail", e.target.value)} className="w-full border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-shadow" />
        </div>
        <div>
          <label className="block text-sm mb-1 text-gray-600 dark:text-gray-300">{t("claimNumber")}</label>
          <input value={invoice.claimNumber} onChange={(e) => set("claimNumber", e.target.value)} className="w-full border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-shadow" />
        </div>
      </section>

      <section className="bg-white dark:bg-gray-900 dark:border dark:border-gray-800 rounded-xl shadow-sm p-4">
        <h2 className="font-semibold mb-3">{t("billingOptions")}</h2>
        <div className="max-w-sm mb-4">
          <label className="block text-sm mb-1 text-gray-600 dark:text-gray-300">{t("invoiceTo")}</label>
          <select value={invoice.billTo} onChange={(e) => set("billTo", e.target.value)} className="w-full border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-shadow">
            <option value="Customer">{t("billTo.Customer")}</option>
            <option value="Insurance">{t("billTo.Insurance")}</option>
            <option value="Split">{t("billTo.Split")}</option>
          </select>
        </div>

        {invoice.billTo === "Insurance" && (
          <div className="max-w-sm">
            <label className="block text-sm mb-1 text-gray-600 dark:text-gray-300">{t("insuranceCompany")}</label>
            <select
              value={invoice.insuranceCompanyId || ""}
              onChange={(e) => set("insuranceCompanyId", e.target.value ? Number(e.target.value) : null)}
              className="w-full border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-shadow"
            >
              <option value="">—</option>
              {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
        )}

        {invoice.billTo === "Split" && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm mb-1 text-gray-600 dark:text-gray-300">{t("customerAmount")}</label>
              <input type="number" value={invoice.splitBilling.customerAmount} onChange={(e) => setSplit("customerAmount", Number(e.target.value))} className="w-full border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-shadow" />
            </div>
            <div>
              <label className="block text-sm mb-1 text-gray-600 dark:text-gray-300">{t("insuranceAmount")}</label>
              <input type="number" value={invoice.splitBilling.insuranceAmount} onChange={(e) => setSplit("insuranceAmount", Number(e.target.value))} className="w-full border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-shadow" />
            </div>
            <div>
              <label className="block text-sm mb-1 text-gray-600 dark:text-gray-300">{t("deductible")}</label>
              <input type="number" value={invoice.splitBilling.deductible} onChange={(e) => setSplit("deductible", Number(e.target.value))} className="w-full border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-shadow" />
            </div>
          </div>
        )}
      </section>

      <section className="bg-white dark:bg-gray-900 dark:border dark:border-gray-800 rounded-xl shadow-sm p-4">
        <h2 className="font-semibold mb-3">{t("invoiceTemplate")}</h2>
        <div className="max-w-sm mb-4">
          <select
            value={invoice.template}
            onChange={(e) => set("template", e.target.value)}
            className="w-full border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-shadow"
          >
            {TEMPLATES.map((tpl) => <option key={tpl} value={tpl}>{t(`templates.${tpl}`)}</option>)}
          </select>
          <p className="text-xs text-gray-400 mt-1">{t(`templateHints.${invoice.template}`)}</p>
        </div>

        {invoice.template === "Custom" && (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-x-4 gap-y-2">
            {SECTION_KEYS.map((key) => (
              <label key={key} className="flex items-center gap-2 text-xs">
                <input type="checkbox" checked={!!invoice.customSections?.[key]} onChange={(e) => setCustomSection(key, e.target.checked)} />
                {t(`sections.${key}`)}
              </label>
            ))}
          </div>
        )}

        {isAdmin && (
          <div className="mt-4 pt-4 border-t dark:border-gray-800">
            <label className="block text-sm mb-1 text-gray-600 dark:text-gray-300">{t("internalNotes")}</label>
            <p className="text-xs text-amber-600 dark:text-amber-400 mb-1">{t("internalNotesHint")}</p>
            <textarea
              value={invoice.internalNotes}
              onChange={(e) => set("internalNotes", e.target.value)}
              rows={3}
              className="w-full border-2 border-amber-200 dark:border-amber-900 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-3 py-2 focus:ring-2 focus:ring-amber-500 focus:border-amber-500 outline-none transition-shadow"
            />
          </div>
        )}
      </section>

      <section className="bg-white dark:bg-gray-900 dark:border dark:border-gray-800 rounded-xl shadow-sm p-4">
        <h2 className="font-semibold mb-3">{t("lineItems")}</h2>
        <div className="space-y-2 mb-3">
          {invoice.items.map((item, i) => (
            <div key={item.id} className="grid grid-cols-1 md:grid-cols-[1fr_100px_120px_120px_auto] gap-2 items-center">
              <input
                value={item.description}
                onChange={(e) => updateItem(i, { description: e.target.value })}
                placeholder={t("description")}
                className="border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-2 py-1.5 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-shadow text-sm"
              />
              <input
                type="number"
                value={item.quantity}
                onChange={(e) => updateItem(i, { quantity: Number(e.target.value) })}
                placeholder={t("quantity")}
                className="border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-2 py-1.5 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-shadow text-sm"
              />
              <input
                type="number"
                value={item.unitPrice}
                onChange={(e) => updateItem(i, { unitPrice: Number(e.target.value) })}
                placeholder={t("unitPrice")}
                className="border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-2 py-1.5 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-shadow text-sm"
              />
              <span className="text-sm font-medium">{money(Number(item.quantity || 0) * Number(item.unitPrice || 0))}</span>
              <button type="button" onClick={() => removeItem(i)} className="text-red-500 text-xs justify-self-end">✕</button>
            </div>
          ))}
        </div>
        <button type="button" onClick={addItem} className="text-sm text-blue-600">{t("addLineItem")}</button>
      </section>

      <section className="bg-white dark:bg-gray-900 dark:border dark:border-gray-800 rounded-xl shadow-sm p-4 grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="space-y-3">
          <div>
            <label className="block text-sm mb-1 text-gray-600 dark:text-gray-300">{t("invoiceDate")}</label>
            <input type="date" value={invoice.invoiceDate} onChange={(e) => set("invoiceDate", e.target.value)} className="w-full border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-shadow" />
          </div>
          <div>
            <label className="block text-sm mb-1 text-gray-600 dark:text-gray-300">{t("dueDate")}</label>
            <input type="date" value={invoice.dueDate} onChange={(e) => set("dueDate", e.target.value)} className="w-full border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-shadow" />
          </div>
          <div>
            <label className="block text-sm mb-1 text-gray-600 dark:text-gray-300">{tc("notes")}</label>
            <textarea value={invoice.notes} onChange={(e) => set("notes", e.target.value)} className="w-full border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-shadow" rows={3} />
          </div>
        </div>
        <div className="space-y-2 text-sm">
          <div className="flex justify-between"><span className="text-gray-500">{t("subtotal")}</span><span>{money(subtotal)}</span></div>
          <div className="flex justify-between items-center">
            <span className="text-gray-500">{t("tax")}</span>
            <input type="number" value={invoice.tax} onChange={(e) => set("tax", Number(e.target.value))} className="w-24 border rounded px-2 py-1 text-right" />
          </div>
          <div className="flex justify-between items-center">
            <span className="text-gray-500">{t("discount")}</span>
            <input type="number" value={invoice.discount} onChange={(e) => set("discount", Number(e.target.value))} className="w-24 border rounded px-2 py-1 text-right" />
          </div>
          <div className="flex justify-between font-semibold pt-2 border-t"><span>{t("total")}</span><span>{money(total)}</span></div>
          <div className="flex justify-between"><span className="text-gray-500">{t("amountPaid")}</span><span>{money(invoice.amountPaid)}</span></div>
          <div className="flex justify-between font-semibold text-green-700"><span>{t("balance")}</span><span>{money(invoice.balance)}</span></div>
        </div>
      </section>

      <button onClick={handleSave} className="bg-gray-900 hover:bg-gray-800 dark:bg-blue-600 dark:hover:bg-blue-700 text-white rounded-lg transition-colors px-6 py-2">{tc("saveChanges")}</button>

      <section className="bg-white dark:bg-gray-900 dark:border dark:border-gray-800 rounded-xl shadow-sm p-4">
        <h2 className="font-semibold mb-3">{t("payments")}</h2>
        <table className="w-full text-sm mb-4">
          <thead>
            <tr className="text-left border-b dark:border-gray-800 text-xs text-gray-400 uppercase">
              <th className="p-2">{t("paymentDate")}</th>
              <th className="p-2">{t("paymentMethod")}</th>
              <th className="p-2">{t("referenceNumber")}</th>
              <th className="p-2">{tc("amount")}</th>
            </tr>
          </thead>
          <tbody>
            {invoice.payments.map((p) => (
              <tr key={p.id} className="border-b last:border-0 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800/60 transition-colors">
                <td className="p-2">{p.paymentDate}</td>
                <td className="p-2">{p.paymentMethod}</td>
                <td className="p-2">{p.referenceNumber}</td>
                <td className="p-2">{money(p.amount)}</td>
              </tr>
            ))}
            {invoice.payments.length === 0 && <tr><td className="p-2 text-gray-500" colSpan={4}>{t("noPayments")}</td></tr>}
          </tbody>
        </table>

        <form onSubmit={handleRecordPayment} className="grid grid-cols-1 md:grid-cols-5 gap-2 items-end">
          <input type="date" value={paymentForm.paymentDate} onChange={(e) => setPaymentForm((f) => ({ ...f, paymentDate: e.target.value }))} className="border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-2 py-1.5 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-shadow text-sm" required />
          <input value={paymentForm.paymentMethod} onChange={(e) => setPaymentForm((f) => ({ ...f, paymentMethod: e.target.value }))} placeholder={t("paymentMethod")} className="border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-2 py-1.5 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-shadow text-sm" />
          <input value={paymentForm.referenceNumber} onChange={(e) => setPaymentForm((f) => ({ ...f, referenceNumber: e.target.value }))} placeholder={t("referenceNumber")} className="border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-2 py-1.5 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-shadow text-sm" />
          <input type="number" value={paymentForm.amount} onChange={(e) => setPaymentForm((f) => ({ ...f, amount: Number(e.target.value) }))} placeholder={tc("amount")} className="border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-2 py-1.5 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-shadow text-sm" required min="0.01" step="0.01" />
          <button type="submit" className="bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors px-3 py-2 text-sm">{t("recordPayment")}</button>
        </form>
      </section>

      <section className="bg-white dark:bg-gray-900 dark:border dark:border-gray-800 rounded-xl shadow-sm p-4">
        <h2 className="font-semibold mb-3">{t("auditTrail")}</h2>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left border-b dark:border-gray-800 text-xs text-gray-400 uppercase">
              <th className="p-2">{t("timestamp")}</th>
              <th className="p-2">{t("user")}</th>
              <th className="p-2">{t("action")}</th>
            </tr>
          </thead>
          <tbody>
            {invoice.auditLog.slice().reverse().map((entry, i) => (
              <tr key={i} className="border-b last:border-0 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800/60 transition-colors">
                <td className="p-2">{new Date(entry.timestamp).toLocaleString()}</td>
                <td className="p-2">{entry.user}</td>
                <td className="p-2">{entry.action}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
