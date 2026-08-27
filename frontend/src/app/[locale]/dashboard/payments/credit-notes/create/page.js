"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import { useRouter } from "@/i18n/navigation";
import NoteForm from "@/components/NoteForm";
import { createCreditNote } from "@/lib/api";

export default function CreateCreditNotePage() {
  const router = useRouter();
  const t = useTranslations("notes");
  const searchParams = useSearchParams();
  const [error, setError] = useState("");

  // Al venir del detalle de un pago ("+ New Credit Note"), ese pago y su tipo llegan en la URL y
  // el formulario arranca con ellos puestos. Llegar en blanco desde ahí hacía creer que la nota
  // quedaría en ese pago, y nacía suelta — luego "Apply" la marcaba aplicada a nada.
  const paymentParam = searchParams.get("payment");
  const initialData = paymentParam
    ? { relatedPaymentId: Number(paymentParam), entityType: searchParams.get("entityType") || "DISTRIBUTOR" }
    : undefined;

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
      <NoteForm noteType="CREDIT" initialData={initialData} onSubmit={handleSubmit} submitLabel={t("newCreditNote")} />
    </div>
  );
}
