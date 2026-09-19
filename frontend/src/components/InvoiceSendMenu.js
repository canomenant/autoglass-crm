"use client";

// Botón "Send" de la factura. Dos clases de envío:
//  - Desde el CRM (automático): correo por Resend cuando Settings → Integrations lo reporta
//    conectado (19-sep-2026); el SMS automático llegará con Twilio.
//  - Desde el teléfono/PC de quien manda: abre SMS, WhatsApp o el correo con el link ya escrito,
//    o copia el link. No requiere proveedor.
// Al elegir un canal se registra en la factura por dónde y cuándo se mandó (Draft → Sent).
// Se usa en el listado, en el panel de la orden y en la factura.

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { sendInvoice, emailInvoice, getIntegrationsStatus } from "@/lib/api";

function money(n) {
  return `$${Number(n || 0).toFixed(2)}`;
}

function digits(v) {
  const d = String(v || "").replace(/\D/g, "");
  return d.length === 10 ? `1${d}` : d;
}

// El estado de integraciones se pide una vez por sesión de página, no por cada botón de la lista.
let statusPromise = null;
function integrations() {
  if (!statusPromise) statusPromise = getIntegrationsStatus().catch(() => ({}));
  return statusPromise;
}

export default function InvoiceSendMenu({ invoice, onSent, size = "sm", primary = false }) {
  const t = useTranslations("invoices");
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [emailCrm, setEmailCrm] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    integrations().then((s) => setEmailCrm(Boolean(s?.email?.configured)));
  }, []);

  useEffect(() => {
    if (!open) return;
    const cerrar = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", cerrar);
    return () => document.removeEventListener("mousedown", cerrar);
  }, [open]);

  if (!invoice?.publicToken) return null;
  const url = `${typeof window !== "undefined" ? window.location.origin : ""}/invoice/view/${invoice.publicToken}`;
  const firstName = String(invoice.customerName || "").trim().split(/\s+/)[0] || "";
  const texto = t("sendMessage", { name: firstName, number: invoice.invoiceNumber, total: money(invoice.total), url });
  const asunto = t("sendSubject", { number: invoice.invoiceNumber });
  const tel = digits(invoice.customerPhone);

  async function registrar(channel) {
    setOpen(false);
    try {
      const updated = await sendInvoice(invoice.id, channel);
      onSent?.(updated);
    } catch (e) {
      setError(e.message);
    }
  }

  function abrir(channel) {
    let href = "";
    if (channel === "sms") href = `sms:${tel ? `+${tel}` : ""}?&body=${encodeURIComponent(texto)}`;
    if (channel === "whatsapp") href = `https://wa.me/${tel}?text=${encodeURIComponent(texto)}`;
    if (channel === "email") href = `mailto:${invoice.customerEmail || ""}?subject=${encodeURIComponent(asunto)}&body=${encodeURIComponent(texto)}`;
    if (channel === "whatsapp") window.open(href, "_blank", "noopener");
    else window.location.href = href;
    registrar(channel);
  }

  function copiar() {
    navigator.clipboard.writeText(url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
    registrar("link");
  }

  // Correo automático desde el CRM: confirma/corrige el destinatario y manda por el backend.
  async function mandarCorreoCrm() {
    const to = prompt(t("emailPrompt"), invoice.customerEmail || "");
    if (to === null) return;
    setOpen(false); setBusy(true); setError(""); setNotice("");
    try {
      const updated = await emailInvoice(invoice.id, to.trim());
      onSent?.(updated);
      setNotice(t("emailSentTo", { to: to.trim() }));
      setTimeout(() => setNotice(""), 4000);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  const pad = size === "xs" ? "px-3 py-2 text-xs" : "px-3 py-2 text-sm";
  const estilo = primary
    ? `bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors ${pad}`
    : `border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded-lg ${pad}`;
  const item = "w-full text-left px-3 py-2 text-sm hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-40 disabled:cursor-not-allowed";

  return (
    <div ref={ref} className="relative inline-block">
      <button type="button" onClick={() => setOpen((o) => !o)} disabled={busy} className={`${estilo} disabled:opacity-60`}>
        {busy ? "…" : `${invoice.sendCount > 0 ? t("resendInvoice") : t("sendInvoice")} ▾`}
      </button>
      {open && (
        <div className="absolute right-0 z-20 mt-1 w-64 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg overflow-hidden">
          {emailCrm && (
            <button type="button" className={`${item} font-medium border-b border-gray-100 dark:border-gray-800`} onClick={mandarCorreoCrm}>
              📨 {t("sendViaCrm.email_crm")}
            </button>
          )}
          <button type="button" className={item} disabled={!tel} onClick={() => abrir("sms")}>
            💬 {t("sendVia.sms")}{tel ? "" : ` — ${t("noPhone")}`}
          </button>
          <button type="button" className={item} disabled={!tel} onClick={() => abrir("whatsapp")}>
            🟢 {t("sendVia.whatsapp")}
          </button>
          <button type="button" className={item} disabled={!invoice.customerEmail} onClick={() => abrir("email")}>
            ✉️ {t("sendVia.email")}{invoice.customerEmail ? "" : ` — ${t("noEmail")}`}
          </button>
          <button type="button" className={`${item} border-t border-gray-100 dark:border-gray-800`} onClick={copiar}>
            🔗 {copied ? t("linkCopied") : t("copyLink")}
          </button>
          {invoice.lastSentAt && (
            <div className="px-3 py-2 text-[11px] text-gray-400 border-t border-gray-100 dark:border-gray-800">
              {t("lastSent", { when: new Date(invoice.lastSentAt).toLocaleString(), via: t(`sendVia.${invoice.lastSentVia || "other"}`), n: invoice.sendCount || 1 })}
            </div>
          )}
        </div>
      )}
      {notice && <p className="text-green-600 text-xs mt-1">{notice}</p>}
      {error && <p className="text-red-600 text-xs mt-1">{error}</p>}
    </div>
  );
}
