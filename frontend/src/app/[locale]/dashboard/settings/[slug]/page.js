"use client";

import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import SettingsIcon from "@/components/SettingsIcon";
import { masterCatalogs, systemConfig } from "@/lib/settingsCatalogs";

export default function SettingsCatalogPage() {
  const { slug } = useParams();
  const t = useTranslations("settings");
  const item = [...masterCatalogs, ...systemConfig].find((c) => c.slug === slug);

  return (
    <div>
      <Link href="/dashboard/settings" className="text-sm text-blue-600">← {t("backToSettings")}</Link>

      <div className="bg-white dark:bg-gray-900 dark:border dark:border-gray-800 rounded-xl shadow-sm p-10 mt-4 flex flex-col items-center text-center gap-3">
        <SettingsIcon name={item?.icon || "target"} className="w-10 h-10 text-gray-400" />
        <h1 className="text-xl font-semibold">{item ? t(`catalogs.${item.labelKey}`) : slug}</h1>
        <p className="text-gray-500 text-sm">{t("comingSoon")}</p>
      </div>
    </div>
  );
}
