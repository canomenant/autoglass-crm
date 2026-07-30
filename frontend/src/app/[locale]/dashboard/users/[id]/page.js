"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import UserForm from "@/components/UserForm";
import { getUser, updateUser } from "@/lib/api";

export default function EditUserPage() {
  const { id } = useParams();
  const t = useTranslations("users");
  const tc = useTranslations("common");
  const [user, setUser] = useState(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    getUser(id).then(setUser).catch((e) => setError(e.message));
  }, [id]);

  async function handleSubmit(data) {
    try {
      const updated = await updateUser(id, data);
      setUser(updated);
      setMessage(t("updated"));
    } catch (e) {
      setError(e.message);
    }
  }

  if (error) return <p className="text-red-600 dark:text-red-400 text-sm">{error}</p>;
  if (!user) return <p className="text-gray-500 text-sm">{tc("loading")}</p>;

  return (
    <div>
      <h1 className="text-2xl font-semibold dark:text-gray-100 tracking-tight mb-6">{user.name}</h1>
      {message && <p className="text-green-600 dark:text-green-400 text-sm mb-4">{message}</p>}
      <UserForm initialData={user} onSubmit={handleSubmit} submitLabel={tc("saveChanges")} />
    </div>
  );
}
