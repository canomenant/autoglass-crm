"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { getPayments, getTechnicians } from "@/lib/api";

function money(n) {
  return `$${Number(n || 0).toFixed(2)}`;
}

export default function TechnicianPaymentsReportPage() {
  const t = useTranslations("payments");
  const tc = useTranslations("common");
  const [rows, setRows] = useState([]);
  const [error, setError] = useState("");

  useEffect(() => {
    Promise.all([getPayments({ type: "TECHNICIAN" }), getTechnicians()])
      .then(([payments, techList]) => {
        const byTech = {};
        payments.forEach((p) => {
          const key = p.technicianId || "unassigned";
          if (!byTech[key]) {
            const tech = techList.find((u) => u.id === p.technicianId);
            byTech[key] = {
              id: key,
              name: tech ? tech.name : "—",
              totalEarned: 0,
              totalPaid: 0,
              bonuses: 0,
              deductions: 0,
              outstanding: 0,
            };
          }
          const bucket = byTech[key];
          bucket.totalEarned += Number(p.baseAmount || 0) + Number(p.bonus || 0);
          bucket.bonuses += Number(p.bonus || 0);
          bucket.deductions += Number(p.deductions || 0);
          if (p.status === "Paid") bucket.totalPaid += Number(p.netAmount || 0);
          else if (p.status !== "Cancelled") bucket.outstanding += Number(p.netAmount || 0);
        });
        setRows(Object.values(byTech));
      })
      .catch((e) => setError(e.message));
  }, []);

  return (
    <div>
      <Link href="/dashboard/payments" className="text-sm text-gray-500">← {t("backToPayments")}</Link>
      <h1 className="text-2xl font-semibold dark:text-gray-100 tracking-tight my-4">{t("technicianReport")}</h1>
      {error && <p className="text-red-600 dark:text-red-400 text-sm mb-4">{error}</p>}

      <div className="bg-white dark:bg-gray-900 dark:border dark:border-gray-800 rounded-xl shadow-sm overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left border-b dark:border-gray-800">
              <th className="p-3">{t("technician")}</th>
              <th className="p-3">{t("totalEarned")}</th>
              <th className="p-3">{t("totalPaid")}</th>
              <th className="p-3">{t("bonus")}</th>
              <th className="p-3">{t("deductions")}</th>
              <th className="p-3">{t("outstanding")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-b last:border-0 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800/60 transition-colors">
                <td className="p-3 font-medium">{r.name}</td>
                <td className="p-3">{money(r.totalEarned)}</td>
                <td className="p-3">{money(r.totalPaid)}</td>
                <td className="p-3">{money(r.bonuses)}</td>
                <td className="p-3">{money(r.deductions)}</td>
                <td className="p-3">{money(r.outstanding)}</td>
              </tr>
            ))}
            {rows.length === 0 && !error && (
              <tr><td className="p-3 text-gray-500" colSpan={6}>{t("noRecords")}</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
