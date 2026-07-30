"use client";

import SimpleCatalogPage from "@/components/SimpleCatalogPage";
import { getPaymentStatuses, createPaymentStatus, updatePaymentStatus, deletePaymentStatus } from "@/lib/api";

export default function PaymentStatusPage() {
  return (
    <SimpleCatalogPage
      icon="shield"
      translationKey="paymentStatus"
      getItems={getPaymentStatuses}
      createItem={createPaymentStatus}
      updateItem={updatePaymentStatus}
      deleteItem={deletePaymentStatus}
    />
  );
}
