import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import SettingsIcon from "@/components/SettingsIcon";
import { systemConfig, masterCatalogs } from "@/lib/settingsCatalogs";

function CatalogGrid({ items, t }) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      {items.map((item) => (
        <Link
          key={item.slug}
          href={item.href || `/dashboard/settings/${item.slug}`}
          className="bg-white dark:bg-gray-900 dark:border dark:border-gray-800 rounded-xl shadow-sm p-6 flex flex-col items-center gap-3 text-center hover:shadow-md transition-shadow"
        >
          <SettingsIcon name={item.icon} className="w-7 h-7 text-gray-800" />
          <span className="text-sm font-medium">{t(`catalogs.${item.labelKey}`)}</span>
        </Link>
      ))}
    </div>
  );
}

export default async function SettingsPage() {
  const t = await getTranslations("settings");

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold dark:text-gray-100 tracking-tight mb-6">{t("title")}</h1>
        <CatalogGrid items={systemConfig} t={t} />
      </div>

      <div>
        <h2 className="text-lg font-semibold dark:text-gray-100 tracking-tight mb-4">{t("masterCatalogsSection")}</h2>
        <CatalogGrid items={masterCatalogs} t={t} />
      </div>
    </div>
  );
}
