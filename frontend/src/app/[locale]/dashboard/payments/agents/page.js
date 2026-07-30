"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { getPayments, getAgents } from "@/lib/api";

function money(n) {
  return `$${Number(n || 0).toFixed(2)}`;
}

export default function AgentCommissionsReportPage() {
  const t = useTranslations("payments");
  const [rows, setRows] = useState([]);
  const [error, setError] = useState("");

  useEffect(() => {
    Promise.all([getPayments({ type: "AGENT" }), getAgents()])
      .then(([payments, agentList]) => {
        const byAgent = {};
        payments.forEach((p) => {
          const key = p.agentId || "unassigned";
          if (!byAgent[key]) {
            const agent = agentList.find((u) => u.id === p.agentId);
            byAgent[key] = {
              id: key,
              name: agent ? agent.name : "—",
              commissionGenerated: 0,
              commissionPaid: 0,
              pendingCommission: 0,
            };
          }
          const bucket = byAgent[key];
          bucket.commissionGenerated += Number(p.commissionAmount || 0);
          if (p.status === "Paid") bucket.commissionPaid += Number(p.commissionAmount || 0);
          else if (p.status !== "Cancelled") bucket.pendingCommission += Number(p.commissionAmount || 0);
        });
        setRows(Object.values(byAgent));
      })
      .catch((e) => setError(e.message));
  }, []);

  return (
    <div>
      <Link href="/dashboard/payments" className="text-sm text-gray-500">← {t("backToPayments")}</Link>
      <h1 className="text-2xl font-semibold dark:text-gray-100 tracking-tight my-4">{t("agentReport")}</h1>
      {error && <p className="text-red-600 dark:text-red-400 text-sm mb-4">{error}</p>}

      <div className="bg-white dark:bg-gray-900 dark:border dark:border-gray-800 rounded-xl shadow-sm overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left border-b dark:border-gray-800">
              <th className="p-3">{t("agent")}</th>
              <th className="p-3">{t("commissionGenerated")}</th>
              <th className="p-3">{t("commissionPaid")}</th>
              <th className="p-3">{t("pendingCommission")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-b last:border-0 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800/60 transition-colors">
                <td className="p-3 font-medium">{r.name}</td>
                <td className="p-3">{money(r.commissionGenerated)}</td>
                <td className="p-3">{money(r.commissionPaid)}</td>
                <td className="p-3">{money(r.pendingCommission)}</td>
              </tr>
            ))}
            {rows.length === 0 && !error && (
              <tr><td className="p-3 text-gray-500" colSpan={4}>{t("noRecords")}</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
