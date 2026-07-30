"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import PaymentBatchWizard from "@/components/PaymentBatchWizard";
import { createPayment } from "@/lib/api";

export default function CreatePaymentPage() {
  const router = useRouter();
  const t = useTranslations("payments");
  const [error, setError] = useState("");

  async function handleSubmit(data) {
    try {
      if (Array.isArray(data)) {
        let last;
        for (const entry of data) {
          last = await createPayment(entry);
        }
        router.push(data.length === 1 ? `/dashboard/payments/${last.id}` : "/dashboard/payments");
        return;
      }
      const payment = await createPayment(data);
      router.push(`/dashboard/payments/${payment.id}`);
    } catch (e) {
      setError(e.message);
    }
  }

  return (
    <div>
      <h1 className="text-2xl font-semibold dark:text-gray-100 tracking-tight mb-6">{t("createPayment")}</h1>
      {error && <p className="text-red-600 dark:text-red-400 text-sm mb-4">{error}</p>}
      <PaymentBatchWizard onSubmit={handleSubmit} submitLabel={t("createPayment")} />
    </div>
  );
}
