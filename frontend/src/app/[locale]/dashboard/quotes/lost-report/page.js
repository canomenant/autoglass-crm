"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { getQuotes, getPartnerCompanies } from "@/lib/api";
import { isLostStatus } from "@/lib/quoteStatuses";
import { getQuoteStatusColorClass } from "@/lib/quoteStatusColors";

function money(n) {
  return `$${Number(n || 0).toFixed(2)}`;
}

export default function LostQuotesReportPage() {
  const t = useTranslations("lostQuote");
  const tq = useTranslations("quotes");
  const tc = useTranslations("common");
  const [quotes, setQuotes] = useState([]);
  const [partners, setPartners] = useState([]);
  const [error, setError] = useState("");

  useEffect(() => {
    getQuotes().then(setQuotes).catch((e) => setError(e.message));
    getPartnerCompanies().then(setPartners).catch(() => {});
  }, []);

  const lostQuotes = useMemo(() => quotes.filter((q) => isLostStatus(q.status)), [quotes]);

  const kpis = useMemo(() => {
    const acceptedQuotes = quotes.filter((q) => q.status === "Converted").length;
    const lostRevenue = lostQuotes.reduce((s, q) => s + Number(q.totals?.totalAmount || 0), 0);
    const withCompetitorPrice = lostQuotes.filter((q) => Number(q.lostInfo?.competitorPrice || 0) > 0);
    const competitorAvg = withCompetitorPrice.length
      ? withCompetitorPrice.reduce((s, q) => s + Number(q.lostInfo.competitorPrice || 0), 0) / withCompetitorPrice.length
      : 0;
    const recoverableLeads = lostQuotes.filter((q) => q.lostInfo?.canMatchPrice === "Yes").length;
    const availableForResale = lostQuotes.filter((q) => q.lostInfo?.leadResellCandidate === "Yes" && q.lostInfo?.leadStatus === "Available").length;
    const revenueFromLeadSales = lostQuotes
      .filter((q) => ["Sold", "Converted"].includes(q.lostInfo?.leadStatus))
      .reduce((s, q) => s + Number(q.lostInfo?.salePrice || 0), 0);

    return [
      { label: t("kpiTotalQuotes"), value: quotes.length },
      { label: t("kpiAcceptedQuotes"), value: acceptedQuotes },
      { label: t("kpiLostQuotes"), value: lostQuotes.length },
      { label: t("kpiLostRevenue"), value: money(lostRevenue) },
      { label: t("kpiCompetitorAvgPrice"), value: money(competitorAvg) },
      { label: t("kpiRecoverableLeads"), value: recoverableLeads },
      { label: t("kpiLeadsAvailable"), value: availableForResale },
      { label: t("kpiRevenueFromLeadSales"), value: money(revenueFromLeadSales) },
    ];
  }, [quotes, lostQuotes, t]);

  const topCompetitors = useMemo(() => {
    const map = {};
    lostQuotes.forEach((q) => {
      const name = q.lostInfo?.competitorName;
      if (!name) return;
      if (!map[name]) map[name] = { name, count: 0, totalPrice: 0 };
      map[name].count += 1;
      map[name].totalPrice += Number(q.lostInfo.competitorPrice || 0);
    });
    return Object.values(map)
      .map((c) => ({ ...c, avgPrice: c.totalPrice / c.count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 8);
  }, [lostQuotes]);

  const lossReasons = useMemo(() => {
    const map = {};
    lostQuotes.forEach((q) => {
      const reason = q.lostInfo?.reasonForLoss;
      if (!reason) return;
      map[reason] = (map[reason] || 0) + 1;
    });
    return Object.entries(map).sort((a, b) => b[1] - a[1]);
  }, [lostQuotes]);

  function partnerName(id) {
    return partners.find((p) => p.id === id)?.companyName || "";
  }

  return (
    <div>
      <Link href="/dashboard/quotes" className="text-sm text-gray-500">← {tq("title")}</Link>
      <h1 className="text-2xl font-semibold dark:text-gray-100 tracking-tight my-4">{t("reportTitle")}</h1>

      {error && <p className="text-red-600 dark:text-red-400 text-sm mb-4">{error}</p>}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        {kpis.map((kpi) => (
          <div key={kpi.label} className="bg-white dark:bg-gray-900 dark:border dark:border-gray-800 rounded-xl shadow-sm p-4">
            <div className="text-xs text-gray-500">{kpi.label}</div>
            <div className="text-xl font-bold">{kpi.value}</div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
        <div className="bg-white dark:bg-gray-900 dark:border dark:border-gray-800 rounded-xl shadow-sm p-4">
          <h2 className="font-semibold mb-3 text-sm">{t("topCompetitors")}</h2>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left border-b dark:border-gray-800 text-xs text-gray-400 uppercase">
                <th className="py-2">{t("competitorName")}</th>
                <th className="py-2 text-right">{t("lostCount")}</th>
                <th className="py-2 text-right">{t("avgPrice")}</th>
              </tr>
            </thead>
            <tbody>
              {topCompetitors.map((c) => (
                <tr key={c.name} className="border-b last:border-0 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800/60 transition-colors">
                  <td className="py-2">{c.name}</td>
                  <td className="py-2 text-right">{c.count}</td>
                  <td className="py-2 text-right">{money(c.avgPrice)}</td>
                </tr>
              ))}
              {topCompetitors.length === 0 && <tr><td className="py-2 text-gray-400" colSpan={3}>{t("noData")}</td></tr>}
            </tbody>
          </table>
        </div>

        <div className="bg-white dark:bg-gray-900 dark:border dark:border-gray-800 rounded-xl shadow-sm p-4">
          <h2 className="font-semibold mb-3 text-sm">{t("mostCommonReasons")}</h2>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left border-b dark:border-gray-800 text-xs text-gray-400 uppercase">
                <th className="py-2">{t("reason")}</th>
                <th className="py-2 text-right">{t("lostCount")}</th>
              </tr>
            </thead>
            <tbody>
              {lossReasons.map(([reason, count]) => (
                <tr key={reason} className="border-b last:border-0 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800/60 transition-colors">
                  <td className="py-2">{t(`reasons.${reason}`)}</td>
                  <td className="py-2 text-right">{count}</td>
                </tr>
              ))}
              {lossReasons.length === 0 && <tr><td className="py-2 text-gray-400" colSpan={2}>{t("noData")}</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      <div className="bg-white dark:bg-gray-900 dark:border dark:border-gray-800 rounded-xl shadow-sm overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left border-b dark:border-gray-800">
              <th className="p-3">{tq("quoteNo")}</th>
              <th className="p-3">{tq("customer")}</th>
              <th className="p-3">{tq("status")}</th>
              <th className="p-3">{t("reason")}</th>
              <th className="p-3">{t("competitorName")}</th>
              <th className="p-3">{t("competitorPrice")}</th>
              <th className="p-3">{t("ourQuote")}</th>
              <th className="p-3">{t("differencePercent")}</th>
              <th className="p-3">{t("resellCandidate")}</th>
              <th className="p-3">{t("partnerCompany")}</th>
              <th className="p-3"></th>
            </tr>
          </thead>
          <tbody>
            {lostQuotes.map((q) => (
              <tr key={q.id} className="border-b last:border-0 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800/60 transition-colors">
                <td className="p-3">{q.quoteNo}</td>
                <td className="p-3">{q.customerName}</td>
                <td className="p-3">
                  <span className={`text-xs font-medium rounded-full px-2 py-1 whitespace-nowrap ${getQuoteStatusColorClass(q.status)}`}>
                    {tq(`statuses.${q.status}`)}
                  </span>
                </td>
                <td className="p-3">{q.lostInfo?.reasonForLoss ? t(`reasons.${q.lostInfo.reasonForLoss}`) : ""}</td>
                <td className="p-3">{q.lostInfo?.competitorName}</td>
                <td className="p-3">{money(q.lostInfo?.competitorPrice)}</td>
                <td className="p-3">{money(q.totals?.totalAmount)}</td>
                <td className="p-3">{q.priceAnalysis?.differencePercent ? `${q.priceAnalysis.differencePercent.toFixed(1)}%` : ""}</td>
                <td className="p-3">{q.lostInfo?.leadResellCandidate}</td>
                <td className="p-3">{partnerName(q.lostInfo?.partnerCompanyId)}</td>
                <td className="p-3"><Link href={`/dashboard/quotes/${q.id}`} className="text-blue-600 dark:text-blue-400 hover:underline">{tc("viewEdit")}</Link></td>
              </tr>
            ))}
            {lostQuotes.length === 0 && !error && (
              <tr><td className="p-3 text-gray-500" colSpan={11}>{t("noLostQuotes")}</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
