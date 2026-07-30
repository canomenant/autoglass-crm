"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { getPayments, getDistributors } from "@/lib/api";

function money(n) {
  return `$${Number(n || 0).toFixed(2)}`;
}

export default function DistributorPaymentsReportPage() {
  const t = useTranslations("payments");
  const [rows, setRows] = useState([]);
  const [error, setError] = useState("");

  useEffect(() => {
    Promise.all([getPayments({ type: "DISTRIBUTOR" }), getDistributors()])
      .then(([payments, distributors]) => {
        const byDist = {};
        payments.forEach((p) => {
          const key = p.distributorId || "unassigned";
          if (!byDist[key]) {
            const dist = distributors.find((d) => d.id === p.distributorId);
            byDist[key] = {
              id: key,
              name: dist ? dist.name : "—",
              totalInvoices: 0,
              totalPaid: 0,
              openBalance: 0,
              overdueBalance: 0,
            };
          }
          const bucket = byDist[key];
          bucket.totalInvoices += 1;
          if (p.status === "Paid") bucket.totalPaid += Number(p.totalAmount || 0);
          else if (p.status === "Overdue") bucket.overdueBalance += Number(p.totalAmount || 0);
          else if (p.status !== "Cancelled") bucket.openBalance += Number(p.totalAmount || 0);
        });
        setRows(Object.values(byDist));
      })
      .catch((e) => setError(e.message));
  }, []);

  return (
    <div>
      <Link href="/dashboard/payments" className="text-sm text-gray-500">← {t("backToPayments")}</Link>
      <h1 className="text-2xl font-semibold dark:text-gray-100 tracking-tight my-4">{t("distributorReport")}</h1>
      {error && <p className="text-red-600 dark:text-red-400 text-sm mb-4">{error}</p>}

      <div className="bg-white dark:bg-gray-900 dark:border dark:border-gray-800 rounded-xl shadow-sm overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left border-b dark:border-gray-800">
              <th className="p-3">{t("distributor")}</th>
              <th className="p-3">{t("totalInvoices")}</th>
              <th className="p-3">{t("totalPaid")}</th>
              <th className="p-3">{t("openBalance")}</th>
              <th className="p-3">{t("overdueBalance")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-b last:border-0 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800/60 transition-colors">
                <td className="p-3 font-medium">{r.name}</td>
                <td className="p-3">{r.totalInvoices}</td>
                <td className="p-3">{money(r.totalPaid)}</td>
                <td className="p-3">{money(r.openBalance)}</td>
                <td className="p-3 text-red-600">{money(r.overdueBalance)}</td>
              </tr>
            ))}
            {rows.length === 0 && !error && (
              <tr><td className="p-3 text-gray-500" colSpan={5}>{t("noRecords")}</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
