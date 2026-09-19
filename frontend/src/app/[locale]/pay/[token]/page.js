"use client";

// Página pública del link de pago de una orden. Dos cosas (Antonio, 19-sep-2026):
//  - Pagar el saldo ahora (Stripe Checkout).
//  - Guardar una tarjeta en archivo sin cobrar, para que se cobre cuando el trabajo termine
//    (Stripe Checkout en modo setup; el CRM nunca ve el número). Vuelve aquí con ?saved=1.
// Siempre en claro, sin clases dark:.

import { useEffect, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import Image from "next/image";
import { getWorkOrderByPaymentToken, createCheckoutSession, createSetupSession } from "@/lib/api";
import { CreditCardIcon } from "@/components/Icons";

function money(n) {
  return `$${Number(n || 0).toFixed(2)}`;
}

function brandName(b) {
  const m = { visa: "Visa", mastercard: "Mastercard", amex: "American Express", discover: "Discover" };
  return m[String(b || "").toLowerCase()] || String(b || "Card");
}

export default function PayWorkOrderPage() {
  const { token } = useParams();
  const searchParams = useSearchParams();
  const [workOrder, setWorkOrder] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const saved = searchParams.get("saved") === "1";

  useEffect(() => {
    getWorkOrderByPaymentToken(token)
      .then(setWorkOrder)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [token]);

  async function ir(fn, key) {
    setBusy(key);
    setError("");
    try {
      const { url } = await fn(token);
      window.location.href = url;
    } catch (e) {
      setError(e.message);
      setBusy("");
    }
  }

  const balance = workOrder ? Number(workOrder.totalSale || 0) - Number(workOrder.payment?.amount || 0) : 0;
  const card = workOrder?.cardOnFile;

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-lg w-full max-w-md overflow-hidden">
        <div className="bg-slate-900 px-8 py-6 flex items-center gap-3">
          <div className="rounded-lg overflow-hidden w-12 h-12 flex-shrink-0">
            <Image src="/logo.png" alt="Reyes Auto Glass Group" width={100} height={100} className="w-full h-full object-cover" priority />
          </div>
          <div>
            <div className="text-white font-semibold">Reyes Auto Glass Group</div>
            <div className="text-slate-400 text-xs">Secure payment · powered by Stripe</div>
          </div>
        </div>

        <div className="p-8">
          {loading && <p className="text-sm text-slate-400">Loading...</p>}

          {!loading && error && !workOrder && <p className="text-red-600 text-sm">{error}</p>}

          {!loading && workOrder && (
            <>
              {saved && (
                <div className="mb-5 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-800 text-sm px-4 py-3">
                  ✓ Your card was saved securely. We will only charge it once your job is completed, and you will get a receipt by email.
                </div>
              )}

              <div className="mb-6">
                <div className="text-xs text-slate-400 uppercase tracking-wide mb-1">Work Order</div>
                <div className="text-lg font-semibold text-slate-800">{workOrder.workOrderNo}</div>
                <div className="text-sm text-slate-500">{workOrder.customerName}</div>
              </div>

              <div className="bg-slate-50 border border-slate-100 rounded-xl p-5 mb-4 flex items-center justify-between">
                <span className="text-sm text-slate-500">Balance Due</span>
                <span className="text-3xl font-bold text-slate-800">{money(balance)}</span>
              </div>

              {card && (
                <div className="mb-5 flex items-center gap-3 rounded-xl border border-slate-200 px-4 py-3 text-sm">
                  <CreditCardIcon className="w-5 h-5 text-slate-500" />
                  <div>
                    <div className="font-medium text-slate-800">Card on file: {brandName(card.brand)} •••• {card.last4}</div>
                    <div className="text-xs text-slate-500">Expires {String(card.expMonth).padStart(2, "0")}/{String(card.expYear).slice(-2)} · charged only when the job is completed</div>
                  </div>
                </div>
              )}

              {error && <p className="text-red-600 text-sm mb-4">{error}</p>}

              {balance > 0 ? (
                <button onClick={() => ir(createCheckoutSession, "pay")} disabled={!!busy}
                  className="w-full flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-medium rounded-lg py-3 transition-colors">
                  <CreditCardIcon className="w-5 h-5" />
                  {busy === "pay" ? "Redirecting..." : `Pay ${money(balance)} now`}
                </button>
              ) : (
                <div className="text-center text-sm font-medium text-emerald-600 bg-emerald-50 rounded-lg py-3">
                  This work order is fully paid. Thank you!
                </div>
              )}

              {!card && balance > 0 && (
                <>
                  <div className="my-4 flex items-center gap-3 text-xs text-slate-400"><span className="flex-1 border-t" />or<span className="flex-1 border-t" /></div>
                  <button onClick={() => ir(createSetupSession, "save")} disabled={!!busy}
                    className="w-full border border-slate-300 hover:bg-slate-50 disabled:opacity-50 text-slate-800 font-medium rounded-lg py-3 transition-colors">
                    {busy === "save" ? "Redirecting..." : "Save a card to pay when the job is done"}
                  </button>
                  <p className="mt-3 text-xs text-slate-500 leading-relaxed">
                    Your card details go directly to Stripe and are never stored by Reyes Auto Glass Group. By saving a card you authorize us to charge it for this work order once the job is completed. You will receive a receipt by email.
                  </p>
                </>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
