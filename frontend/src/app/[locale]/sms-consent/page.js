"use client";

// Página pública de términos de SMS (opt-in). La pide la verificación toll-free de Twilio como
// "documentación de cómo el cliente acepta recibir textos": aquí se explica cuándo damos su
// número, qué mandamos y cómo se da de baja. Antonio, 19-sep-2026. Siempre en claro.

import Image from "next/image";

export default function SmsConsentPage() {
  return (
    <div className="min-h-screen bg-gray-100 text-gray-900 py-8 px-4">
      <div className="max-w-3xl mx-auto bg-white rounded-xl shadow-sm p-8">
        <div className="flex items-center gap-4 mb-6 border-b-2 border-gray-900 pb-4">
          <Image src="/logo-print.png" alt="Reyes Auto Glass Group" width={1027} height={846} className="w-28 h-auto" />
          <div>
            <div className="font-bold text-lg">Reyes Auto Glass Group</div>
            <div className="text-xs text-gray-500">(844) 617-0794 · info@reyesautoglassgroup.com</div>
          </div>
        </div>
        <h1 className="text-2xl font-bold mb-4">SMS Terms &amp; Consent</h1>
        <div className="text-sm leading-relaxed space-y-4">
          <p><b>Program name:</b> Reyes Auto Glass Group customer notifications.</p>
          <p><b>How you opt in.</b> When you request a quote or book an auto glass appointment with Reyes Auto Glass Group — by phone, on our website form, or with one of our agents — you provide your mobile number and agree to receive text messages from us about your service. You will not receive marketing texts unless you separately ask for them.</p>
          <p><b>What we send.</b> Appointment confirmations and reminders, technician arrival updates, your invoice, payment links and receipts, requests to keep a card on file for your job, and replies to questions you text us. Message frequency varies (typically 2–6 messages per job).</p>
          <p><b>Message and data rates may apply.</b> Check with your carrier for details.</p>
          <p><b>Opt out at any time.</b> Reply <b>STOP</b> to any message to stop receiving texts. Reply <b>HELP</b> for help, or call us at (844) 617-0794.</p>
          <p><b>Privacy.</b> We do not sell or share your mobile number or SMS consent with third parties for their marketing. If we refer your job to a partner shop, we tell you first by text and share only the details needed to do the work.</p>
          <div className="border rounded-xl p-4 bg-gray-50">
            <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Web form — how customers opt in (as shown on our booking form)</div>
            <div className="bg-white border rounded-lg p-4 max-w-md space-y-3 text-sm">
              <div><div className="text-xs text-gray-600 mb-1">Primary phone <span className="text-red-500">*</span></div><div className="border rounded-lg px-3 py-2 text-gray-400">(___) ___-____</div>
                <p className="text-[11px] text-gray-500 mt-1">By providing your mobile number you agree to receive text messages from Reyes Auto Glass Group about your appointment, invoice and payment. Msg &amp; data rates may apply. Reply STOP to opt out, HELP for help. <span className="underline">SMS terms</span></p></div>
              <div className="bg-blue-600 text-white text-center rounded-lg py-2 text-sm font-medium">Book my appointment</div>
            </div>
            <p className="text-xs text-gray-500 mt-2">Customers who book by phone give verbal consent when providing their mobile number to our agent for service updates.</p>
          </div>
          <p className="text-xs text-gray-500">Sample message: “Reyes Auto Glass Group: hi Maria, your windshield replacement is scheduled for Tue 9/23 between 9 AM and 1 PM. Your technician will text you when on the way. Reply STOP to opt out.”</p>
        </div>
      </div>
    </div>
  );
}
