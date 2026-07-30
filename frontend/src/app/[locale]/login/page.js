"use client";

import { useState } from "react";
import Image from "next/image";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";

const DEMO_ACCOUNTS = [
  { role: "Admin", email: "demo@llamara.com", password: "Demo1234" },
  { role: "Agent", email: "marco.cano@reyesautoglass.com", password: "Agent1234" },
  { role: "Technician", email: "aaron.gomez@reyesautoglass.com", password: "Tech1234" },
];

export default function LoginPage() {
  const router = useRouter();
  const t = useTranslations("login");
  const [email, setEmail] = useState("demo@llamara.com");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  function fillDemo(account) {
    setEmail(account.email);
    setPassword(account.password);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");

    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000"}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });

      if (!res.ok) {
        setError(t("invalidCredentials"));
        return;
      }

      const data = await res.json();
      localStorage.setItem("token", data.token);
      localStorage.setItem("user", JSON.stringify(data.user));
      router.push("/dashboard");
    } catch {
      setError(t("connectionError"));
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center">
      <form onSubmit={handleSubmit} className="bg-white shadow rounded-lg p-8 w-full max-w-sm space-y-4">
        <div className="rounded-xl overflow-hidden w-40 mx-auto">
          <Image src="/logo.png" alt="Reyes Auto Glass Group" width={300} height={300} className="w-full h-auto block" priority />
        </div>

        <div>
          <label className="block text-sm mb-1 text-gray-600 dark:text-gray-300">{t("email")}</label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-shadow"
            required
          />
        </div>

        <div>
          <label className="block text-sm mb-1 text-gray-600 dark:text-gray-300">{t("password")}</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-shadow"
            required
          />
        </div>

        {error && <p className="text-red-600 dark:text-red-400 text-sm">{error}</p>}

        <button type="submit" className="w-full bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors py-2">
          {t("submit")}
        </button>

        <div className="pt-2 border-t border-gray-100 dark:border-gray-700">
          <p className="text-xs text-gray-400 mb-2 text-center">{t("demoAccounts")}</p>
          <div className="grid grid-cols-3 gap-2">
            {DEMO_ACCOUNTS.map((account) => (
              <button
                key={account.role}
                type="button"
                onClick={() => fillDemo(account)}
                className="text-xs border border-gray-200 dark:border-gray-700 dark:text-gray-300 rounded-lg py-1.5 hover:bg-gray-50 dark:hover:bg-gray-800"
              >
                {account.role}
              </button>
            ))}
          </div>
        </div>
      </form>
    </div>
  );
}
