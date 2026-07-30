"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import InsuranceForm from "@/components/InsuranceForm";
import { createInsuranceCompany } from "@/lib/api";

export default function NewInsurancePage() {
  const router = useRouter();
  const t = useTranslations("insurance");
  const [error, setError] = useState("");

  async function handleSubmit(data) {
    try {
      const company = await createInsuranceCompany(data);
      router.push(`/dashboard/settings/insurance-companies/${company.id}`);
    } catch (e) {
      setError(e.message);
    }
  }

  return (
    <div>
      <h1 className="text-2xl font-semibold dark:text-gray-100 tracking-tight mb-6">{t("newCompany")}</h1>
      {error && <p className="text-red-600 dark:text-red-400 text-sm mb-4">{error}</p>}
      <InsuranceForm onSubmit={handleSubmit} submitLabel={t("createCompany")} />
    </div>
  );
}
