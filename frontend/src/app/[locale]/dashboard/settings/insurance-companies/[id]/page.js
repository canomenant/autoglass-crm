"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import InsuranceForm from "@/components/InsuranceForm";
import { getInsuranceCompany, updateInsuranceCompany, getQuotes } from "@/lib/api";

function money(n) {
  return `$${Number(n || 0).toFixed(2)}`;
}

export default function EditInsurancePage() {
  const { id } = useParams();
  const t = useTranslations("insurance");
  const tq = useTranslations("quotes");
  const tc = useTranslations("common");
  const [company, setCompany] = useState(null);
  const [jobs, setJobs] = useState([]);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    getInsuranceCompany(id).then(setCompany).catch((e) => setError(e.message));
    getQuotes()
      .then((quotes) => setJobs(quotes.filter((q) => q.insuranceCompanyId === Number(id))))
      .catch(() => {});
  }, [id]);

  async function handleSubmit(data) {
    try {
      const updated = await updateInsuranceCompany(id, data);
      setCompany(updated);
      setMessage(t("updated"));
    } catch (e) {
      setError(e.message);
    }
  }

  if (error) return <p className="text-red-600 dark:text-red-400 text-sm">{error}</p>;
  if (!company) return <p className="text-gray-500 text-sm">{tc("loading")}</p>;

  return (
    <div>
      <h1 className="text-2xl font-semibold dark:text-gray-100 tracking-tight mb-6">{company.name}</h1>
      {message && <p className="text-green-600 dark:text-green-400 text-sm mb-4">{message}</p>}
      <InsuranceForm initialData={company} onSubmit={handleSubmit} submitLabel={tc("saveChanges")} />

      <section className="bg-white dark:bg-gray-900 dark:border dark:border-gray-800 rounded-xl shadow-sm p-4 mt-6">
        <h2 className="font-semibold mb-3">{t("relatedJobs")}</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left border-b dark:border-gray-800">
                <th className="p-3">{tq("quoteNo")}</th>
                <th className="p-3">{tc("date")}</th>
                <th className="p-3">{tq("customer")}</th>
                <th className="p-3">{tc("vehicleTitle")}</th>
                <th className="p-3">{tq("status")}</th>
                <th className="p-3">{tc("total")}</th>
                <th className="p-3"></th>
              </tr>
            </thead>
            <tbody>
              {jobs.map((q) => (
                <tr key={q.id} className="border-b last:border-0 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800/60 transition-colors">
                  <td className="p-3">{q.quoteNo}</td>
                  <td className="p-3">{q.date}</td>
                  <td className="p-3">{q.customerName}</td>
                  <td className="p-3">{[q.vehicle?.year, q.vehicle?.make, q.vehicle?.model].filter(Boolean).join(" ")}</td>
                  <td className="p-3">{tq(`statuses.${q.status}`)}</td>
                  <td className="p-3">{money(q.totals?.totalAmount)}</td>
                  <td className="p-3"><Link href={`/dashboard/quotes/${q.id}`} className="text-blue-600 dark:text-blue-400 hover:underline">{tc("viewEdit")}</Link></td>
                </tr>
              ))}
              {jobs.length === 0 && (
                <tr><td className="p-3 text-gray-500" colSpan={7}>{t("noRelatedJobs")}</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
