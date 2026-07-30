"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import CustomerForm from "@/components/CustomerForm";
import { getCustomer, updateCustomer } from "@/lib/api";

export default function EditCustomerPage() {
  const { id } = useParams();
  const t = useTranslations("customers");
  const tc = useTranslations("common");
  const [customer, setCustomer] = useState(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    getCustomer(id).then(setCustomer).catch((e) => setError(e.message));
  }, [id]);

  async function handleSubmit(data) {
    try {
      const updated = await updateCustomer(id, data);
      setCustomer(updated);
      setMessage(t("updated"));
    } catch (e) {
      setError(e.message);
    }
  }

  if (error) return <p className="text-red-600 dark:text-red-400 text-sm">{error}</p>;
  if (!customer) return <p className="text-gray-500 text-sm">{tc("loading")}</p>;

  return (
    <div>
      <h1 className="text-2xl font-semibold dark:text-gray-100 tracking-tight mb-6">{customer.name}</h1>
      {message && <p className="text-green-600 dark:text-green-400 text-sm mb-4">{message}</p>}
      <CustomerForm initialData={customer} onSubmit={handleSubmit} submitLabel={tc("saveChanges")} />
    </div>
  );
}
