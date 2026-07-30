"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import NoteForm from "@/components/NoteForm";
import { createCreditNote } from "@/lib/api";

export default function CreateCreditNotePage() {
  const router = useRouter();
  const t = useTranslations("notes");
  const [error, setError] = useState("");

  async function handleSubmit(data) {
    try {
      await createCreditNote(data);
      router.push("/dashboard/payments/credit-notes");
    } catch (e) {
      setError(e.message);
    }
  }

  return (
    <div>
      <h1 className="text-2xl font-semibold dark:text-gray-100 tracking-tight mb-6">{t("newCreditNote")}</h1>
      {error && <p className="text-red-600 dark:text-red-400 text-sm mb-4">{error}</p>}
      <NoteForm noteType="CREDIT" onSubmit={handleSubmit} submitLabel={t("newCreditNote")} />
    </div>
  );
}
