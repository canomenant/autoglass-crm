"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import Image from "next/image";
import { getMobileWorkOrder, updateMobileWorkOrder } from "@/lib/api";

function Row({ label, value }) {
  if (!value) return null;
  return (
    <div className="py-2 border-b last:border-0 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800/60 transition-colors">
      <div className="text-xs text-gray-400 uppercase">{label}</div>
      <div className="text-base font-medium">{value}</div>
    </div>
  );
}

export default function MobileWorkOrderPage() {
  const { token } = useParams();
  const t = useTranslations("techMobile");
  const [wo, setWo] = useState(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  function load() {
    getMobileWorkOrder(token).then(setWo).catch((e) => setError(e.message));
  }

  useEffect(load, [token]);

  async function handleComplete() {
    if (!confirm(t("confirmComplete"))) return;
    try {
      const updated = await updateMobileWorkOrder(token, { status: "Completed" });
      setWo((prev) => ({ ...prev, status: updated.status }));
      setMessage(t("jobCompleted"));
    } catch (e) {
      setError(e.message);
    }
  }

  function handleUploadPhotos(e) {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;
    Promise.all(
      files.map(
        (file) =>
          new Promise((resolve) => {
            const reader = new FileReader();
            reader.onload = () => resolve({ name: file.name, url: reader.result });
            reader.readAsDataURL(file);
          })
      )
    ).then(async (newPhotos) => {
      const techPhotos = [...(wo.techPhotos || []), ...newPhotos];
      try {
        await updateMobileWorkOrder(token, { techPhotos });
        setWo((prev) => ({ ...prev, techPhotos }));
      } catch (err) {
        setError(err.message);
      }
    });
    e.target.value = "";
  }

  if (error) return <div className="min-h-screen flex items-center justify-center text-red-600 dark:text-red-400 text-sm p-4 text-center">{error}</div>;
  if (!wo) return <div className="min-h-screen flex items-center justify-center text-gray-500 text-sm">{"..."}</div>;

  const vehicle = [wo.vehicle?.year, wo.vehicle?.make, wo.vehicle?.model].filter(Boolean).join(" ");
  const mapsUrl = wo.address ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(wo.address)}` : "";
  const telUrl = wo.phone ? `tel:${wo.phone.replace(/[^0-9+]/g, "")}` : "";

  return (
    <div className="min-h-screen bg-gray-100">
      <div className="bg-gray-900 text-white p-4 flex items-center gap-3">
        <div className="w-10 h-10 rounded overflow-hidden bg-white flex-shrink-0">
          <Image src="/logo.png" alt="" width={80} height={80} className="w-full h-auto" />
        </div>
        <div>
          <div className="font-bold text-lg">{wo.workOrderNo}</div>
          <div className="text-xs text-gray-300">{t(`statuses.${wo.status}`)}</div>
        </div>
      </div>

      <div className="max-w-md mx-auto p-4 space-y-4">
        {message && <p className="text-green-700 bg-green-50 rounded px-3 py-2 text-sm">{message}</p>}

        <div className="bg-white dark:bg-gray-900 dark:border dark:border-gray-800 rounded-xl shadow-sm p-4">
          <Row label={t("customer")} value={wo.customerName} />
          <Row label={t("phone")} value={wo.phone} />
          <Row label={t("address")} value={wo.address} />
          <Row label={t("appointment")} value={[wo.appointmentDate, wo.appointmentTime].filter(Boolean).join(" ")} />
          <Row label={t("vehicle")} value={vehicle} />
          <Row label={t("vin")} value={wo.vehicle?.vin} />
          <Row label={t("partNumber")} value={wo.partNumber} />
          <Row label={t("distributor")} value={wo.distributor} />
          <Row label={t("insuranceCompany")} value={wo.insuranceCompanyName} />
          <Row label={t("claimNumber")} value={wo.claimNumber} />
          <Row label={t("specialInstructions")} value={wo.specialInstructions} />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <a href={telUrl} className={`flex items-center justify-center gap-2 rounded-lg py-4 text-white font-semibold text-sm ${telUrl ? "bg-green-600" : "bg-gray-300 pointer-events-none"}`}>
            {t("callCustomer")}
          </a>
          <a href={mapsUrl} target="_blank" rel="noreferrer" className={`flex items-center justify-center gap-2 rounded-lg py-4 text-white font-semibold text-sm ${mapsUrl ? "bg-blue-600" : "bg-gray-300 pointer-events-none"}`}>
            {t("openMaps")}
          </a>
        </div>

        <label className="block text-center bg-white border-2 border-dashed rounded-lg py-4 text-blue-600 font-semibold text-sm cursor-pointer">
          {t("uploadPhotos")}
          <input type="file" accept="image/*" multiple capture="environment" className="hidden" onChange={handleUploadPhotos} />
        </label>

        {wo.techPhotos?.length > 0 && (
          <div className="grid grid-cols-3 gap-2">
            {wo.techPhotos.map((p, i) => (
              <img key={i} src={p.url} alt={p.name} className="w-full aspect-square object-cover rounded" />
            ))}
          </div>
        )}

        {wo.status !== "Completed" && wo.status !== "Cancelled" && (
          <button onClick={handleComplete} className="w-full bg-gray-900 hover:bg-gray-800 dark:bg-blue-600 dark:hover:bg-blue-700 text-white rounded-lg transition-colors py-4 font-semibold text-sm">
            {t("completeJob")}
          </button>
        )}

        <p className="text-xs text-gray-400 text-center pt-2">{t("signatureNote")}</p>
      </div>
    </div>
  );
}
