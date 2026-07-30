"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import UserForm from "@/components/UserForm";
import { createUser } from "@/lib/api";

export default function NewUserPage() {
  const router = useRouter();
  const t = useTranslations("users");
  const [error, setError] = useState("");

  async function handleSubmit(data) {
    try {
      const user = await createUser(data);
      router.push(`/dashboard/users/${user.id}`);
    } catch (e) {
      setError(e.message);
    }
  }

  return (
    <div>
      <h1 className="text-2xl font-semibold dark:text-gray-100 tracking-tight mb-6">{t("newUser")}</h1>
      {error && <p className="text-red-600 dark:text-red-400 text-sm mb-4">{error}</p>}
      <UserForm onSubmit={handleSubmit} submitLabel={t("createUser")} />
    </div>
  );
}
