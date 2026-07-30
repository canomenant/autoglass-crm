"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import AgentForm from "@/components/AgentForm";
import { createAgent } from "@/lib/api";

export default function NewAgentPage() {
  const router = useRouter();
  const t = useTranslations("agents");
  const [error, setError] = useState("");

  async function handleSubmit(data) {
    try {
      const agent = await createAgent(data);
      router.push(`/dashboard/settings/agents/${agent.id}`);
    } catch (e) {
      setError(e.message);
    }
  }

  return (
    <div>
      <h1 className="text-2xl font-semibold dark:text-gray-100 tracking-tight mb-6">{t("newAgent")}</h1>
      {error && <p className="text-red-600 dark:text-red-400 text-sm mb-4">{error}</p>}
      <AgentForm onSubmit={handleSubmit} submitLabel={t("createAgent")} />
    </div>
  );
}
