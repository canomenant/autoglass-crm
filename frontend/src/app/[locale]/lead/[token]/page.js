"use client";

// Página pública del lead para el comprador (tech/taller). Antes de pagar: el adelanto (zona,
// vehículo, trabajo, fecha) y el precio; acepta los términos con un clic y paga por Stripe.
// Después de pagar (solo su token): los datos completos del cliente. Siempre en claro.

import { useEffect, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import Image from "next/image";
import { getPublicLead, acceptLeadTerms, leadCheckout } from "@/lib/api";

function money(n) {
  return `$${Number(n || 0).toFixed(2)}`;
}

export default function LeadPage() {
  const { token } = useParams();
  const searchParams = useSearchParams();
  const [lead, setLead] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [terms, setTerms] = useState(false);
  const [showTerms, setShowTerms] = useState(false);
  const justPaid = searchParams.get("paid") === "1";

  function load() {
    return getPublicLead(token).then((l) => { setLead(l); setTerms(Boolean(l.termsAccepted)); }).catch((e) => setError(e.message)).finally(() => setLoading(false));
  }
  useEffect(() => { load(); }, [token]); // eslint-disable-line react-hooks/exhaustive-deps

  // Tras pagar, el webhook tarda unos segundos: se reintenta hasta ver el paquete.
  useEffect(() => {
    if (!justPaid || lead?.package) return;
    const t = setInterval(() => load(), 3000);
    return () => clearInterval(t);
  }, [justPaid, lead?.package]); // eslint-disable-line react-hooks/exhaustive-deps

  async function pagar() {
    setBusy(true); setError("");
    try {
      if (!lead.termsAccepted) await acceptLeadTerms(token);
      const { url } = await leadCheckout(token);
      window.location.href = url;
    } catch (e) {
      setError(e.message); setBusy(false);
    }
  }

  const t = lead?.teaser || {};
  const p = lead?.package;
  const abierto = lead?.status === "offered" && lead?.offerStatus === "offered";
  const perdido = lead && !p && (lead.offerStatus === "lost" || ["paid", "delivered"].includes(lead.status));

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-lg w-full max-w-lg overflow-hidden">
        <div className="bg-slate-900 px-8 pt-6 pb-5 flex flex-col items-center gap-2">
          <Image src="/logo-dark.png" alt="Reyes Auto Glass Group" width={1027} height={846} className="w-36 h-auto" priority />
          <div className="text-slate-400 text-xs tracking-wide">Lead sales · exclusive leads for partner shops</div>
        </div>
        <div className="p-8">
          {loading && <p className="text-sm text-slate-400">Loading...</p>}
          {!loading && error && !lead && <p className="text-red-600 text-sm">{error}</p>}
          {lead && (
            <>
              {p ? (
                <>
                  <div className="mb-4 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-800 text-sm px-4 py-3">✓ This lead is yours. The customer has been told a partner shop will contact them — please call soon.</div>
                  <h1 className="text-xl font-bold mb-3">{p.customerName}</h1>
                  <dl className="text-sm space-y-1.5">
                    <div><dt className="inline text-slate-500 w-24">Phone: </dt><dd className="inline font-semibold"><a href={`tel:${p.phone}`} className="text-blue-700">{p.phone}</a>{p.altPhone ? ` / ${p.altPhone}` : ""}</dd></div>
                    {p.email && <div><dt className="inline text-slate-500">Email: </dt><dd className="inline">{p.email}</dd></div>}
                    <div><dt className="inline text-slate-500">Address: </dt><dd className="inline">{[p.address, p.city && !p.address.includes(p.city) ? p.city : "", p.zip && !p.address.includes(p.zip) ? [p.state, p.zip].filter(Boolean).join(" ") : ""].filter(Boolean).join(", ")}</dd></div>
                    <div><dt className="inline text-slate-500">Vehicle: </dt><dd className="inline font-medium">{p.vehicle}{p.bodyType ? ` (${p.bodyType})` : ""}</dd></div>
                    {p.vin && <div><dt className="inline text-slate-500">VIN: </dt><dd className="inline font-mono">{p.vin}</dd></div>}
                    {p.plate && <div><dt className="inline text-slate-500">Plate: </dt><dd className="inline">{p.plate}</dd></div>}
                    <div><dt className="inline text-slate-500">Job: </dt><dd className="inline">{p.job}</dd></div>
                    {p.parts?.length > 0 && <div><dt className="inline text-slate-500">Parts: </dt><dd className="inline">{p.parts.map((x) => [x.jobType, x.partNumber, x.description].filter(Boolean).join(" ")).join("; ")}</dd></div>}
                    <div><dt className="inline text-slate-500">Wanted: </dt><dd className="inline">{[p.appointmentDate, p.appointmentWindow === "AM" ? "morning" : p.appointmentWindow === "PM" ? "afternoon" : p.startTime].filter(Boolean).join(" ") || "flexible"}</dd></div>
                    {p.customerBudget && <div><dt className="inline text-slate-500">Customer budget: </dt><dd className="inline">≈ {money(p.customerBudget)}</dd></div>}
                    {p.paymentType && <div><dt className="inline text-slate-500">Payment: </dt><dd className="inline">{p.paymentType}{p.insuranceCompany ? ` — ${p.insuranceCompany}` : ""}</dd></div>}
                    {p.notes && <div><dt className="inline text-slate-500">Notes: </dt><dd className="inline">{p.notes}</dd></div>}
                  </dl>
                  <p className="mt-6 text-xs text-slate-500">You bought this lead as is. You are responsible for contacting the customer, parts, the work, payment and warranty. Do not present yourself as Reyes Auto Glass Group.</p>
                </>
              ) : (
                <>
                  {justPaid && <div className="mb-4 rounded-lg bg-blue-50 border border-blue-200 text-blue-800 text-sm px-4 py-3">Payment received — unlocking the customer details…</div>}
                  <div className="text-xs text-slate-400 uppercase tracking-wide mb-1">Lead in {t.area}</div>
                  <h1 className="text-xl font-bold">{t.vehicle}</h1>
                  <div className="text-slate-700 mt-1">{t.job}{t.parts?.length ? <span className="text-slate-500"> · {t.parts.join(", ")}</span> : null}</div>
                  <div className="text-sm text-slate-600 mt-2">{t.when}{t.customerBudget ? ` Customer budget ≈ ${money(t.customerBudget)}.` : ""}{t.paymentType ? ` Payment: ${t.paymentType}.` : ""}</div>

                  <div className="bg-slate-50 border border-slate-100 rounded-xl p-5 my-5 flex items-center justify-between">
                    <span className="text-sm text-slate-500">Lead price · exclusive</span>
                    <span className="text-3xl font-bold">{money(lead.price)}</span>
                  </div>

                  {error && <p className="text-red-600 text-sm mb-3">{error}</p>}

                  {abierto ? (
                    <>
                      {!lead.termsAccepted && (
                        <label className="flex items-start gap-2 text-sm mb-3">
                          <input type="checkbox" checked={terms} onChange={(e) => setTerms(e.target.checked)} className="mt-1" />
                          <span>I accept the <button type="button" onClick={() => setShowTerms((s) => !s)} className="text-blue-700 underline">lead purchase terms</button> (lead sold as is, exclusive to me, I am responsible for the job, parts, payment and warranty).</span>
                        </label>
                      )}
                      {showTerms && <pre className="whitespace-pre-wrap text-xs text-slate-600 bg-slate-50 border rounded-lg p-3 mb-3">{lead.terms}</pre>}
                      <button onClick={pagar} disabled={busy || (!lead.termsAccepted && !terms)}
                        className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-medium rounded-lg py-3 transition-colors">
                        {busy ? "Redirecting…" : `Pay ${money(lead.price)} and get the customer's name & phone`}
                      </button>
                      <p className="mt-3 text-xs text-slate-500">First to pay gets it. The customer's details are sent to you by text and email right after payment. Expires {new Date(lead.expiresAt).toLocaleString()}.</p>
                    </>
                  ) : (
                    <div className="text-center text-sm font-medium text-slate-600 bg-slate-100 rounded-lg py-3">
                      {perdido ? "This lead was taken by another shop." : lead.status === "expired" ? "This lead has expired." : "This lead is no longer available."}
                    </div>
                  )}
                </>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
