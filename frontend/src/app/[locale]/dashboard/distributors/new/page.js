"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import DistributorForm from "@/components/DistributorForm";
import { createDistributor } from "@/lib/api";

export default function NewDistributorPage() {
  const router = useRouter();
  const t = useTranslations("distributors");
  const [error, setError] = useState("");

  async function handleSubmit(data) {
    try {
      const distributor = await createDistributor(data);
      router.push(`/dashboard/distributors/${distributor.id}`);
    } catch (e) {
      setError(e.message);
    }
  }

  return (
    <div>
      <h1 className="text-2xl font-semibold dark:text-gray-100 tracking-tight mb-6">{t("newDistributor")}</h1>
      {error && <p className="text-red-600 dark:text-red-400 text-sm mb-4">{error}</p>}
      <DistributorForm onSubmit={handleSubmit} submitLabel={t("createDistributor")} />
    </div>
  );
}
