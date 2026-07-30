"use client";

import SimpleCatalogPage from "@/components/SimpleCatalogPage";
import { getPaymentMethods, createPaymentMethod, updatePaymentMethod, deletePaymentMethod } from "@/lib/api";

export default function PaymentMethodPage() {
  return (
    <SimpleCatalogPage
      icon="credit-card"
      translationKey="paymentMethod"
      getItems={getPaymentMethods}
      createItem={createPaymentMethod}
      updateItem={updatePaymentMethod}
      deleteItem={deletePaymentMethod}
    />
  );
}
