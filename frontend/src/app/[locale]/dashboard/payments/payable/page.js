"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import PayableBalances from "@/components/PayableBalances";
import { getPayableSummary } from "@/lib/api";
import { money } from "@/components/OrderSummaryUI";

const KINDS = ["TECH", "AGENT", "DISTRIBUTOR"];

// Una sola pagina para los tres tipos: el modelo de obligaciones es uno solo, asi que la vista
// tambien. Convive con /dashboard/payments, que sigue mostrando los lotes ya creados.
export default function PayablePage() {
  const t = useTranslations("payable");
  const [kind, setKind] = useState("TECH");
  const [summary, setSummary] = useState(null);
  const [reloadKey, setReloadKey] = useState(0);

  // Se recarga al cambiar de pestaña y despues de crear un lote, para que los totales de las
  // solapas no queden mostrando un saldo que ya se pago.
  useEffect(() => {
    getPayableSummary().then(setSummary).catch(() => {});
  }, [kind, reloadKey]);

  const total = summary ? KINDS.reduce((a, k) => a + (summary[k]?.pendingAmount || 0), 0) : 0;

  return (
    <div>
      <div className="flex items-baseline justify-between mb-4">
        <h1 className="text-2xl font-semibold dark:text-gray-100 tracking-tight">{t("pageTitle")}</h1>
        {summary && <span className="text-sm text-gray-500 dark:text-gray-400">{t("grandTotal", { amount: money(total) })}</span>}
      </div>

      <div className="flex flex-wrap gap-2 mb-4">
        {KINDS.map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => setKind(k)}
            className={`rounded-lg px-4 py-2 text-sm transition-colors ${
              kind === k
                ? "bg-gray-900 dark:bg-blue-600 text-white"
                : "border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800"
            }`}
          >
            {t(`title.${k}`)}
            {summary?.[k] && <span className="ml-2 opacity-70">{money(summary[k].pendingAmount)}</span>}
          </button>
        ))}
      </div>

      <PayableBalances key={kind} kind={kind} onChanged={() => setReloadKey((n) => n + 1)} />
    </div>
  );
}
