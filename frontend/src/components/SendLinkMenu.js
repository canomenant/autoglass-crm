"use client";

// Menú "Send ▾" genérico para mandarle un link al cliente: SMS, WhatsApp o correo con el texto ya
// escrito (abre la app del teléfono/PC), o copiar el link. Sin proveedor de SMS/correo. Se usa
// para el link de pago y para pedir la tarjeta en archivo; la factura tiene su propio menú.

import { useEffect, useRef, useState } from "react";

function digits(v) {
  const d = String(v || "").replace(/\D/g, "");
  return d.length === 10 ? `1${d}` : d;
}

// crmSms: { enabled, onSend(text) } → agrega "SMS — send from CRM" (Twilio) arriba de las opciones.
export default function SendLinkMenu({ label, phone, email, text, subject, url, onSent, disabled, className = "", labels = {}, crmSms }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const ref = useRef(null);
  const L = { sms: "Text message (SMS)", whatsapp: "WhatsApp", email: "Email", copy: "Copy link", copied: "Link copied!", noPhone: "no phone", noEmail: "no email", smsCrm: "SMS — send from CRM", ...labels };
  const [busy, setBusy] = useState(false);

  async function mandarCrm() {
    setOpen(false); setBusy(true);
    try { await crmSms.onSend(text); } finally { setBusy(false); }
  }

  useEffect(() => {
    if (!open) return;
    const cerrar = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", cerrar);
    return () => document.removeEventListener("mousedown", cerrar);
  }, [open]);

  const tel = digits(phone);

  function abrir(channel) {
    setOpen(false);
    let href = "";
    if (channel === "sms") href = `sms:${tel ? `+${tel}` : ""}?&body=${encodeURIComponent(text)}`;
    if (channel === "whatsapp") href = `https://wa.me/${tel}?text=${encodeURIComponent(text)}`;
    if (channel === "email") href = `mailto:${email || ""}?subject=${encodeURIComponent(subject || "")}&body=${encodeURIComponent(text)}`;
    if (channel === "whatsapp") window.open(href, "_blank", "noopener");
    else window.location.href = href;
    onSent?.(channel);
  }

  function copiar() {
    navigator.clipboard.writeText(url).then(() => {
      setCopied(true);
      setTimeout(() => { setCopied(false); setOpen(false); }, 1500);
    });
    onSent?.("link");
  }

  const item = "w-full text-left px-3 py-2 text-sm hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-40 disabled:cursor-not-allowed";

  return (
    <div ref={ref} className="relative inline-block">
      <button type="button" disabled={disabled || busy} onClick={() => setOpen((o) => !o)}
        className={className || "border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 rounded-lg transition-colors px-4 py-2 text-sm disabled:opacity-40"}>
        {busy ? "…" : `${label} ▾`}
      </button>
      {open && (
        <div className="absolute left-0 z-20 mt-1 w-60 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg overflow-hidden">
          {crmSms?.enabled && (
            <button type="button" className={`${item} font-medium border-b border-gray-100 dark:border-gray-800`} disabled={!tel} onClick={mandarCrm}>📲 {L.smsCrm}{tel ? "" : ` — ${L.noPhone}`}</button>
          )}
          <button type="button" className={item} disabled={!tel} onClick={() => abrir("sms")}>💬 {L.sms}{tel ? "" : ` — ${L.noPhone}`}</button>
          <button type="button" className={item} disabled={!tel} onClick={() => abrir("whatsapp")}>🟢 {L.whatsapp}</button>
          <button type="button" className={item} disabled={!email} onClick={() => abrir("email")}>✉️ {L.email}{email ? "" : ` — ${L.noEmail}`}</button>
          <button type="button" className={`${item} border-t border-gray-100 dark:border-gray-800`} onClick={copiar}>🔗 {copied ? L.copied : L.copy}</button>
        </div>
      )}
    </div>
  );
}
