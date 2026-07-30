"use client";

import { CloseIcon } from "@/components/Icons";

export default function PaymentCancelledPage() {
  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-lg w-full max-w-md p-8 text-center">
        <div className="w-16 h-16 rounded-full bg-slate-100 text-slate-500 flex items-center justify-center mx-auto mb-6">
          <CloseIcon className="w-8 h-8" />
        </div>
        <h1 className="text-xl font-semibold text-slate-800 mb-2">Payment Cancelled</h1>
        <p className="text-sm text-slate-500 mb-8">
          Your payment was not completed. No charges were made.
        </p>
        <button onClick={() => window.history.back()} className="bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg px-6 py-3 transition-colors">
          Try Again
        </button>
      </div>
    </div>
  );
}
