"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { getCustomers, getInsuranceCompanies, getDistributors, getCalibrationTypes, getPriceTiers, getPartnerCompanies, getAgents, getPartNumbers, getZipCodes, getJobTypes, updateCustomer, updateQuote } from "@/lib/api";
import { QUOTE_STATUSES, isLostStatus } from "@/lib/quoteStatuses";
import { getQuoteStatusColorClass } from "@/lib/quoteStatusColors";
import SearchableSelect from "./SearchableSelect";
import VehicleSelector from "./VehicleSelector";
import CurrencyInput from "./CurrencyInput";
import PercentInput from "./PercentInput";
import PhoneInput from "./PhoneInput";
import QuoteSummaryPanel from "./QuoteSummaryPanel";
import EditCustomerModal from "./EditCustomerModal";
import AddressAutocomplete from "./AddressAutocomplete";

const empty = {
  status: "Draft",
  documentType: "WorkOrder",
  paymentType: "Personal",
  callDirection: "In",
  name: "",
  date: new Date().toISOString().slice(0, 10),
  zipCode: "",
  longTripFee: 0,
  serviceArea: true,
  longTripRequired: false,
  distanceFromBase: 0,
  customerType: "Existing",
  customerId: "",
  customerName: "",
  newCustomer: { firstName: "", lastName: "", phone: "", phoneAlt: "", email: "", address: "", addressType: "", unitNumber: "" },
  insuranceCompanyId: "",
  agentId: "",
  agentName: "",
  policyNumber: "",
  claimNumber: "",
  appointmentDate: "",
  startTime: "",
  endTime: "",
  vehicle: { year: "", make: "", model: "", bodyType: "", vin: "", plate: "" },
  glassType: "",
  partNumber: "",
  nagsDescription: "",
  glassCost: 0,
  calibrationType: "",
  insurance: {
    listPrice: 0,
    nagsRate: 0,
    pricePartInsurance: 0,
    nagsLaborHour: 0,
    priceForHour: 0,
    totalLabor: 0,
    flatRateKit: 0,
    deductible: 0,
  },
  discount: { type: "Percentage", value: 0, reason: "" },
  insuranceAdjustment: { amount: 0, notes: "" },
  lineItems: [],
  crmPhotos: [],
  customerPhotos: [],
  taxRate: 0,
  invoiceMode: "lump_sum",
  upsell: 0,
  commission: 0,
  paidAmount: 0,
  cashComeback: 0,
  customerSuggestedPrice: 0,
  payment: {
    method: "",
    cardNumber: "",
    expirationDate: "",
    cvv: "",
    zipCode: "",
    firstName: "",
    lastName: "",
    amount: 0,
    authorizationId: "",
  },
  lostInfo: {
    reasonForLoss: "",
    competitorName: "",
    competitorPhone: "",
    competitorPrice: 0,
    competitorWarranty: "",
    competitorNotes: "",
    competitorCaptureDate: "",
    customerBudget: 0,
    customerComments: "",
    canMatchPrice: "",
    potentialMargin: 0,
    leadResellCandidate: "",
    partnerCompanyId: "",
    salePrice: 0,
    leadStatus: "",
    contactDate: "",
    leadOutcome: "",
    followUpDate: "",
    notes: "",
  },
};

const PAYMENT_TYPES = ["Personal", "Insurance"];
const INVOICE_MODES = ["lump_sum", "itemized"];
const CALL_DIRECTIONS = ["In", "Out"];
const CUSTOMER_TYPES = ["Existing", "New"];
const STATUSES = QUOTE_STATUSES;
const LOSS_REASONS = [
  "Price Too High",
  "Competitor Lower Price",
  "Customer Waiting",
  "Vehicle Sold",
  "Insurance Issue",
  "Wrong Part",
  "No Answer",
  "Job Cancelled",
  "Customer Chose Another Company",
  "Other",
];
const LEAD_STATUSES = ["Available", "Assigned", "Sold", "Converted", "Closed", "Rejected"];
const ADDRESS_TYPES = ["House", "Apartment", "Unit", "Office", "Condo", "Mobile Home", "Business", "Warehouse", "Other"];
const SHOW_UNIT_FOR = ["Apartment", "Unit", "Condo", "Other"];
const DISCOUNT_TYPES = ["Percentage", "Fixed"];
const DISCOUNT_REASONS = ["Referral", "Military", "Senior", "Manager Approval", "Promotion", "Other"];

function computeTotals(form, calibrationTypes = [], priceTiers = []) {
  const lineItems = form.lineItems || [];
  const subtotalParts = lineItems.reduce((sum, li) => sum + Number(li.pricePart || 0), 0);
  // Personal quotes have no dedicated labor field (that's Insurance-only, via insurance.totalLabor
  // below) — labor gets captured as an ordinary line item tagged jobType "Labor" instead. Broken
  // out here purely for display (Financial Summary shows Part Price and Labor separately); it's
  // already included in subtotalParts/subtotal, so this isn't a second addend anywhere in the math.
  const laborLineItemTotal = lineItems.reduce((sum, li) => sum + (li.jobType === "Labor" ? Number(li.pricePart || 0) : 0), 0);
  const nonLaborPartsTotal = subtotalParts - laborLineItemTotal;
  const subtotalServices = lineItems.reduce((sum, li) => {
    const match = calibrationTypes.find((c) => c.name === li.calibrationType);
    return sum + Number(match?.amount || 0);
  }, 0);
  const priceTierTotal = lineItems.reduce((sum, li) => {
    const match = priceTiers.find((p) => p.name === li.priceTier);
    return sum + Number(match?.amount || 0);
  }, 0);
  const longTripFee = Number(form.longTripFee || 0);
  const laborTotal = Number(form.insurance?.totalLabor || 0);
  const pricePartInsurance = Number(form.insurance?.pricePartInsurance || 0);
  const flatRateKit = Number(form.insurance?.flatRateKit || 0);

  const personalComponents = subtotalParts + subtotalServices + priceTierTotal + longTripFee;
  const discountAmount =
    form.discount?.type === "Fixed"
      ? Number(form.discount?.value || 0)
      : personalComponents * (Number(form.discount?.value || 0) / 100);
  const subtotal = Math.max(0, personalComponents - discountAmount);
  const isItemized = form.invoiceMode === "itemized";
  // Itemized mode taxes only line items snapshotted is_taxable=true (Parts/Molding, typically)
  // — subtotalServices/priceTierTotal/longTripFee are labor-like and stay exempt either way.
  // The discount is not prorated into this base: it still reduces personalTotal via subtotal,
  // it just doesn't shrink what tax is computed on.
  const taxableItemBase = lineItems.reduce(
    (sum, li) => sum + (li.isTaxable !== false ? Number(li.pricePart || 0) : 0),
    0
  );
  const personalTaxAmount = (isItemized ? taxableItemBase : subtotal) * (Number(form.taxRate || 0) / 100);
  const personalTotal = subtotal + personalTaxAmount;

  // Tax only applies to the Insurance branch in itemized mode (lump-sum insurance claims stay
  // untaxed, matching historical behavior), and only on the Parts/Kit-like components.
  const insuranceTaxAmount = isItemized ? (pricePartInsurance + flatRateKit) * (Number(form.taxRate || 0) / 100) : 0;
  const claimTotalBeforeAdjustment = pricePartInsurance + laborTotal + flatRateKit + subtotalServices;
  const insuranceAdjustmentAmount = Number(form.insuranceAdjustment?.amount || 0);
  const claimTotal = claimTotalBeforeAdjustment + insuranceAdjustmentAmount + insuranceTaxAmount;
  const deductible = Number(form.insurance?.deductible || 0);
  const customerResponsibility = deductible;
  const insuranceResponsibility = claimTotal - deductible;
  const totalClaimValue = claimTotal;

  const isInsurance = form.paymentType === "Insurance";
  const totalAmount = isInsurance ? totalClaimValue : personalTotal;
  const remainingBalance = totalAmount - Number(form.paidAmount || 0);
  // Unified for display: whichever branch is active, this is "the" tax charged on this quote.
  const taxAmount = isInsurance ? insuranceTaxAmount : personalTaxAmount;

  return {
    subtotalParts,
    laborLineItemTotal,
    nonLaborPartsTotal,
    subtotalServices,
    priceTierTotal,
    laborTotal,
    longTripFee,
    discountAmount,
    subtotal,
    taxAmount,
    personalTotal,
    pricePartInsurance,
    flatRateKit,
    claimTotalBeforeAdjustment,
    insuranceAdjustmentAmount,
    claimTotal,
    deductible,
    customerResponsibility,
    insuranceResponsibility,
    totalClaimValue,
    totalAmount,
    remainingBalance,
  };
}

function money(n) {
  return `$${Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function Field({ label, value, onChange, type = "text", placeholder, readOnly }) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">{label}</label>
      <input
        type={type}
        value={value}
        placeholder={placeholder}
        readOnly={readOnly}
        onChange={(e) => onChange(type === "number" ? Number(e.target.value) : e.target.value)}
        className={`w-full border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-shadow text-sm ${readOnly ? "bg-gray-50 text-gray-500" : ""}`}
      />
    </div>
  );
}

function HoursField({ value, onChange, disabled }) {
  const [focused, setFocused] = useState(false);
  const [rawText, setRawText] = useState("");
  const display = focused ? rawText : (value ? String(value) : "");

  function handleChange(e) {
    let raw = e.target.value.replace(/[^0-9.]/g, "");
    const firstDot = raw.indexOf(".");
    if (firstDot !== -1) {
      raw = raw.slice(0, firstDot + 1) + raw.slice(firstDot + 1).replace(/\./g, "");
    }
    setRawText(raw);
    onChange(raw === "" || raw === "." ? 0 : Number(raw));
  }

  return (
    <div className="relative">
      <input
        type="text"
        inputMode="decimal"
        value={display}
        placeholder="0.0"
        onFocus={() => {
          setFocused(true);
          setRawText(value ? String(value) : "");
        }}
        onBlur={() => setFocused(false)}
        onChange={handleChange}
        disabled={disabled}
        className="w-full border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded-lg pl-3 pr-10 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-shadow text-sm disabled:bg-gray-100 dark:disabled:bg-gray-900 disabled:cursor-not-allowed"
      />
      <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none select-none text-xs">hrs</span>
    </div>
  );
}

function Toggle({ options, value, onChange }) {
  return (
    <div className="flex rounded-lg border overflow-hidden">
      {options.map((opt) => (
        <button
          type="button"
          key={opt.value}
          onClick={() => onChange(opt.value)}
          className={`flex-1 px-3 py-2 text-sm font-medium transition-colors ${
            value === opt.value ? "bg-blue-600 text-white" : "bg-white text-gray-500 hover:bg-gray-50"
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

function PhotoGroup({ title, addLabel, photos, onAdd, onRemove, max = 4 }) {
  return (
    <div>
      <h4 className="text-xs font-medium text-gray-500 mb-2">{title}</h4>
      <div className="grid grid-cols-2 gap-3">
        {Array.from({ length: max }).map((_, i) => {
          const photo = photos[i];
          return (
            <div key={i} className="relative aspect-square border-2 border-dashed rounded-lg overflow-hidden bg-white">
              {photo ? (
                <>
                  <img src={photo.url} alt={photo.name} className="w-full h-full object-cover" />
                  <button
                    type="button"
                    onClick={() => onRemove(i)}
                    className="absolute top-1 right-1 w-5 h-5 rounded-full bg-black/60 text-white text-xs flex items-center justify-center"
                  >
                    ✕
                  </button>
                </>
              ) : (
                <label className="w-full h-full flex items-center justify-center text-blue-600 text-sm cursor-pointer text-center px-2">
                  {addLabel}
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files[0];
                      if (file) onAdd(file);
                      e.target.value = "";
                    }}
                  />
                </label>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function SectionHeader({ title }) {
  return (
    <div className="flex items-center gap-2 pb-3 mb-4 border-b">
      <span className="w-6 h-6 rounded bg-blue-100 text-blue-600 flex items-center justify-center text-xs font-bold">▤</span>
      <h2 className="font-semibold text-sm">{title}</h2>
    </div>
  );
}

export default function QuoteForm({ initialData, onSubmit, onCancel, onDirtyChange, formRef, onCustomerUpdated }) {
  const t = useTranslations("quoteForm");
  const tq = useTranslations("quotes");
  const tc = useTranslations("common");
  const tl = useTranslations("lostQuote");
  const [form, setForm] = useState({ ...empty, ...initialData, vehicle: { ...empty.vehicle, ...initialData?.vehicle }, insurance: { ...empty.insurance, ...initialData?.insurance }, newCustomer: { ...empty.newCustomer, ...initialData?.newCustomer }, payment: { ...empty.payment, ...initialData?.payment }, lostInfo: { ...empty.lostInfo, ...initialData?.lostInfo } });
  const originalFormRef = useRef(form);

  // Global preference (not per-work-order): once the user toggles it manually, that choice
  // sticks for every work order until they toggle again. Only when no preference has ever been
  // saved do we fall back to a per-order default (collapsed if it has no photos yet).
  const [showPhotos, setShowPhotos] = useState(() => {
    if (typeof window === "undefined") return true;
    const stored = window.localStorage.getItem("workOrderPhotosVisible");
    if (stored !== null) return stored === "true";
    return (form.crmPhotos?.length || 0) + (form.customerPhotos?.length || 0) > 0;
  });

  function toggleShowPhotos() {
    setShowPhotos((prev) => {
      const next = !prev;
      if (typeof window !== "undefined") {
        window.localStorage.setItem("workOrderPhotosVisible", String(next));
      }
      return next;
    });
  }

  useEffect(() => {
    if (JSON.stringify(form) !== JSON.stringify(originalFormRef.current)) {
      onDirtyChange?.(true);
    }
  }, [form, onDirtyChange]);
  const [partnerCompanies, setPartnerCompanies] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [companies, setCompanies] = useState([]);
  const [distributors, setDistributors] = useState([]);
  const [calibrationTypes, setCalibrationTypes] = useState([]);
  const [priceTiers, setPriceTiers] = useState([]);
  const [agents, setAgents] = useState([]);
  const [partNumbers, setPartNumbers] = useState([]);
  const [zipCodes, setZipCodes] = useState([]);
  const [jobTypes, setJobTypes] = useState([]);

  useEffect(() => {
    getCustomers().then(setCustomers).catch(() => {});
    getInsuranceCompanies().then(setCompanies).catch(() => {});
    getDistributors().then(setDistributors).catch(() => {});
    getCalibrationTypes().then(setCalibrationTypes).catch(() => {});
    getPriceTiers().then(setPriceTiers).catch(() => {});
    getPartnerCompanies().then(setPartnerCompanies).catch(() => {});
    getAgents().then(setAgents).catch(() => {});
    getPartNumbers().then(setPartNumbers).catch(() => {});
    getZipCodes().then(setZipCodes).catch(() => {});
    getJobTypes().then(setJobTypes).catch(() => {});
  }, []);

  const jobTypeOptions = useMemo(() => {
    const seen = new Set();
    const unique = [];
    for (const j of jobTypes) {
      if (!j.name || seen.has(j.name)) continue;
      seen.add(j.name);
      unique.push(j);
    }
    return unique.map((j) => ({ value: j.name, label: j.name }));
  }, [jobTypes]);

  const zipCodeOptions = useMemo(
    () => zipCodes.map((z) => ({ value: z.zipcode, label: z.zipcode, searchText: `${z.zipcode} ${z.city} ${z.county}` })),
    [zipCodes]
  );

  const partNumberOptions = useMemo(
    () =>
      partNumbers.map((p) => ({
        value: p.partNumber,
        label: p.partNumber,
        searchText: `${p.partNumber} ${p.nagsDescription} ${p.jobType}`,
      })),
    [partNumbers]
  );

  const nagsDescriptionOptions = useMemo(
    () =>
      partNumbers.map((p) => ({
        value: p.nagsDescription,
        label: p.nagsDescription,
        searchText: `${p.partNumber} ${p.nagsDescription} ${p.jobType}`,
      })),
    [partNumbers]
  );

  const calibrationTypeOptions = useMemo(() => calibrationTypes.map((c) => ({ value: c.name, label: c.name })), [calibrationTypes]);

  const priceTierOptions = useMemo(() => priceTiers.map((p) => ({ value: p.name, label: p.name })), [priceTiers]);

  const distributorOptions = useMemo(() => distributors.map((d) => ({ value: d.name, label: d.name })), [distributors]);

  const agentOptions = useMemo(() => agents.map((a) => ({ value: String(a.id), label: a.name })), [agents]);

  function handleAgentChange(agentId) {
    const agent = agents.find((a) => a.id === Number(agentId));
    setForm((prev) => ({
      ...prev,
      agentId: agentId ? Number(agentId) : "",
      agentName: agent?.name || "",
    }));
  }

  function set(path, value) {
    setForm((prev) => {
      const next = { ...prev };
      if (path[0] === "vehicle" || path[0] === "insurance" || path[0] === "newCustomer" || path[0] === "payment" || path[0] === "lostInfo" || path[0] === "discount" || path[0] === "insuranceAdjustment") {
        next[path[0]] = { ...prev[path[0]], [path[1]]: value };
      } else {
        next[path[0]] = value;
      }
      return next;
    });
  }

  function handleCustomerChange(customerId) {
    const customer = customers.find((c) => c.id === Number(customerId));
    setForm((prev) => ({
      ...prev,
      customerId: customerId ? Number(customerId) : "",
      customerName: customer ? customer.name : "",
      vehicle: customer ? { ...prev.vehicle, ...customer.vehicle } : prev.vehicle,
    }));
  }

  const [showEditCustomer, setShowEditCustomer] = useState(false);
  const selectedCustomer = useMemo(
    () => customers.find((c) => String(c.id) === String(form.customerId)),
    [customers, form.customerId]
  );

  // Updates the customer record itself, this Quote's denormalized customerName (if the Quote
  // already exists), and — via onCustomerUpdated — the Work Order's denormalized contact info
  // when this form is embedded in a Work Order page. Deliberately does NOT touch any other
  // quote/work order belonging to this customer: those keep the contact info as it was at the
  // time they were created (see design discussion — historical snapshot, not a live reference).
  async function handleSaveCustomer(payload) {
    const updated = await updateCustomer(form.customerId, payload);
    setCustomers((prev) => prev.map((c) => (String(c.id) === String(updated.id) ? updated : c)));
    setForm((prev) => ({ ...prev, customerName: updated.name }));
    if (initialData?.id) {
      await updateQuote(initialData.id, { customerName: updated.name });
    }
    await onCustomerUpdated?.(updated);
    setShowEditCustomer(false);
  }

  function addLineItem() {
    setForm((prev) => ({
      ...prev,
      lineItems: [
        ...prev.lineItems,
        { id: `tmp-${Date.now()}`, jobType: "", partNumber: "", nagsDescription: "", calibrationType: "", priceTier: "", pricePart: 0, distributor: "", orderNumber: "" },
      ],
    }));
  }

  function updateLineItem(id, patch) {
    setForm((prev) => ({
      ...prev,
      lineItems: prev.lineItems.map((li) => (li.id === id ? { ...li, ...patch } : li)),
    }));
  }

  function removeLineItem(id) {
    setForm((prev) => ({ ...prev, lineItems: prev.lineItems.filter((li) => li.id !== id) }));
  }

  function handlePriceTierChange(id, tierName) {
    updateLineItem(id, { priceTier: tierName });
  }

  // Snapshots the Job Type catalog's isTaxable flag onto the line item at selection time, so a
  // later edit to the catalog doesn't retroactively change this quote's tax (mirrors the
  // backend's normalizeLineItems snapshot logic).
  function handleLineItemJobTypeChange(id, name) {
    const match = jobTypes.find((j) => j.name === name);
    updateLineItem(id, { jobType: name, isTaxable: match?.isTaxable !== false });
  }

  // Cascades the postal_code Google returns into the same zip lookup the manual ZIP search box
  // already drives (tax rate, long trip fee, service area) — reuses handleZipCodeChange as-is,
  // no new lookup logic. If the ZIP isn't in our zip_codes catalog, handleZipCodeChange already
  // falls back sanely (serviceArea defaults true, tax/fee default 0), same as picking an unlisted
  // ZIP manually.
  function handleNewCustomerAddressSelected(data) {
    if (data.postalCode) handleZipCodeChange(data.postalCode);
  }

  function handleZipCodeChange(value) {
    const match = zipCodes.find((z) => z.zipcode === value);
    setForm((prev) => ({
      ...prev,
      zipCode: value,
      taxRate: match ? Number(match.tax || 0) * 100 : 0,
      longTripFee: match?.longTripFee ?? 0,
      serviceArea: match ? !!match.serviceArea : true,
      longTripRequired: match ? !!match.longTripRequired : false,
      distanceFromBase: match?.distanceFromBase ?? 0,
    }));
  }

  function handlePartNumberChange(id, value) {
    const record = partNumbers.find((p) => p.partNumber === value);
    updateLineItem(id, {
      partNumber: value,
      nagsDescription: record?.nagsDescription || "",
    });
  }

  function handleNagsDescriptionChange(id, value) {
    const record = partNumbers.find((p) => p.nagsDescription === value);
    updateLineItem(id, {
      nagsDescription: value,
      partNumber: record?.partNumber || "",
    });
  }

  function handleListPriceChange(listPrice) {
    setForm((prev) => ({
      ...prev,
      insurance: {
        ...prev.insurance,
        listPrice,
        pricePartInsurance: Number(listPrice || 0) * (Number(prev.insurance.nagsRate || 0) / 100),
      },
    }));
  }

  function handleNagsRateChange(nagsRate) {
    setForm((prev) => ({
      ...prev,
      insurance: {
        ...prev.insurance,
        nagsRate,
        pricePartInsurance: Number(prev.insurance.listPrice || 0) * (Number(nagsRate || 0) / 100),
      },
    }));
  }

  function handleNagsLaborHourChange(nagsLaborHour) {
    setForm((prev) => ({
      ...prev,
      insurance: {
        ...prev.insurance,
        nagsLaborHour,
        totalLabor: Number(nagsLaborHour || 0) * Number(prev.insurance.priceForHour || 0),
      },
    }));
  }

  function handlePriceForHourChange(priceForHour) {
    setForm((prev) => ({
      ...prev,
      insurance: {
        ...prev.insurance,
        priceForHour,
        totalLabor: Number(prev.insurance.nagsLaborHour || 0) * Number(priceForHour || 0),
      },
    }));
  }

  function addPhoto(field, file) {
    const reader = new FileReader();
    reader.onload = () => {
      setForm((prev) => {
        if ((prev[field] || []).length >= 4) return prev;
        return { ...prev, [field]: [...prev[field], { name: file.name, url: reader.result }] };
      });
    };
    reader.readAsDataURL(file);
  }

  function removePhoto(field, index) {
    setForm((prev) => ({ ...prev, [field]: prev[field].filter((_, i) => i !== index) }));
  }

  function handleSubmit(e) {
    e.preventDefault();
    onSubmit({ ...form, customerName: displayCustomerName });
  }

  const totals = computeTotals(form, calibrationTypes, priceTiers);
  const vehicleSummary = [form.vehicle.year, form.vehicle.make, form.vehicle.model].filter(Boolean).join(" ");
  const displayCustomerName = form.customerType === "New"
    ? [form.newCustomer.firstName, form.newCustomer.lastName].filter(Boolean).join(" ")
    : form.customerName;
  const competitorPrice = Number(form.lostInfo.competitorPrice || 0);
  const priceDiffAmount = totals.totalAmount - competitorPrice;
  const priceDiffPercent = totals.totalAmount ? (priceDiffAmount / totals.totalAmount) * 100 : 0;

  return (
    <form ref={formRef} onSubmit={handleSubmit} className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-6 items-start">
      <div className="space-y-6">
        <section className="bg-white dark:bg-gray-900 dark:border dark:border-gray-800 rounded-xl shadow-sm p-4">
          <SectionHeader title={t("initialConfigSection")} />

          <div className="flex items-center justify-between pb-4 mb-4 border-b dark:border-gray-800">
            <div>
              <div className="text-xs font-medium text-gray-400 uppercase tracking-wide">{tq("quoteNo")}</div>
              <div className="text-lg font-semibold dark:text-gray-100">{form.quoteNo || t("newQuoteLabel")}</div>
            </div>
            <span className={`text-xs font-medium rounded-full px-3 py-1.5 ${getQuoteStatusColorClass(form.status)}`}>
              {tq(`statuses.${form.status}`)}
            </span>
          </div>

          <div className="mb-4">
            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-2">{t("paymentTypeLabel")}</label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {PAYMENT_TYPES.map((v) => {
                const active = form.paymentType === v;
                const isInsuranceCard = v === "Insurance";
                const accent = isInsuranceCard
                  ? { border: "border-green-600 dark:border-green-500", bg: "bg-green-50 dark:bg-green-500/10", text: "text-green-700 dark:text-green-300", dot: "border-green-600 bg-green-600", hint: "text-green-600 dark:text-green-300/80" }
                  : { border: "border-blue-600 dark:border-blue-500", bg: "bg-blue-50 dark:bg-blue-500/10", text: "text-blue-700 dark:text-blue-300", dot: "border-blue-600 bg-blue-600", hint: "text-blue-600 dark:text-blue-300/80" };
                return (
                  <button
                    key={v}
                    type="button"
                    onClick={() => {
                      set(["paymentType"], v);
                      if (!initialData?.id) set(["invoiceMode"], v === "Insurance" ? "itemized" : "lump_sum");
                    }}
                    className={`text-left rounded-xl border-2 p-5 transition-colors ${
                      active
                        ? `${accent.border} ${accent.bg}`
                        : "border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600"
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1.5">
                      <span className={`font-semibold text-sm ${active ? accent.text : "text-gray-700 dark:text-gray-200"}`}>
                        {t(`paymentTypes.${v}`)}
                      </span>
                      <span className={`w-5 h-5 rounded-full border-2 flex-shrink-0 flex items-center justify-center ${active ? accent.dot : "border-gray-300 dark:border-gray-600"}`}>
                        {active && <span className="w-2 h-2 rounded-full bg-white" />}
                      </span>
                    </div>
                    <p className={`text-xs ${active ? accent.hint : "text-gray-400"}`}>
                      {t(`paymentTypeHints.${v}`)}
                    </p>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">{t("callDirection")}</label>
              <div className="max-w-xs">
                <Toggle
                  value={form.callDirection}
                  onChange={(v) => set(["callDirection"], v)}
                  options={CALL_DIRECTIONS.map((v) => ({ value: v, label: t(`callDirections.${v}`) }))}
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">{t("invoiceModeLabel")}</label>
              <div className="max-w-xs">
                <Toggle
                  value={form.invoiceMode}
                  onChange={(v) => set(["invoiceMode"], v)}
                  options={INVOICE_MODES.map((v) => ({ value: v, label: t(`invoiceModes.${v}`) }))}
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Field label={t("name")} placeholder={t("namePlaceholder")} value={form.name} onChange={(v) => set(["name"], v)} />
              <Field label={t("createdDate")} type="date" value={form.date} onChange={(v) => set(["date"], v)} />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">{t("status")}</label>
                <select value={form.status} onChange={(e) => set(["status"], e.target.value)} className="w-full border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-shadow text-sm">
                  {STATUSES.map((s) => <option key={s} value={s}>{tq(`statuses.${s}`)}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">{t("referralAgent")}</label>
                <SearchableSelect
                  value={form.agentId || ""}
                  onChange={handleAgentChange}
                  options={agentOptions}
                  placeholder={t("selectReferralAgent")}
                  fallbackLabel={form.agentName}
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">{t("zipCode")}</label>
                <SearchableSelect value={form.zipCode} onChange={handleZipCodeChange} options={zipCodeOptions} placeholder={t("searchZipCode")} />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">{t("longTrip")}</label>
                <CurrencyInput value={form.longTripFee} onChange={() => {}} disabled />
              </div>
            </div>

            {form.zipCode && !form.serviceArea && (
              <div className="bg-red-50 border-2 border-red-300 text-red-700 rounded-lg p-3 flex items-start gap-2">
                <span className="text-lg leading-none">⚠</span>
                <div className="text-sm">
                  <div className="font-semibold">{t("outsideServiceArea")}</div>
                  <div>{t("longTripFeeApplies", { fee: money(form.longTripFee) })}</div>
                  <div className="font-medium">{t("managerApprovalRequired")}</div>
                </div>
              </div>
            )}
          </div>
        </section>

        <section className="bg-white dark:bg-gray-900 dark:border dark:border-gray-800 rounded-xl shadow-sm p-4">
          <SectionHeader title={t("vehicleInfoSection")} />
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <VehicleSelector value={form.vehicle} onChange={(vehicle) => setForm((prev) => ({ ...prev, vehicle }))} />
          </div>
        </section>

        <section className="bg-white dark:bg-gray-900 dark:border dark:border-gray-800 rounded-xl shadow-sm p-4">
          <SectionHeader title={t("partsServicesSection")} />
          <div className="border rounded-lg p-4 bg-gray-50">
            <p className="text-xs text-gray-500 mb-3">{t("partsServicesHint")}</p>

            {form.lineItems.length > 0 && (
              <div className="space-y-3 mb-3">
                {form.lineItems.map((li) => (
                  <div key={li.id} className="bg-white border rounded p-3 space-y-2">
                    <div className="grid grid-cols-1 md:grid-cols-5 gap-2">
                      <SearchableSelect
                        value={li.jobType}
                        onChange={(v) => handleLineItemJobTypeChange(li.id, v)}
                        options={jobTypeOptions}
                        placeholder={t("jobType")}
                        required
                        className="border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-2 py-1.5 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-shadow text-xs w-full"
                      />
                      <SearchableSelect
                        value={li.partNumber}
                        onChange={(v) => handlePartNumberChange(li.id, v)}
                        options={partNumberOptions}
                        placeholder={t("partNumber")}
                        className="border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-2 py-1.5 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-shadow text-xs w-full"
                      />
                      <SearchableSelect
                        value={li.nagsDescription}
                        onChange={(v) => handleNagsDescriptionChange(li.id, v)}
                        options={nagsDescriptionOptions}
                        placeholder={t("nagsDescription")}
                        className="border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-2 py-1.5 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-shadow text-xs w-full"
                      />
                      <SearchableSelect
                        value={li.calibrationType}
                        onChange={(v) => updateLineItem(li.id, { calibrationType: v })}
                        options={calibrationTypeOptions}
                        placeholder={t("calibrationType")}
                        className="border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-2 py-1.5 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-shadow text-xs w-full"
                      />
                      <SearchableSelect
                        value={li.priceTier}
                        onChange={(v) => handlePriceTierChange(li.id, v)}
                        options={priceTierOptions}
                        placeholder={t("priceTier")}
                        className="border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-2 py-1.5 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-shadow text-xs w-full"
                      />
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-[1fr_1fr_1fr_auto] gap-2 items-center">
                      <CurrencyInput
                        value={li.pricePart}
                        onChange={(v) => updateLineItem(li.id, { pricePart: v })}
                        placeholder={t("pricePart")}
                        compact
                      />
                      <SearchableSelect
                        value={li.distributor}
                        onChange={(v) => updateLineItem(li.id, { distributor: v })}
                        options={distributorOptions}
                        placeholder={t("distributor")}
                        className="border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-2 py-1.5 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-shadow text-xs w-full"
                      />
                      <input
                        value={li.orderNumber}
                        onChange={(e) => updateLineItem(li.id, { orderNumber: e.target.value })}
                        placeholder={t("orderNumber")}
                        className="border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-2 py-1.5 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-shadow text-xs"
                      />
                      <div className="flex items-center justify-between md:justify-end gap-3">
                        <span className="text-xs font-medium">{money(li.pricePart)}</span>
                        <button type="button" onClick={() => removeLineItem(li.id)} className="text-red-500 text-xs">✕</button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {form.lineItems.length === 0 && (
              <p className="text-center text-sm text-gray-500 py-6">{t("noLineItems")}</p>
            )}

            <button type="button" onClick={addLineItem} className="w-full bg-gray-900 hover:bg-gray-800 dark:bg-blue-600 dark:hover:bg-blue-700 text-white rounded-lg transition-colors px-4 py-2 text-sm">
              {t("addLineItem")}
            </button>
          </div>
        </section>

        <section className="bg-white dark:bg-gray-900 dark:border dark:border-gray-800 rounded-xl shadow-sm p-4">
          <div className="flex items-center justify-between pb-3 mb-4 border-b">
            <div className="flex items-center gap-2">
              <span className="w-6 h-6 rounded bg-blue-100 text-blue-600 flex items-center justify-center text-xs font-bold">▤</span>
              <h2 className="font-semibold text-sm">{t("photosSection")}</h2>
            </div>
            <button
              type="button"
              onClick={toggleShowPhotos}
              className="text-xs font-medium text-blue-600 hover:text-blue-700 dark:text-blue-400 border border-blue-200 dark:border-blue-800 hover:bg-blue-50 dark:hover:bg-blue-900/30 rounded-lg px-3 py-1.5 transition-colors"
            >
              {t("togglePhotos")}
            </button>
          </div>
          {showPhotos ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 animate-fadeIn">
              <PhotoGroup
                title={t("picsFromCrm")}
                addLabel={t("addPhoto")}
                photos={form.crmPhotos}
                onAdd={(file) => addPhoto("crmPhotos", file)}
                onRemove={(i) => removePhoto("crmPhotos", i)}
              />
              <PhotoGroup
                title={t("picsFromCustomer")}
                addLabel={t("addPhoto")}
                photos={form.customerPhotos}
                onAdd={(file) => addPhoto("customerPhotos", file)}
                onRemove={(i) => removePhoto("customerPhotos", i)}
              />
            </div>
          ) : (
            <button
              type="button"
              onClick={toggleShowPhotos}
              className="w-full text-center text-sm text-gray-400 dark:text-gray-500 hover:text-gray-500 dark:hover:text-gray-400 py-6 transition-colors animate-fadeIn"
            >
              {t("photosHiddenHint")}
            </button>
          )}
        </section>

        <section className="bg-white dark:bg-gray-900 dark:border dark:border-gray-800 rounded-xl shadow-sm p-4">
          <SectionHeader title={t("customerInfoSection")} />
          <div className="space-y-4">
            <div className="max-w-xs">
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">{t("customerTypeLabel")}</label>
              <Toggle
                value={form.customerType}
                onChange={(v) => set(["customerType"], v)}
                options={CUSTOMER_TYPES.map((v) => ({ value: v, label: t(`customerTypes.${v}`) }))}
              />
            </div>
            {form.customerType === "Existing" ? (
              <div>
                <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">{tq("customer")}</label>
                <div className="flex gap-2">
                  <select
                    value={form.customerId || ""}
                    onChange={(e) => handleCustomerChange(e.target.value)}
                    className="w-full border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-shadow text-sm"
                  >
                    <option value="">{t("selectCustomer")}</option>
                    {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                  {form.customerId && (
                    <button
                      type="button"
                      onClick={() => setShowEditCustomer(true)}
                      className="shrink-0 text-xs font-medium text-blue-600 hover:text-blue-700 dark:text-blue-400 border border-blue-200 dark:border-blue-800 hover:bg-blue-50 dark:hover:bg-blue-900/30 rounded-lg px-3 py-2 transition-colors whitespace-nowrap"
                    >
                      {t("editCustomer")}
                    </button>
                  )}
                </div>
                {showEditCustomer && selectedCustomer && (
                  <EditCustomerModal
                    customer={selectedCustomer}
                    onClose={() => setShowEditCustomer(false)}
                    onSave={handleSaveCustomer}
                  />
                )}
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Field label={tc("firstName")} value={form.newCustomer.firstName} onChange={(v) => set(["newCustomer", "firstName"], v)} />
                <Field label={tc("lastName")} value={form.newCustomer.lastName} onChange={(v) => set(["newCustomer", "lastName"], v)} />
                <div>
                  <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">{tc("primaryPhone")}</label>
                  <PhoneInput value={form.newCustomer.phone} onChange={(v) => set(["newCustomer", "phone"], v)} />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">{tc("alternatePhone")}</label>
                  <PhoneInput value={form.newCustomer.phoneAlt} onChange={(v) => set(["newCustomer", "phoneAlt"], v)} />
                </div>
                <Field label={tc("email")} type="email" value={form.newCustomer.email} onChange={(v) => set(["newCustomer", "email"], v)} />
                <AddressAutocomplete
                  label={tc("address")}
                  value={form.newCustomer.address}
                  onChange={(v) => set(["newCustomer", "address"], v)}
                  onPlaceSelected={handleNewCustomerAddressSelected}
                />
                <div>
                  <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">{tc("addressType")}</label>
                  <select
                    value={form.newCustomer.addressType}
                    onChange={(e) => set(["newCustomer", "addressType"], e.target.value)}
                    className="w-full border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-shadow text-sm"
                  >
                    <option value="">{tc("selectAddressType")}</option>
                    {ADDRESS_TYPES.map((a) => <option key={a} value={a}>{tc(`addressTypeOptions.${a}`)}</option>)}
                  </select>
                </div>
                {SHOW_UNIT_FOR.includes(form.newCustomer.addressType) && (
                  <Field label={tc("unitNumber")} value={form.newCustomer.unitNumber} onChange={(v) => set(["newCustomer", "unitNumber"], v)} />
                )}
              </div>
            )}
          </div>
        </section>

        <section className="bg-white dark:bg-gray-900 dark:border dark:border-gray-800 rounded-xl shadow-sm p-4">
          <SectionHeader title={t("schedulingSection")} />
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Field label={t("appointmentDate")} type="date" value={form.appointmentDate} onChange={(v) => set(["appointmentDate"], v)} />
            <Field label={t("startTime")} type="time" value={form.startTime} onChange={(v) => set(["startTime"], v)} />
            <Field label={t("endTime")} type="time" value={form.endTime} onChange={(v) => set(["endTime"], v)} />
          </div>
        </section>

        {form.paymentType === "Insurance" && (
          <section className="bg-white dark:bg-gray-900 dark:border dark:border-gray-800 rounded-xl shadow-sm p-4">
            <SectionHeader title={t("insuranceInfoSection")} />
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">{t("insuranceCompany")}</label>
                <select
                  value={form.insuranceCompanyId || ""}
                  onChange={(e) => set(["insuranceCompanyId"], e.target.value ? Number(e.target.value) : "")}
                  className="w-full border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-shadow text-sm"
                >
                  <option value="">{t("selectInsuranceCompany")}</option>
                  {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <Field label={t("policyNumber")} value={form.policyNumber} onChange={(v) => set(["policyNumber"], v)} />
              <Field label={t("claimNumber")} value={form.claimNumber} onChange={(v) => set(["claimNumber"], v)} />
              <div>
                <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">{t("listPrice")}</label>
                <CurrencyInput value={form.insurance.listPrice} onChange={handleListPriceChange} />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">{t("nagsRate")}</label>
                <PercentInput value={form.insurance.nagsRate} onChange={handleNagsRateChange} />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">{t("pricePartInsurance")}</label>
                <CurrencyInput value={form.insurance.pricePartInsurance} onChange={() => {}} disabled />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">{t("nagsLaborHour")}</label>
                <HoursField value={form.insurance.nagsLaborHour} onChange={handleNagsLaborHourChange} />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">{t("priceForHour")}</label>
                <CurrencyInput value={form.insurance.priceForHour} onChange={handlePriceForHourChange} />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">{t("totalLabor")}</label>
                <CurrencyInput value={form.insurance.totalLabor} onChange={() => {}} disabled />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">{t("flatRateKit")}</label>
                <CurrencyInput value={form.insurance.flatRateKit} onChange={(v) => set(["insurance", "flatRateKit"], v)} />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">{t("deductible")} <span className="text-red-500">*</span></label>
                <CurrencyInput value={form.insurance.deductible} onChange={(v) => set(["insurance", "deductible"], v)} required />
              </div>
            </div>
          </section>
        )}

        <section className="bg-white dark:bg-gray-900 dark:border dark:border-gray-800 rounded-xl shadow-sm p-4">
          <SectionHeader title={form.paymentType === "Insurance" ? t("insuranceAdjustmentSection") : t("discountSection")} />
          {form.paymentType === "Insurance" ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">{t("adjustmentAmount")}</label>
                <CurrencyInput value={form.insuranceAdjustment.amount} onChange={(v) => set(["insuranceAdjustment", "amount"], v)} />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">{tc("notes")}</label>
                <input
                  value={form.insuranceAdjustment.notes}
                  onChange={(e) => set(["insuranceAdjustment", "notes"], e.target.value)}
                  placeholder={t("adjustmentNotesPlaceholder")}
                  className="w-full border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-shadow text-sm"
                />
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">{t("discountType")}</label>
                <Toggle
                  value={form.discount.type}
                  onChange={(v) => set(["discount", "type"], v)}
                  options={DISCOUNT_TYPES.map((v) => ({ value: v, label: t(`discountTypes.${v}`) }))}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
                  {t("discountValue")} {form.discount.type === "Percentage" ? "(%)" : ""}
                </label>
                {form.discount.type === "Fixed" ? (
                  <CurrencyInput value={form.discount.value} onChange={(v) => set(["discount", "value"], v)} />
                ) : (
                  <PercentInput value={form.discount.value} onChange={(v) => set(["discount", "value"], v)} />
                )}
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">{t("discountReason")}</label>
                <select
                  value={form.discount.reason}
                  onChange={(e) => set(["discount", "reason"], e.target.value)}
                  className="w-full border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-shadow text-sm"
                >
                  <option value="">{t("selectDiscountReason")}</option>
                  {DISCOUNT_REASONS.map((r) => <option key={r} value={r}>{t(`discountReasons.${r}`)}</option>)}
                </select>
              </div>
            </div>
          )}
        </section>

        <section className="bg-white dark:bg-gray-900 dark:border dark:border-gray-800 rounded-xl shadow-sm p-4">
          <SectionHeader title={tc("notes")} />
          <textarea
            value={form.damageNotes}
            onChange={(e) => set(["damageNotes"], e.target.value)}
            placeholder={t("notesPlaceholder")}
            className="w-full border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-shadow text-sm"
            rows={3}
          />
        </section>

        {isLostStatus(form.status) && (
          <section className="bg-white dark:bg-gray-900 dark:border dark:border-gray-800 rounded-xl shadow-sm p-4 border-2 border-red-200">
            <SectionHeader title={tl("title")} />
            <div className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
                    {tl("reasonForLoss")} <span className="text-red-500">*</span>
                  </label>
                  <select
                    value={form.lostInfo.reasonForLoss}
                    onChange={(e) => set(["lostInfo", "reasonForLoss"], e.target.value)}
                    className="w-full border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-shadow text-sm"
                    required
                  >
                    <option value="">{tl("selectReason")}</option>
                    {LOSS_REASONS.map((r) => <option key={r} value={r}>{tl(`reasons.${r}`)}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">{tl("customerBudget")}</label>
                  <CurrencyInput value={form.lostInfo.customerBudget} onChange={(v) => set(["lostInfo", "customerBudget"], v)} />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">{tl("customerComments")}</label>
                <textarea
                  value={form.lostInfo.customerComments}
                  onChange={(e) => set(["lostInfo", "customerComments"], e.target.value)}
                  className="w-full border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-shadow text-sm"
                  rows={2}
                />
              </div>

              <div className="border-t pt-4">
                <h3 className="font-medium text-sm mb-3">{tl("competitorInfo")}</h3>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <Field label={tl("competitorName")} value={form.lostInfo.competitorName} onChange={(v) => set(["lostInfo", "competitorName"], v)} />
                  <Field label={tl("competitorPhone")} value={form.lostInfo.competitorPhone} onChange={(v) => set(["lostInfo", "competitorPhone"], v)} />
                  <div>
                    <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">{tl("competitorPrice")}</label>
                    <CurrencyInput value={form.lostInfo.competitorPrice} onChange={(v) => set(["lostInfo", "competitorPrice"], v)} />
                  </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
                  <Field label={tl("competitorWarranty")} value={form.lostInfo.competitorWarranty} onChange={(v) => set(["lostInfo", "competitorWarranty"], v)} />
                  <Field label={tl("competitorCaptureDate")} type="date" value={form.lostInfo.competitorCaptureDate} onChange={(v) => set(["lostInfo", "competitorCaptureDate"], v)} />
                </div>
                <div className="mt-4">
                  <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">{tl("competitorNotes")}</label>
                  <textarea
                    value={form.lostInfo.competitorNotes}
                    onChange={(e) => set(["lostInfo", "competitorNotes"], e.target.value)}
                    className="w-full border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-shadow text-sm"
                    rows={2}
                  />
                </div>
              </div>

              <div className="border-t pt-4">
                <h3 className="font-medium text-sm mb-3">{tl("priceAnalysis")}</h3>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 bg-gray-50 rounded-lg p-4">
                  <div>
                    <div className="text-xs text-gray-500">{tl("ourQuote")}</div>
                    <div className="font-semibold">{money(totals.totalAmount)}</div>
                  </div>
                  <div>
                    <div className="text-xs text-gray-500">{tl("competitorQuote")}</div>
                    <div className="font-semibold">{money(competitorPrice)}</div>
                  </div>
                  <div>
                    <div className="text-xs text-gray-500">{tl("differenceAmount")}</div>
                    <div className={`font-semibold ${priceDiffAmount > 0 ? "text-red-600" : "text-green-600"}`}>{money(priceDiffAmount)}</div>
                  </div>
                  <div>
                    <div className="text-xs text-gray-500">{tl("differencePercent")}</div>
                    <div className={`font-semibold ${priceDiffAmount > 0 ? "text-red-600" : "text-green-600"}`}>{priceDiffPercent.toFixed(1)}%</div>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">{tl("canMatchPrice")}</label>
                  <Toggle
                    value={form.lostInfo.canMatchPrice}
                    onChange={(v) => set(["lostInfo", "canMatchPrice"], v)}
                    options={[{ value: "Yes", label: tc("yes") }, { value: "No", label: tc("no") }]}
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">{tl("potentialMargin")}</label>
                  <CurrencyInput value={form.lostInfo.potentialMargin} onChange={(v) => set(["lostInfo", "potentialMargin"], v)} />
                </div>
                <Field label={tl("followUpDate")} type="date" value={form.lostInfo.followUpDate} onChange={(v) => set(["lostInfo", "followUpDate"], v)} />
              </div>

              <div className="border-t pt-4">
                <h3 className="font-medium text-sm mb-3">{tl("leadResale")}</h3>
                <div className="max-w-xs mb-4">
                  <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">{tl("leadResellCandidate")}</label>
                  <Toggle
                    value={form.lostInfo.leadResellCandidate}
                    onChange={(v) => set(["lostInfo", "leadResellCandidate"], v)}
                    options={[{ value: "Yes", label: tc("yes") }, { value: "No", label: tc("no") }]}
                  />
                </div>

                {form.lostInfo.leadResellCandidate === "Yes" && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">{tl("partnerCompany")}</label>
                      <select
                        value={form.lostInfo.partnerCompanyId || ""}
                        onChange={(e) => set(["lostInfo", "partnerCompanyId"], e.target.value ? Number(e.target.value) : "")}
                        className="w-full border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-shadow text-sm"
                      >
                        <option value="">{tl("selectPartnerCompany")}</option>
                        {partnerCompanies.map((p) => <option key={p.id} value={p.id}>{p.companyName}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">{tl("salePrice")}</label>
                      <CurrencyInput value={form.lostInfo.salePrice} onChange={(v) => set(["lostInfo", "salePrice"], v)} />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">{tl("leadStatus")}</label>
                      <select
                        value={form.lostInfo.leadStatus}
                        onChange={(e) => set(["lostInfo", "leadStatus"], e.target.value)}
                        className="w-full border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-shadow text-sm"
                      >
                        <option value="">{tl("selectLeadStatus")}</option>
                        {LEAD_STATUSES.map((s) => <option key={s} value={s}>{tl(`leadStatuses.${s}`)}</option>)}
                      </select>
                    </div>
                    <Field label={tl("contactDate")} type="date" value={form.lostInfo.contactDate} onChange={(v) => set(["lostInfo", "contactDate"], v)} />
                    <div className="md:col-span-2">
                      <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">{tl("leadOutcome")}</label>
                      <textarea
                        value={form.lostInfo.leadOutcome}
                        onChange={(e) => set(["lostInfo", "leadOutcome"], e.target.value)}
                        className="w-full border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-shadow text-sm"
                        rows={2}
                      />
                    </div>
                  </div>
                )}
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">{tl("notes")}</label>
                <textarea
                  value={form.lostInfo.notes}
                  onChange={(e) => set(["lostInfo", "notes"], e.target.value)}
                  className="w-full border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-shadow text-sm"
                  rows={2}
                />
              </div>
            </div>
          </section>
        )}
      </div>

      <aside className="lg:sticky lg:top-6 space-y-4">
        <QuoteSummaryPanel
          form={form}
          totals={totals}
          displayCustomerName={displayCustomerName}
          vehicleSummary={vehicleSummary}
          insuranceCompanyName={companies.find((c) => c.id === form.insuranceCompanyId)?.name}
        />

        <div className="bg-white dark:bg-gray-900 dark:border dark:border-gray-800 rounded-xl shadow-sm p-4">
          <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">{t("customerSuggestedPrice")}</label>
          <CurrencyInput
            value={form.customerSuggestedPrice}
            onChange={(v) => set(["customerSuggestedPrice"], v)}
          />
        </div>

        <button type="submit" className="w-full bg-gray-900 hover:bg-gray-800 dark:bg-blue-600 dark:hover:bg-blue-700 text-white rounded-lg transition-colors py-3 text-sm font-medium">
          {t("confirmSave")}
        </button>
        {onCancel && (
          <button type="button" onClick={onCancel} className="w-full border rounded-lg py-3 text-sm font-medium text-gray-600">
            {tc("cancel")}
          </button>
        )}
      </aside>
    </form>
  );
}
