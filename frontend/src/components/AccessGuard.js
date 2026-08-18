"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { usePathname, useRouter } from "@/i18n/navigation";
import { getCurrentUser } from "@/lib/api";
import { canAccessPath } from "@/lib/permissions";

export default function AccessGuard({ children }) {
  const t = useTranslations("common");
  const pathname = usePathname();
  const router = useRouter();
  const [status, setStatus] = useState("checking");

  useEffect(() => {
    const user = getCurrentUser();
    const token = typeof window !== "undefined" ? localStorage.getItem("token") : null;

    if (!user || !token) {
      router.replace("/login");
      return;
    }

    if (user.mustChangePassword && pathname !== "/dashboard/change-password") {
      router.replace("/dashboard/change-password");
      return;
    }

    setStatus(canAccessPath(user.role, pathname) ? "allowed" : "denied");
  }, [pathname, router]);

  if (status === "checking") return null;

  if (status === "denied") {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center">
        <div className="w-14 h-14 rounded-full bg-red-100 dark:bg-red-950 text-red-500 flex items-center justify-center mb-4">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="w-7 h-7">
            <circle cx="12" cy="12" r="9" />
            <line x1="8" y1="8" x2="16" y2="16" />
            <line x1="16" y1="8" x2="8" y2="16" />
          </svg>
        </div>
        <h1 className="text-xl font-bold dark:text-gray-100">{t("accessDenied")}</h1>
        <p className="text-sm text-gray-500 mt-1">{t("accessDeniedMessage")}</p>
      </div>
    );
  }

  return children;
}
