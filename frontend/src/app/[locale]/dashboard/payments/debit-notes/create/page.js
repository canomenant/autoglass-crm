"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import NoteForm from "@/components/NoteForm";
import { createDebitNote } from "@/lib/api";

export default function CreateDebitNotePage() {
  const router = useRouter();
  const t = useTranslations("notes");
  const [error, setError] = useState("");

  async function handleSubmit(data) {
    try {
      await createDebitNote(data);
      router.push("/dashboard/payments/debit-notes");
    } catch (e) {
      setError(e.message);
    }
  }

  return (
    <div>
      <h1 className="text-2xl font-semibold dark:text-gray-100 tracking-tight mb-6">{t("newDebitNote")}</h1>
      {error && <p className="text-red-600 dark:text-red-400 text-sm mb-4">{error}</p>}
      <NoteForm noteType="DEBIT" onSubmit={handleSubmit} submitLabel={t("newDebitNote")} />
    </div>
  );
}
