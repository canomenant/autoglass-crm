"use client";

import { useState } from "react";
import Image from "next/image";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";

export default function LoginPage() {
  const router = useRouter();
  const t = useTranslations("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  // El reto del segundo factor. Mientras vale algo, el formulario pide el código en vez de la
  // contraseña: la contraseña ya se validó y no vuelve a viajar.
  const [challenge, setChallenge] = useState(null);
  const [code, setCode] = useState("");

  const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

  function startSession(data) {
    localStorage.setItem("token", data.token);
    localStorage.setItem("user", JSON.stringify(data.user));
    router.push("/dashboard");
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");

    try {
      const res = await fetch(`${API}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });

      if (res.status === 429) {
        setError(t("tooManyAttempts"));
        return;
      }
      if (!res.ok) {
        setError(t("invalidCredentials"));
        return;
      }

      const data = await res.json();
      // Contraseña correcta pero la cuenta tiene segundo factor: todavía no hay sesión.
      if (data.mfaRequired) {
        setChallenge(data.challenge);
        setPassword("");
        return;
      }
      startSession(data);
    } catch {
      setError(t("connectionError"));
    }
  }

  async function handleVerify(e) {
    e.preventDefault();
    setError("");

    try {
      const res = await fetch(`${API}/api/auth/mfa/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ challenge, token: code.trim() }),
      });

      if (res.status === 429) {
        setError(t("tooManyAttempts"));
        return;
      }

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        // El reto caduca a los 5 minutos: cuando eso pasa hay que volver a empezar por la
        // contraseña, así que se devuelve el formulario a su estado inicial.
        if (/expired/i.test(data.error || "")) {
          setChallenge(null);
          setCode("");
          setError(t("mfaExpired"));
        } else {
          setError(t("mfaInvalid"));
          setCode("");
        }
        return;
      }
      startSession(data);
    } catch {
      setError(t("connectionError"));
    }
  }

  // Segundo paso: sólo el código. Ni correo ni contraseña vuelven a mostrarse — ya se validaron
  // y lo único que falta es demostrar que se tiene el teléfono.
  if (challenge) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <form onSubmit={handleVerify} className="bg-white shadow rounded-lg p-8 w-full max-w-sm space-y-4">
          <div className="rounded-xl overflow-hidden w-40 mx-auto">
            <Image src="/logo.png" alt="Reyes Auto Glass Group" width={300} height={300} className="w-full h-auto block" priority />
          </div>

          <div>
            <h1 className="text-lg font-semibold text-gray-900 dark:text-gray-100">{t("mfaTitle")}</h1>
            <p className="text-sm text-gray-500 mt-1">{t("mfaHint")}</p>
          </div>

          <div>
            <label className="block text-sm mb-1 text-gray-600 dark:text-gray-300">{t("mfaCode")}</label>
            <input
              // inputMode numérico y autocompletado del SMS/app: es un campo que se teclea a
              // contrarreloj, con 30 segundos de vida.
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              autoFocus
              value={code}
              onChange={(e) => setCode(e.target.value)}
              className="w-full border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-3 py-2 tracking-[0.4em] text-center text-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-shadow"
              required
            />
          </div>

          {error && <p className="text-red-600 dark:text-red-400 text-sm">{error}</p>}

          <button type="submit" className="w-full bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors py-2">
            {t("mfaSubmit")}
          </button>

          <button
            type="button"
            onClick={() => { setChallenge(null); setCode(""); setError(""); }}
            className="w-full text-sm text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
          >
            {t("mfaBack")}
          </button>
        </form>
      </div>
    );
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
      </form>
    </div>
  );
}
