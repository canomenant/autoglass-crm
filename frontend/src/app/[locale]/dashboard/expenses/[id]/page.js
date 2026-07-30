"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import ExpenseForm from "@/components/ExpenseForm";
import { getExpense, updateExpense } from "@/lib/api";

export default function EditExpensePage() {
  const { id } = useParams();
  const t = useTranslations("expenses");
  const tc = useTranslations("common");
  const [expense, setExpense] = useState(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    getExpense(id).then(setExpense).catch((e) => setError(e.message));
  }, [id]);

  async function handleSubmit(data) {
    try {
      const updated = await updateExpense(id, data);
      setExpense(updated);
      setMessage(t("updated"));
    } catch (e) {
      setError(e.message);
    }
  }

  if (error) return <p className="text-red-600 dark:text-red-400 text-sm">{error}</p>;
  if (!expense) return <p className="text-gray-500 text-sm">{tc("loading")}</p>;

  return (
    <div>
      <h1 className="text-2xl font-semibold dark:text-gray-100 tracking-tight mb-6">{t("expenseNumber", { id: expense.id })}</h1>
      {message && <p className="text-green-600 dark:text-green-400 text-sm mb-4">{message}</p>}
      <ExpenseForm initialData={expense} onSubmit={handleSubmit} submitLabel={tc("saveChanges")} />
    </div>
  );
}
