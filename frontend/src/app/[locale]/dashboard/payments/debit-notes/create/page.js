"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import { useRouter } from "@/i18n/navigation";
import NoteForm from "@/components/NoteForm";
import { createDebitNote } from "@/lib/api";

export default function CreateDebitNotePage() {
  const router = useRouter();
  const t = useTranslations("notes");
  const searchParams = useSearchParams();
  const [error, setError] = useState("");

  // Al venir del detalle de un pago ("+ New Debit Note"), ese pago y su tipo llegan en la URL y
  // el formulario arranca con ellos puestos. Llegar en blanco desde ahí hacía creer que la nota
  // quedaría en ese pago, y nacía suelta — luego "Apply" la marcaba aplicada a nada.
  //
  // Desde la lista "Por decidir" de statements llega la parte completa: número, requisición
  // (como factura de la nota), monto, fecha y sucursal — para que aplicar un renglón sea elegir
  // el destino, no volver a teclear lo que el statement ya dijo.
  const paymentParam = searchParams.get("payment");
  const prefill = {};
  for (const [param, campo, esNumero] of [
    ["partNumber", "partNumber"], ["invoiceNumber", "invoiceNumber"], ["amount", "amount", true],
    ["issueDate", "issueDate"], ["entityName", "entityName"],
  ]) {
    const v = searchParams.get(param);
    if (v) prefill[campo] = esNumero ? Number(v) : v;
  }
  // El cargo al técnico llega aparte del "Related Payment" y es el lado que RESTA: desde el pago de
  // un técnico, la nota va contra el DISTRIBUIDOR que vendió la pieza y el técnico entra por aquí,
  // con su lote ya puesto en "Deducted in payment". Antes ese enlace mandaba entityType=TECHNICIAN
  // y el lote como Related Payment, que es justo lo contrario: le SUMA a su pago (Antonio, 9-sep).
  const chargeTechnician = searchParams.get("chargeTechnician") || "";
  const chargePayoutId = searchParams.get("chargePayoutId") || "";
  const initialData = paymentParam || chargeTechnician || Object.keys(prefill).length
    ? {
        ...(paymentParam ? { relatedPaymentId: Number(paymentParam) } : {}),
        entityType: searchParams.get("entityType") || "DISTRIBUTOR",
        // NoteForm lee el cargo con los nombres de la nota guardada, no con los del formulario.
        ...(chargeTechnician ? { chargedToType: "TECHNICIAN", technician: chargeTechnician } : {}),
        ...(chargePayoutId ? { chargePayoutId: Number(chargePayoutId) } : {}),
        ...prefill,
      }
    : undefined;

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
      <NoteForm noteType="DEBIT" initialData={initialData} onSubmit={handleSubmit} submitLabel={t("newDebitNote")} />
    </div>
  );
}
