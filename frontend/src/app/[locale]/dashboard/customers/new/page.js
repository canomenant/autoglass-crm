"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import CustomerForm from "@/components/CustomerForm";
import { createCustomer } from "@/lib/api";

export default function NewCustomerPage() {
  const router = useRouter();
  const t = useTranslations("customers");
  const [error, setError] = useState("");

  async function handleSubmit(data) {
    try {
      const customer = await createCustomer(data);
      router.push(`/dashboard/customers/${customer.id}`);
    } catch (e) {
      setError(e.message);
    }
  }

  return (
    <div>
      <h1 className="text-2xl font-semibold dark:text-gray-100 tracking-tight mb-6">{t("newCustomer")}</h1>
      {error && <p className="text-red-600 dark:text-red-400 text-sm mb-4">{error}</p>}
      <CustomerForm onSubmit={handleSubmit} submitLabel={t("createCustomer")} />
    </div>
  );
}
