"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import ExpenseForm from "@/components/ExpenseForm";
import { createExpense } from "@/lib/api";

export default function NewExpensePage() {
  const router = useRouter();
  const t = useTranslations("expenses");
  const [error, setError] = useState("");

  async function handleSubmit(data) {
    try {
      await createExpense(data);
      router.push("/dashboard/expenses");
    } catch (e) {
      setError(e.message);
    }
  }

  return (
    <div>
      <h1 className="text-2xl font-semibold dark:text-gray-100 tracking-tight mb-6">{t("newExpense")}</h1>
      {error && <p className="text-red-600 dark:text-red-400 text-sm mb-4">{error}</p>}
      <ExpenseForm onSubmit={handleSubmit} submitLabel={t("createExpense")} />
    </div>
  );
}
