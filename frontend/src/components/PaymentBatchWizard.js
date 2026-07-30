"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { getTechnicians, getAgents, getDistributors, getEligibleWorkOrders, getPaymentMethods } from "@/lib/api";

const TYPES = ["TECHNICIAN", "DISTRIBUTOR", "AGENT"];
const ENTITY_FETCHERS = { TECHNICIAN: getTechnicians, AGENT: getAgents, DISTRIBUTOR: getDistributors };
const WIZARD_MODES = [...TYPES, "BULK"];

function money(n) {
  return `$${Number(n || 0).toFixed(2)}`;
}

export default function PaymentBatchWizard({ onSubmit, submitLabel }) {
  const t = useTranslations("payments");
  const tc = useTranslations("common");

  const [type, setType] = useState("");
  const [entities, setEntities] = useState([]);
  const [entityId, setEntityId] = useState("");
  const [workOrders, setWorkOrders] = useState([]);
  const [selected, setSelected] = useState(new Set());
  const [paymentMethods, setPaymentMethods] = useState([]);
  const [loadingWorkOrders, setLoadingWorkOrders] = useState(false);
  const [error, setError] = useState("");

  const [bulkDistributors, setBulkDistributors] = useState([]);
  const [bulkAgents, setBulkAgents] = useState([]);
  const [bulkSelectedDistributors, setBulkSelectedDistributors] = useState(new Set());
  const [bulkSelectedAgents, setBulkSelectedAgents] = useState(new Set());
  const [bulkAmounts, setBulkAmounts] = useState({});

  const [selectedDistributorIds, setSelectedDistributorIds] = useState(new Set());
  const [distributorWorkOrders, setDistributorWorkOrders] = useState([]);
  const [distributorAdjustments, setDistributorAdjustments] = useState({});

  const [adjustments, setAdjustments] = useState({
    paymentMethod: "", paymentDate: "", notes: "",
    bonus: 0, deductions: 0,
    invoiceNumber: "", poNumber: "", taxAmount: 0,
  });

  useEffect(() => {
    getPaymentMethods().then(setPaymentMethods).catch(() => {});
  }, []);

  useEffect(() => {
    setEntityId("");
    setWorkOrders([]);
    setSelected(new Set());
    setBulkSelectedDistributors(new Set());
    setBulkSelectedAgents(new Set());
    setBulkAmounts({});
    setSelectedDistributorIds(new Set());
    setDistributorWorkOrders([]);
    setDistributorAdjustments({});
    if (type === "BULK") {
      setEntities([]);
      Promise.all([getDistributors(), getAgents()])
        .then(([distributors, agents]) => {
          setBulkDistributors(distributors);
          setBulkAgents(agents);
        })
        .catch((e) => setError(e.message));
      return;
    }
    if (!type) return setEntities([]);
    ENTITY_FETCHERS[type]().then(setEntities).catch((e) => setError(e.message));
  }, [type]);

  useEffect(() => {
    setWorkOrders([]);
    setSelected(new Set());
    if (!type || !entityId || type === "DISTRIBUTOR") return;
    setLoadingWorkOrders(true);
    getEligibleWorkOrders(type, entityId)
      .then(setWorkOrders)
      .catch((e) => setError(e.message))
      .finally(() => setLoadingWorkOrders(false));
  }, [type, entityId]);

  useEffect(() => {
    if (type !== "DISTRIBUTOR") return;
    if (selectedDistributorIds.size === 0) {
      setDistributorWorkOrders([]);
      setSelected(new Set());
      return;
    }
    setLoadingWorkOrders(true);
    Promise.all(
      [...selectedDistributorIds].map((id) =>
        getEligibleWorkOrders("DISTRIBUTOR", id).then((rows) =>
          rows.map((r) => ({ ...r, distributorId: id, distributorName: entities.find((e) => e.id === id)?.name || "" }))
        )
      )
    )
      .then((groups) => {
        const merged = groups.flat();
        setDistributorWorkOrders(merged);
        setSelected((prev) => new Set([...prev].filter((id) => merged.some((w) => w.id === id))));
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoadingWorkOrders(false));
  }, [type, selectedDistributorIds, entities]);

  function toggle(id) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setSelected((prev) => (prev.size === workOrders.length ? new Set() : new Set(workOrders.map((w) => w.id))));
  }

  function toggleBulkDistributor(id) {
    setBulkSelectedDistributors((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleBulkAgent(id) {
    setBulkSelectedAgents((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function setBulkAmount(key, value) {
    setBulkAmounts((prev) => ({ ...prev, [key]: value }));
  }

  function toggleDistributorEntity(id) {
    setSelectedDistributorIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAllDistributorWorkOrders() {
    setSelected((prev) =>
      prev.size === distributorWorkOrders.length ? new Set() : new Set(distributorWorkOrders.map((w) => w.id))
    );
  }

  function setDistributorAdjustment(distributorId, field, value) {
    setDistributorAdjustments((prev) => ({
      ...prev,
      [distributorId]: { ...prev[distributorId], [field]: value },
    }));
  }

  const selectedWorkOrders = useMemo(() => workOrders.filter((w) => selected.has(w.id)), [workOrders, selected]);
  const baseTotal = useMemo(() => selectedWorkOrders.reduce((sum, w) => sum + Number(w.amountOwed || 0), 0), [selectedWorkOrders]);
  const finalTotal = useMemo(() => {
    if (type === "TECHNICIAN") return baseTotal + Number(adjustments.bonus || 0) - Number(adjustments.deductions || 0);
    return baseTotal;
  }, [type, baseTotal, adjustments]);

  function set(field, value) {
    setAdjustments((prev) => ({ ...prev, [field]: value }));
  }

  const bulkSelectedCount = bulkSelectedDistributors.size + bulkSelectedAgents.size;
  const bulkFinalTotal = useMemo(() => {
    return Object.values(bulkAmounts).reduce((sum, v) => sum + Number(v || 0), 0);
  }, [bulkAmounts]);

  const distributorGroups = useMemo(() => {
    if (type !== "DISTRIBUTOR") return [];
    const map = new Map();
    distributorWorkOrders.forEach((w) => {
      if (!selected.has(w.id)) return;
      if (!map.has(w.distributorId)) {
        map.set(w.distributorId, { distributorId: w.distributorId, distributorName: w.distributorName, workOrders: [] });
      }
      map.get(w.distributorId).workOrders.push(w);
    });
    return [...map.values()].map((g) => ({
      ...g,
      subtotal: g.workOrders.reduce((sum, w) => sum + Number(w.amountOwed || 0), 0),
    }));
  }, [type, distributorWorkOrders, selected]);

  const distributorFinalTotal = useMemo(() => {
    return distributorGroups.reduce(
      (sum, g) => sum + g.subtotal + Number(distributorAdjustments[g.distributorId]?.taxAmount || 0),
      0
    );
  }, [distributorGroups, distributorAdjustments]);

  function handleCreateDistributors() {
    if (distributorGroups.length === 0) return;
    for (const g of distributorGroups) {
      const adj = distributorAdjustments[g.distributorId] || {};
      if (!adj.invoiceNumber) {
        setError(t("distributorInvoiceNumberRequired", { name: g.distributorName }));
        return;
      }
    }
    setError("");

    const payloads = distributorGroups.map((g) => {
      const adj = distributorAdjustments[g.distributorId] || {};
      return {
        type: "DISTRIBUTOR",
        distributorId: g.distributorId,
        workOrderIds: g.workOrders.map((w) => w.id),
        invoiceNumber: adj.invoiceNumber,
        poNumber: adj.poNumber || "",
        taxAmount: Number(adj.taxAmount || 0),
        paymentMethod: adjustments.paymentMethod,
        paymentDate: adjustments.paymentDate,
        notes: adjustments.notes,
      };
    });
    onSubmit(payloads);
  }

  function handleCreateBulk() {
    const distributorRows = bulkDistributors.filter((d) => bulkSelectedDistributors.has(d.id));
    const agentRows = bulkAgents.filter((a) => bulkSelectedAgents.has(a.id));

    for (const row of [...distributorRows, ...agentRows]) {
      const key = distributorRows.includes(row) ? `D-${row.id}` : `A-${row.id}`;
      if (!(Number(bulkAmounts[key]) > 0)) {
        setError(t("bulkAmountRequired"));
        return;
      }
    }
    setError("");

    const shared = {
      paymentMethod: adjustments.paymentMethod,
      paymentDate: adjustments.paymentDate,
      notes: adjustments.notes,
      workOrderIds: [],
    };

    const payloads = [
      ...distributorRows.map((d) => ({
        ...shared,
        type: "DISTRIBUTOR",
        distributorId: d.id,
        manualAmount: Number(bulkAmounts[`D-${d.id}`]),
      })),
      ...agentRows.map((a) => ({
        ...shared,
        type: "AGENT",
        agentId: a.id,
        manualAmount: Number(bulkAmounts[`A-${a.id}`]),
      })),
    ];
    onSubmit(payloads);
  }

  function handleCreate() {
    if (selected.size === 0) return;
    const data = {
      type,
      workOrderIds: [...selected],
      paymentMethod: adjustments.paymentMethod,
      paymentDate: adjustments.paymentDate,
      notes: adjustments.notes,
    };
    if (type === "TECHNICIAN") {
      data.technicianId = Number(entityId);
      data.bonus = Number(adjustments.bonus || 0);
      data.deductions = Number(adjustments.deductions || 0);
    } else if (type === "AGENT") {
      data.agentId = Number(entityId);
    }
    onSubmit(data);
  }

  return (
    <div className="space-y-6">
      {error && <p className="text-red-600 dark:text-red-400 text-sm">{error}</p>}

      <section className="bg-white dark:bg-gray-900 dark:border dark:border-gray-800 rounded-xl shadow-sm p-6">
        <h2 className="font-semibold mb-4">{t("step1SelectType")}</h2>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {WIZARD_MODES.map((tp) => (
            <button
              key={tp}
              type="button"
              onClick={() => setType(tp)}
              className={`border-2 rounded-lg p-6 text-center transition-colors ${
                type === tp ? "border-blue-600 text-blue-600 bg-blue-50 dark:bg-blue-900/20" : "border-dashed hover:border-blue-500 hover:text-blue-600"
              }`}
            >
              <div className="font-semibold">{t(`types.${tp}`)}</div>
            </button>
          ))}
        </div>
      </section>

      {type === "BULK" && (
        <section className="bg-white dark:bg-gray-900 dark:border dark:border-gray-800 rounded-xl shadow-sm p-6">
          <h2 className="font-semibold mb-4">{t("step2SelectBulkEntities")}</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <h3 className="text-sm font-medium mb-2 text-gray-600 dark:text-gray-300">{t("bulkDistributorsLabel")}</h3>
              <div className="flex flex-col gap-2">
                {bulkDistributors.map((d) => (
                  <label key={d.id} className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={bulkSelectedDistributors.has(d.id)} onChange={() => toggleBulkDistributor(d.id)} />
                    {d.name}
                  </label>
                ))}
              </div>
            </div>
            <div>
              <h3 className="text-sm font-medium mb-2 text-gray-600 dark:text-gray-300">{t("bulkAgentsLabel")}</h3>
              <div className="flex flex-col gap-2">
                {bulkAgents.map((a) => (
                  <label key={a.id} className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={bulkSelectedAgents.has(a.id)} onChange={() => toggleBulkAgent(a.id)} />
                    {a.name}
                  </label>
                ))}
              </div>
            </div>
          </div>
        </section>
      )}

      {type === "BULK" && bulkSelectedCount > 0 && (
        <section className="bg-white dark:bg-gray-900 dark:border dark:border-gray-800 rounded-xl shadow-sm p-6">
          <h2 className="font-semibold mb-4">{t("step3BulkAmounts")}</h2>
          <div className="flex flex-col gap-3 mb-4">
            {bulkDistributors.filter((d) => bulkSelectedDistributors.has(d.id)).map((d) => (
              <div key={`D-${d.id}`} className="flex items-center gap-3">
                <span className="text-sm flex-1">{d.name} <span className="text-xs text-gray-500">({t("types.DISTRIBUTOR")})</span></span>
                <input
                  type="number"
                  value={bulkAmounts[`D-${d.id}`] || ""}
                  onChange={(e) => setBulkAmount(`D-${d.id}`, e.target.value)}
                  className="w-40 border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-3 py-2 text-sm"
                />
              </div>
            ))}
            {bulkAgents.filter((a) => bulkSelectedAgents.has(a.id)).map((a) => (
              <div key={`A-${a.id}`} className="flex items-center gap-3">
                <span className="text-sm flex-1">{a.name} <span className="text-xs text-gray-500">({t("types.AGENT")})</span></span>
                <input
                  type="number"
                  value={bulkAmounts[`A-${a.id}`] || ""}
                  onChange={(e) => setBulkAmount(`A-${a.id}`, e.target.value)}
                  className="w-40 border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-3 py-2 text-sm"
                />
              </div>
            ))}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
            <div>
              <label className="block text-sm mb-1 text-gray-600 dark:text-gray-300">{t("paymentMethod")}</label>
              <select value={adjustments.paymentMethod} onChange={(e) => set("paymentMethod", e.target.value)} className="w-full border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-3 py-2 text-sm">
                <option value="">{t("selectPaymentMethod")}</option>
                {paymentMethods.map((m) => <option key={m.id} value={m.name}>{m.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm mb-1 text-gray-600 dark:text-gray-300">{t("paymentDate")}</label>
              <input type="date" value={adjustments.paymentDate} onChange={(e) => set("paymentDate", e.target.value)} className="w-full border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-3 py-2 text-sm" />
            </div>
          </div>

          <div className="mb-4">
            <label className="block text-sm mb-1 text-gray-600 dark:text-gray-300">{tc("notes")}</label>
            <textarea value={adjustments.notes} onChange={(e) => set("notes", e.target.value)} rows={3} className="w-full border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-3 py-2 text-sm" />
          </div>

          <div className="bg-gray-50 dark:bg-gray-800/60 rounded-lg p-4 flex items-center justify-between mb-6">
            <div className="text-sm text-gray-500">{t("finalTotal")}</div>
            <div className="text-2xl font-bold dark:text-gray-100">{money(bulkFinalTotal)}</div>
          </div>

          <button type="button" onClick={handleCreateBulk} className="bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors px-6 py-2">
            {submitLabel || t("createPayment")}
          </button>
        </section>
      )}

      {type === "DISTRIBUTOR" && (
        <section className="bg-white dark:bg-gray-900 dark:border dark:border-gray-800 rounded-xl shadow-sm p-6">
          <h2 className="font-semibold mb-4">{t("step2SelectDistributors")}</h2>
          <div className="flex flex-col gap-2">
            {entities.map((ent) => (
              <label key={ent.id} className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={selectedDistributorIds.has(ent.id)} onChange={() => toggleDistributorEntity(ent.id)} />
                {ent.name}
              </label>
            ))}
          </div>
        </section>
      )}

      {type && type !== "BULK" && type !== "DISTRIBUTOR" && (
        <section className="bg-white dark:bg-gray-900 dark:border dark:border-gray-800 rounded-xl shadow-sm p-6">
          <h2 className="font-semibold mb-4">{t("step2SelectEntity", { type: t(`types.${type}`) })}</h2>
          <select
            value={entityId}
            onChange={(e) => setEntityId(e.target.value)}
            className="w-full max-w-md border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-shadow text-sm"
          >
            <option value="">{t("selectEntityPlaceholder", { type: t(`types.${type}`) })}</option>
            {entities.map((ent) => (
              <option key={ent.id} value={ent.id}>{ent.name}</option>
            ))}
          </select>
        </section>
      )}

      {type === "DISTRIBUTOR" && selectedDistributorIds.size > 0 && (
        <section className="bg-white dark:bg-gray-900 dark:border dark:border-gray-800 rounded-xl shadow-sm p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold">{t("step3SelectWorkOrders")}</h2>
            {distributorWorkOrders.length > 0 && (
              <button type="button" onClick={toggleAllDistributorWorkOrders} className="text-xs text-blue-600 dark:text-blue-400">
                {selected.size === distributorWorkOrders.length ? tc("deselectAll") : tc("selectAll")}
              </button>
            )}
          </div>

          {loadingWorkOrders && <p className="text-sm text-gray-500">{tc("loading")}</p>}
          {!loadingWorkOrders && distributorWorkOrders.length === 0 && (
            <p className="text-sm text-gray-500">{t("noEligibleWorkOrders")}</p>
          )}

          {distributorWorkOrders.length > 0 && (
            <div className="border dark:border-gray-800 rounded-lg overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left border-b dark:border-gray-800 bg-gray-50 dark:bg-gray-800/60">
                    <th className="p-3 w-8"></th>
                    <th className="p-3">{t("workOrder")}</th>
                    <th className="p-3">{t("distributor")}</th>
                    <th className="p-3">{t("customer")}</th>
                    <th className="p-3">{t("vehicle")}</th>
                    <th className="p-3">{t("partNumber")}</th>
                    <th className="p-3">{t("appointmentDate")}</th>
                    <th className="p-3 text-right">{t("amountOwed")}</th>
                  </tr>
                </thead>
                <tbody>
                  {distributorWorkOrders.map((w) => (
                    <tr
                      key={w.id}
                      onClick={() => toggle(w.id)}
                      className="border-b last:border-0 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800/40 cursor-pointer transition-colors"
                    >
                      <td className="p-3">
                        <input type="checkbox" checked={selected.has(w.id)} onChange={() => toggle(w.id)} onClick={(e) => e.stopPropagation()} />
                      </td>
                      <td className="p-3 font-medium">{w.workOrderNo}</td>
                      <td className="p-3">{w.distributorName}</td>
                      <td className="p-3">{w.customerName || "—"}</td>
                      <td className="p-3">{w.vehicle || "—"}</td>
                      <td className="p-3">{w.partNumber || "—"}</td>
                      <td className="p-3">{w.appointmentDate || "—"}</td>
                      <td className="p-3 text-right">{money(w.amountOwed)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {type === "DISTRIBUTOR" && distributorGroups.length > 0 && (
        <section className="bg-white dark:bg-gray-900 dark:border dark:border-gray-800 rounded-xl shadow-sm p-6">
          <h2 className="font-semibold mb-4">{t("adjustmentsAndDetails")}</h2>

          <div className="flex flex-col gap-4 mb-4">
            {distributorGroups.map((g) => (
              <div key={g.distributorId} className="border dark:border-gray-800 rounded-lg p-4">
                <div className="flex items-center justify-between mb-3">
                  <span className="font-medium text-sm">{g.distributorName}</span>
                  <span className="text-sm text-gray-500">{t("subtotal")}: {money(g.subtotal)}</span>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div>
                    <label className="block text-sm mb-1 text-gray-600 dark:text-gray-300">{t("invoiceNumber")} <span className="text-red-500">*</span></label>
                    <input
                      value={distributorAdjustments[g.distributorId]?.invoiceNumber || ""}
                      onChange={(e) => setDistributorAdjustment(g.distributorId, "invoiceNumber", e.target.value)}
                      required
                      className="w-full border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-3 py-2 text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-sm mb-1 text-gray-600 dark:text-gray-300">{t("poNumber")}</label>
                    <input
                      value={distributorAdjustments[g.distributorId]?.poNumber || ""}
                      onChange={(e) => setDistributorAdjustment(g.distributorId, "poNumber", e.target.value)}
                      className="w-full border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-3 py-2 text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-sm mb-1 text-gray-600 dark:text-gray-300">{t("taxAmount")}</label>
                    <input
                      type="number"
                      value={distributorAdjustments[g.distributorId]?.taxAmount || ""}
                      onChange={(e) => setDistributorAdjustment(g.distributorId, "taxAmount", e.target.value)}
                      className="w-full border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-3 py-2 text-sm"
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
            <div>
              <label className="block text-sm mb-1 text-gray-600 dark:text-gray-300">{t("paymentMethod")}</label>
              <select value={adjustments.paymentMethod} onChange={(e) => set("paymentMethod", e.target.value)} className="w-full border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-3 py-2 text-sm">
                <option value="">{t("selectPaymentMethod")}</option>
                {paymentMethods.map((m) => <option key={m.id} value={m.name}>{m.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm mb-1 text-gray-600 dark:text-gray-300">{t("paymentDate")}</label>
              <input type="date" value={adjustments.paymentDate} onChange={(e) => set("paymentDate", e.target.value)} className="w-full border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-3 py-2 text-sm" />
            </div>
          </div>

          <div className="mb-4">
            <label className="block text-sm mb-1 text-gray-600 dark:text-gray-300">{tc("notes")}</label>
            <textarea value={adjustments.notes} onChange={(e) => set("notes", e.target.value)} rows={3} className="w-full border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-3 py-2 text-sm" />
          </div>

          <div className="bg-gray-50 dark:bg-gray-800/60 rounded-lg p-4 flex items-center justify-between mb-6">
            <div className="text-sm text-gray-500">{t("finalTotal")}</div>
            <div className="text-2xl font-bold dark:text-gray-100">{money(distributorFinalTotal)}</div>
          </div>

          <button type="button" onClick={handleCreateDistributors} className="bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors px-6 py-2">
            {submitLabel || t("createPayment")}
          </button>
        </section>
      )}

      {type && entityId && (
        <section className="bg-white dark:bg-gray-900 dark:border dark:border-gray-800 rounded-xl shadow-sm p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold">{t("step3SelectWorkOrders")}</h2>
            {workOrders.length > 0 && (
              <button type="button" onClick={toggleAll} className="text-xs text-blue-600 dark:text-blue-400">
                {selected.size === workOrders.length ? tc("deselectAll") : tc("selectAll")}
              </button>
            )}
          </div>

          {loadingWorkOrders && <p className="text-sm text-gray-500">{tc("loading")}</p>}
          {!loadingWorkOrders && workOrders.length === 0 && (
            <p className="text-sm text-gray-500">{t("noEligibleWorkOrders")}</p>
          )}

          {workOrders.length > 0 && (
            <div className="border dark:border-gray-800 rounded-lg overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left border-b dark:border-gray-800 bg-gray-50 dark:bg-gray-800/60">
                    <th className="p-3 w-8"></th>
                    <th className="p-3">{t("workOrder")}</th>
                    <th className="p-3">{t("customer")}</th>
                    <th className="p-3">{t("vehicle")}</th>
                    <th className="p-3">{t("appointmentDate")}</th>
                    <th className="p-3 text-right">{t("amountOwed")}</th>
                  </tr>
                </thead>
                <tbody>
                  {workOrders.map((w) => (
                    <tr
                      key={w.id}
                      onClick={() => toggle(w.id)}
                      className="border-b last:border-0 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800/40 cursor-pointer transition-colors"
                    >
                      <td className="p-3">
                        <input type="checkbox" checked={selected.has(w.id)} onChange={() => toggle(w.id)} onClick={(e) => e.stopPropagation()} />
                      </td>
                      <td className="p-3 font-medium">{w.workOrderNo}</td>
                      <td className="p-3">{w.customerName || "—"}</td>
                      <td className="p-3">{w.vehicle || "—"}</td>
                      <td className="p-3">{w.appointmentDate || "—"}</td>
                      <td className="p-3 text-right">{money(w.amountOwed)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="mt-4 bg-gray-50 dark:bg-gray-800/60 rounded-lg p-4 flex items-center justify-between">
            <div className="text-sm text-gray-500">{t("selectedWorkOrdersTotal", { count: selected.size })}</div>
            <div className="text-2xl font-bold dark:text-gray-100">{money(baseTotal)}</div>
          </div>
        </section>
      )}

      {type && type !== "DISTRIBUTOR" && selected.size > 0 && (
        <section className="bg-white dark:bg-gray-900 dark:border dark:border-gray-800 rounded-xl shadow-sm p-6">
          <h2 className="font-semibold mb-4">{t("adjustmentsAndDetails")}</h2>

          {type === "TECHNICIAN" && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
              <div>
                <label className="block text-sm mb-1 text-gray-600 dark:text-gray-300">{t("bonus")}</label>
                <input type="number" value={adjustments.bonus} onChange={(e) => set("bonus", Number(e.target.value))} className="w-full border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="block text-sm mb-1 text-gray-600 dark:text-gray-300">{t("deductions")}</label>
                <input type="number" value={adjustments.deductions} onChange={(e) => set("deductions", Number(e.target.value))} className="w-full border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-3 py-2 text-sm" />
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
            <div>
              <label className="block text-sm mb-1 text-gray-600 dark:text-gray-300">{t("paymentMethod")}</label>
              <select value={adjustments.paymentMethod} onChange={(e) => set("paymentMethod", e.target.value)} className="w-full border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-3 py-2 text-sm">
                <option value="">{t("selectPaymentMethod")}</option>
                {paymentMethods.map((m) => <option key={m.id} value={m.name}>{m.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm mb-1 text-gray-600 dark:text-gray-300">{t("paymentDate")}</label>
              <input type="date" value={adjustments.paymentDate} onChange={(e) => set("paymentDate", e.target.value)} className="w-full border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-3 py-2 text-sm" />
            </div>
          </div>

          <div className="mb-4">
            <label className="block text-sm mb-1 text-gray-600 dark:text-gray-300">{tc("notes")}</label>
            <textarea value={adjustments.notes} onChange={(e) => set("notes", e.target.value)} rows={3} className="w-full border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-3 py-2 text-sm" />
          </div>

          <div className="bg-gray-50 dark:bg-gray-800/60 rounded-lg p-4 flex items-center justify-between mb-6">
            <div className="text-sm text-gray-500">{t("finalTotal")}</div>
            <div className="text-2xl font-bold dark:text-gray-100">{money(finalTotal)}</div>
          </div>

          <button type="button" onClick={handleCreate} className="bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors px-6 py-2">
            {submitLabel || t("createPayment")}
          </button>
        </section>
      )}
    </div>
  );
}
