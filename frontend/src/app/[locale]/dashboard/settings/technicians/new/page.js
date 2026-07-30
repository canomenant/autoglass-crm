"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import TechnicianForm from "@/components/TechnicianForm";
import { createTechnician } from "@/lib/api";

export default function NewTechnicianPage() {
  const router = useRouter();
  const t = useTranslations("technicians");
  const [error, setError] = useState("");

  async function handleSubmit(data) {
    try {
      const technician = await createTechnician(data);
      router.push(`/dashboard/settings/technicians/${technician.id}`);
    } catch (e) {
      setError(e.message);
    }
  }

  return (
    <div>
      <h1 className="text-2xl font-semibold dark:text-gray-100 tracking-tight mb-6">{t("newTechnician")}</h1>
      {error && <p className="text-red-600 dark:text-red-400 text-sm mb-4">{error}</p>}
      <TechnicianForm onSubmit={handleSubmit} submitLabel={t("createTechnician")} />
    </div>
  );
}
