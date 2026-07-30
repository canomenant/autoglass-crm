"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Image from "next/image";
import { getWorkOrderByPaymentToken, createCheckoutSession } from "@/lib/api";
import { CreditCardIcon } from "@/components/Icons";

function money(n) {
  return `$${Number(n || 0).toFixed(2)}`;
}

export default function PayWorkOrderPage() {
  const { token } = useParams();
  const [workOrder, setWorkOrder] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [paying, setPaying] = useState(false);

  useEffect(() => {
    getWorkOrderByPaymentToken(token)
      .then(setWorkOrder)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [token]);

  async function handlePayNow() {
    setPaying(true);
    setError("");
    try {
      const { url } = await createCheckoutSession(token);
      window.location.href = url;
    } catch (e) {
      setError(e.message);
      setPaying(false);
    }
  }

  const balance = workOrder ? Number(workOrder.totalSale || 0) - Number(workOrder.payment?.amount || 0) : 0;

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-lg w-full max-w-md overflow-hidden">
        <div className="bg-slate-900 px-8 py-6 flex items-center gap-3">
          <div className="rounded-lg overflow-hidden w-12 h-12 flex-shrink-0">
            <Image src="/logo.png" alt="Reyes Auto Glass Group" width={100} height={100} className="w-full h-full object-cover" priority />
          </div>
          <div>
            <div className="text-white font-semibold">Reyes Auto Glass Group</div>
            <div className="text-slate-400 text-xs">Secure Payment</div>
          </div>
        </div>

        <div className="p-8">
          {loading && <p className="text-sm text-slate-400">Loading...</p>}

          {!loading && error && !workOrder && (
            <p className="text-red-600 text-sm">{error}</p>
          )}

          {!loading && workOrder && (
            <>
              <div className="mb-6">
                <div className="text-xs text-slate-400 uppercase tracking-wide mb-1">Work Order</div>
                <div className="text-lg font-semibold text-slate-800">{workOrder.workOrderNo}</div>
                <div className="text-sm text-slate-500">{workOrder.customerName}</div>
              </div>

              <div className="bg-slate-50 border border-slate-100 rounded-xl p-5 mb-6 flex items-center justify-between">
                <span className="text-sm text-slate-500">Balance Due</span>
                <span className="text-3xl font-bold text-slate-800">{money(balance)}</span>
              </div>

              {error && <p className="text-red-600 text-sm mb-4">{error}</p>}

              {balance > 0 ? (
                <button
                  onClick={handlePayNow}
                  disabled={paying}
                  className="w-full flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-medium rounded-lg py-3 transition-colors"
                >
                  <CreditCardIcon className="w-5 h-5" />
                  {paying ? "Redirecting..." : "Pay Now"}
                </button>
              ) : (
                <div className="text-center text-sm font-medium text-emerald-600 bg-emerald-50 rounded-lg py-3">
                  This work order is fully paid.
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
