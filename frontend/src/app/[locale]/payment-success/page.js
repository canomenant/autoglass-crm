"use client";

import { CheckIcon } from "@/components/Icons";

export default function PaymentSuccessPage() {
  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-lg w-full max-w-md p-8 text-center">
        <div className="w-16 h-16 rounded-full bg-emerald-50 text-emerald-600 flex items-center justify-center mx-auto mb-6">
          <CheckIcon className="w-8 h-8" />
        </div>
        <h1 className="text-xl font-semibold text-slate-800 mb-2">Payment Successful</h1>
        <p className="text-sm text-slate-500 mb-8">
          Thank you. Your payment has been received and your work order has been updated.
        </p>
        <a href="/" className="inline-block bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg px-6 py-3 transition-colors">
          Return Home
        </a>
      </div>
    </div>
  );
}
