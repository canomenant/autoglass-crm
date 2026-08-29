"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import {
  Chart as ChartJS, CategoryScale, LinearScale, BarElement, PointElement, LineElement, Filler, Tooltip, Legend,
} from "chart.js";
import { Bar, Line } from "react-chartjs-2";
import { getWorkOrders, getQuotes, getExpenses, getDistributorsBasic, getAgentsBasic, getProfitLossReport } from "@/lib/api";
import { isCompletedWorkOrderStatus } from "@/lib/workOrderStatuses";
import { DollarIcon, TrendingUpIcon, QuotesIcon, WorkOrdersIcon } from "@/components/Icons";
import { Link } from "@/i18n/navigation";
import ReportsTabs from "@/components/ReportsTabs";

ChartJS.register(CategoryScale, LinearScale, BarElement, PointElement, LineElement, Filler, Tooltip, Legend);

const BLUE = "#2563eb";
const SLATE = "#94a3b8";
const BLUE_DARK = "#1d4ed8";

function money(n) {
  return `$${Number(n || 0).toFixed(2)}`;
}

function monthKey(d) {
  return d ? String(d).slice(0, 7) : null;
}

function toCsv(rows) {
  const header = ["Technician", "Jobs", "Revenue"];
  const lines = rows.map((r) =>
    [r.tech, r.jobs, r.revenue.toFixed(2)].map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`).join(",")
  );
  return [header.join(","), ...lines].join("\n");
}

function StatCard({ icon: Icon, iconClass, label, value }) {
  return (
    <div className="bg-white dark:bg-gray-900 dark:border dark:border-gray-800 rounded-xl shadow-sm hover:shadow-md transition-shadow p-4 flex items-start gap-3">
      <div className={`w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 ${iconClass}`}>
        <Icon className="w-5 h-5" />
      </div>
      <div className="min-w-0">
        <div className="text-xs text-slate-500 dark:text-gray-400 truncate">{label}</div>
        <div className="text-2xl font-bold text-slate-800 dark:text-gray-100 truncate">{value}</div>
      </div>
    </div>
  );
}

export default function ReportsPage() {
  const t = useTranslations("reports");
  const tc = useTranslations("common");


  const [workOrders, setWorkOrders] = useState([]);
  const [quotes, setQuotes] = useState([]);
  const [expenses, setExpenses] = useState([]);
  const [distributors, setDistributors] = useState([]);
  const [agents, setAgents] = useState([]);
  const [error, setError] = useState("");

  const [filters, setFilters] = useState({ dateFrom: "", dateTo: "", distributorId: "", agentId: "" });
  const [plKpis, setPlKpis] = useState(null);

  useEffect(() => {
    Promise.all([getWorkOrders(), getQuotes(), getExpenses(), getDistributorsBasic(), getAgentsBasic()])
      .then(([wo, q, e, d, a]) => {
        setWorkOrders(wo);
        setQuotes(q);
        setExpenses(e);
        setDistributors(d);
        setAgents(a);
      })
      .catch((e) => setError(e.message));
  }, []);

  // Revenue/expenses/profit come from the same endpoint the P&L report and the QuickView
  // header cards use, so this page can't show a different number for those three than either
  // of those — the rest of this page (charts, technician/expense tables) still filters by
  // distributor/agent client-side, which the shared endpoint doesn't support, so those two
  // filters don't affect the 3 top KPI cards specifically.
  useEffect(() => {
    getProfitLossReport({ dateFrom: filters.dateFrom, dateTo: filters.dateTo })
      .then(setPlKpis)
      .catch((e) => setError(e.message));
  }, [filters.dateFrom, filters.dateTo]);

  function setFilter(field, value) {
    setFilters((prev) => ({ ...prev, [field]: value }));
  }

  const quoteAgentMap = useMemo(() => {
    const map = new Map();
    quotes.forEach((q) => map.set(q.id, q.agentId));
    return map;
  }, [quotes]);

  const inRange = (d) => {
    if (!d) return !filters.dateFrom && !filters.dateTo;
    if (filters.dateFrom && d < filters.dateFrom) return false;
    if (filters.dateTo && d > filters.dateTo) return false;
    return true;
  };

  const filteredWorkOrders = useMemo(() => {
    return workOrders.filter((w) => {
      if (!inRange(w.appointmentDate)) return false;
      if (filters.distributorId && String(w.distributorId) !== filters.distributorId) return false;
      if (filters.agentId && String(quoteAgentMap.get(w.quoteId)) !== filters.agentId) return false;
      return true;
    });
  }, [workOrders, filters, quoteAgentMap]);

  const filteredQuotes = useMemo(() => {
    return quotes.filter((q) => {
      if (!inRange(q.createdAt?.slice(0, 10))) return false;
      if (filters.agentId && String(q.agentId) !== filters.agentId) return false;
      return true;
    });
  }, [quotes, filters]);

  const filteredExpenses = useMemo(() => {
    return expenses.filter((e) => inRange(e.date));
  }, [expenses, filters]);

  const stats = useMemo(() => {
    const revenueOf = (list) => list.filter((w) => w.payment?.paid).reduce((sum, w) => sum + Number(w.payment.amount || 0), 0);
    const completedOf = (list) => list.filter((w) => isCompletedWorkOrderStatus(w.status)).length;

    const revenue = revenueOf(filteredWorkOrders);
    const totalExpenses = filteredExpenses.reduce((sum, e) => sum + Number(e.amount || 0), 0);
    const personalWOs = filteredWorkOrders.filter((w) => w.workOrderType !== "Insurance");
    const insuranceWOs = filteredWorkOrders.filter((w) => w.workOrderType === "Insurance");

    return {
      revenue,
      expenses: totalExpenses,
      profit: revenue - totalExpenses,
      totalQuotes: filteredQuotes.length,
      convertedQuotes: filteredQuotes.filter((q) => q.status === "Converted").length,
      totalWorkOrders: filteredWorkOrders.length,
      completedWorkOrders: completedOf(filteredWorkOrders),
      pendingPayment: filteredWorkOrders.filter((w) => !w.payment?.paid).length,
      personalWorkOrders: personalWOs.length,
      insuranceWorkOrders: insuranceWOs.length,
      personalRevenue: revenueOf(personalWOs),
      insuranceRevenue: revenueOf(insuranceWOs),
    };
  }, [filteredWorkOrders, filteredQuotes, filteredExpenses]);

  const technicianRows = useMemo(() => {
    const byTech = {};
    filteredWorkOrders.forEach((w) => {
      const tech = w.tech || "Unassigned";
      if (!byTech[tech]) byTech[tech] = { tech, jobs: 0, revenue: 0 };
      byTech[tech].jobs += 1;
      if (w.payment?.paid) byTech[tech].revenue += Number(w.payment.amount || 0);
    });
    return Object.values(byTech).sort((a, b) => b.revenue - a.revenue);
  }, [filteredWorkOrders]);

  const monthly = useMemo(() => {
    const map = new Map();
    filteredWorkOrders.forEach((w) => {
      if (!w.payment?.paid) return;
      const key = monthKey(w.appointmentDate);
      if (!key) return;
      if (!map.has(key)) map.set(key, { revenue: 0, expenses: 0 });
      map.get(key).revenue += Number(w.payment.amount || 0);
    });
    filteredExpenses.forEach((e) => {
      const key = monthKey(e.date);
      if (!key) return;
      if (!map.has(key)) map.set(key, { revenue: 0, expenses: 0 });
      map.get(key).expenses += Number(e.amount || 0);
    });
    const keys = [...map.keys()].sort().slice(-12);
    return keys.map((key) => ({ key, ...map.get(key) }));
  }, [filteredWorkOrders, filteredExpenses]);

  const expenseRows = useMemo(() => {
    const byCategory = {};
    filteredExpenses.forEach((e) => {
      const category = e.category || "Uncategorized";
      byCategory[category] = (byCategory[category] || 0) + Number(e.amount || 0);
    });
    return Object.entries(byCategory)
      .map(([category, total]) => ({ category, total }))
      .sort((a, b) => b.total - a.total);
  }, [filteredExpenses]);

  function handleExportCsv() {
    const csv = toCsv(technicianRows);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "technician-report.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  const chartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: { legend: { position: "bottom", labels: { boxWidth: 10, usePointStyle: true } } },
    scales: {
      x: { grid: { display: false }, ticks: { color: "#94a3b8" } },
      y: { grid: { color: "#f1f5f9" }, ticks: { color: "#94a3b8" } },
    },
  };

  const barData = {
    labels: monthly.map((m) => m.key),
    datasets: [
      { label: t("revenue"), data: monthly.map((m) => m.revenue), backgroundColor: BLUE, borderRadius: 4, maxBarThickness: 28 },
      { label: t("expenses"), data: monthly.map((m) => m.expenses), backgroundColor: SLATE, borderRadius: 4, maxBarThickness: 28 },
    ],
  };

  const lineData = {
    labels: monthly.map((m) => m.key),
    datasets: [
      {
        label: t("profit"),
        data: monthly.map((m) => m.revenue - m.expenses),
        borderColor: BLUE_DARK,
        backgroundColor: "rgba(37,99,235,0.08)",
        pointBackgroundColor: BLUE_DARK,
        pointRadius: 4,
        borderWidth: 2,
        tension: 0.3,
        fill: true,
      },
    ],
  };

  if (error) return <p className="text-red-600 dark:text-red-400 text-sm">{error}</p>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-2xl font-semibold dark:text-gray-100 tracking-tight">{t("title")}</h1>
        <button onClick={handleExportCsv} className="bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg px-4 py-2 transition-colors">
          {t("exportCsv")}
        </button>
      </div>

      <ReportsTabs active="overview" />

      <div className="bg-white dark:bg-gray-900 dark:border dark:border-gray-800 rounded-xl shadow-sm p-4 flex flex-wrap items-end gap-4">
        <div>
          <label htmlFor="report-date-from" className="block text-xs mb-1 text-slate-500 dark:text-gray-400">{t("dateFrom")}</label>
          <input id="report-date-from" type="date" value={filters.dateFrom} onChange={(e) => setFilter("dateFrom", e.target.value)} className="border border-slate-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none" />
        </div>
        <div>
          <label htmlFor="report-date-to" className="block text-xs mb-1 text-slate-500 dark:text-gray-400">{t("dateTo")}</label>
          <input id="report-date-to" type="date" value={filters.dateTo} onChange={(e) => setFilter("dateTo", e.target.value)} className="border border-slate-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none" />
        </div>
        <div>
          <label htmlFor="report-distributor" className="block text-xs mb-1 text-slate-500 dark:text-gray-400">{t("distributor")}</label>
          <select id="report-distributor" value={filters.distributorId} onChange={(e) => setFilter("distributorId", e.target.value)} className="border border-slate-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none min-w-[160px]">
            <option value="">{t("allDistributors")}</option>
            {distributors.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="report-agent" className="block text-xs mb-1 text-slate-500 dark:text-gray-400">{t("agent")}</label>
          <select id="report-agent" value={filters.agentId} onChange={(e) => setFilter("agentId", e.target.value)} className="border border-slate-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none min-w-[160px]">
            <option value="">{t("allAgents")}</option>
            {agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-4">
        <StatCard icon={DollarIcon} iconClass="bg-blue-50 text-blue-600 dark:bg-blue-500/10 dark:text-blue-400" label={t("revenue")} value={plKpis ? money(plKpis.kpis.revenue) : "…"} />
        <StatCard icon={DollarIcon} iconClass="bg-slate-100 text-slate-600 dark:bg-gray-800 dark:text-gray-300" label={t("expenses")} value={plKpis ? money(plKpis.kpis.costs) : "…"} />
        <StatCard icon={TrendingUpIcon} iconClass="bg-blue-50 text-blue-700 dark:bg-blue-500/10 dark:text-blue-400" label={t("profit")} value={plKpis ? money(plKpis.kpis.profit) : "…"} />
        <StatCard icon={QuotesIcon} iconClass="bg-slate-100 text-slate-600 dark:bg-gray-800 dark:text-gray-300" label={t("totalQuotes")} value={stats.totalQuotes} />
        <StatCard icon={WorkOrdersIcon} iconClass="bg-blue-50 text-blue-600 dark:bg-blue-500/10 dark:text-blue-400" label={t("totalWorkOrders")} value={stats.totalWorkOrders} />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <div className="bg-white dark:bg-gray-900 dark:border dark:border-gray-800 rounded-xl shadow-sm p-6">
          <h2 className="font-semibold text-slate-800 dark:text-gray-100 mb-4">{t("revenueVsExpenses")}</h2>
          <div className="h-72">
            <Bar data={barData} options={chartOptions} />
          </div>
        </div>
        <div className="bg-white dark:bg-gray-900 dark:border dark:border-gray-800 rounded-xl shadow-sm p-6">
          <h2 className="font-semibold text-slate-800 dark:text-gray-100 mb-4">{t("profitTrend")}</h2>
          <div className="h-72">
            <Line data={lineData} options={chartOptions} />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        <StatCard icon={WorkOrdersIcon} iconClass="bg-blue-50 text-blue-600 dark:bg-blue-500/10 dark:text-blue-400" label={t("personalOrders")} value={stats.personalWorkOrders} />
        <StatCard icon={WorkOrdersIcon} iconClass="bg-slate-100 text-slate-600 dark:bg-gray-800 dark:text-gray-300" label={t("insuranceOrders")} value={stats.insuranceWorkOrders} />
        <StatCard icon={DollarIcon} iconClass="bg-blue-50 text-blue-600 dark:bg-blue-500/10 dark:text-blue-400" label={t("revenueByPersonal")} value={money(stats.personalRevenue)} />
        <StatCard icon={DollarIcon} iconClass="bg-slate-100 text-slate-600 dark:bg-gray-800 dark:text-gray-300" label={t("revenueByInsurance")} value={money(stats.insuranceRevenue)} />
        <StatCard icon={WorkOrdersIcon} iconClass="bg-blue-50 text-blue-600 dark:bg-blue-500/10 dark:text-blue-400" label={t("completedWorkOrders")} value={stats.completedWorkOrders} />
        <StatCard icon={WorkOrdersIcon} iconClass="bg-slate-100 text-slate-600 dark:bg-gray-800 dark:text-gray-300" label={t("pendingPayment")} value={stats.pendingPayment} />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <div className="bg-white dark:bg-gray-900 dark:border dark:border-gray-800 rounded-xl shadow-sm overflow-hidden">
          <div className="p-6 pb-0">
            <h2 className="font-semibold text-slate-800 dark:text-gray-100 mb-4">{t("technicians")}</h2>
          </div>
          <div className="overflow-x-auto px-6 pb-6">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left border-b border-slate-100 dark:border-gray-800 text-slate-400 dark:text-gray-500">
                  <th className="py-2 pr-4 font-medium">{t("technician")}</th>
                  <th className="py-2 pr-4 font-medium">{t("jobs")}</th>
                  <th className="py-2 pr-0 font-medium text-right">{t("revenue")}</th>
                </tr>
              </thead>
              <tbody>
                {technicianRows.map((row, i) => (
                  <tr key={row.tech} className={`border-b last:border-0 border-slate-50 dark:border-gray-800/60 hover:bg-blue-50/50 dark:hover:bg-gray-800/40 transition-colors ${i % 2 === 1 ? "bg-slate-50/60 dark:bg-gray-800/20" : ""}`}>
                    <td className="py-2.5 pr-4 font-medium text-slate-700 dark:text-gray-200">{row.tech}</td>
                    <td className="py-2.5 pr-4 text-slate-600 dark:text-gray-300">{row.jobs}</td>
                    <td className="py-2.5 pr-0 text-right font-medium text-slate-700 dark:text-gray-200">{money(row.revenue)}</td>
                  </tr>
                ))}
                {technicianRows.length === 0 && (
                  <tr><td className="py-3 text-slate-400" colSpan={3}>{t("noData")}</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="bg-white dark:bg-gray-900 dark:border dark:border-gray-800 rounded-xl shadow-sm overflow-hidden">
          <div className="p-6 pb-0">
            <h2 className="font-semibold text-slate-800 dark:text-gray-100 mb-4">{t("expensesByCategory")}</h2>
          </div>
          <div className="overflow-x-auto px-6 pb-6">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left border-b border-slate-100 dark:border-gray-800 text-slate-400 dark:text-gray-500">
                  <th className="py-2 pr-4 font-medium">{tc("category")}</th>
                  <th className="py-2 pr-0 font-medium text-right">{tc("total")}</th>
                </tr>
              </thead>
              <tbody>
                {expenseRows.map((row, i) => (
                  <tr key={row.category} className={`border-b last:border-0 border-slate-50 dark:border-gray-800/60 hover:bg-blue-50/50 dark:hover:bg-gray-800/40 transition-colors ${i % 2 === 1 ? "bg-slate-50/60 dark:bg-gray-800/20" : ""}`}>
                    <td className="py-2.5 pr-4 font-medium text-slate-700 dark:text-gray-200">{row.category}</td>
                    <td className="py-2.5 pr-0 text-right font-medium text-slate-700 dark:text-gray-200">{money(row.total)}</td>
                  </tr>
                ))}
                {expenseRows.length === 0 && (
                  <tr><td className="py-3 text-slate-400" colSpan={2}>{t("noData")}</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
