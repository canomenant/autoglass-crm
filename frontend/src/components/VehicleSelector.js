"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import SearchableSelect from "./SearchableSelect";
import { getCurrentUser, createVehicleType } from "@/lib/api";
import {
  decodeVin,
  getVehicleMakes,
  getVehicleModels,
  getCatalogYears,
  getCatalogMakes,
  getCatalogModels,
  getCatalogBodyTypes,
} from "@/lib/vehicleApi";

// Kept in sync with vehicleTypes.store.js#BODY_TYPES. Only used as a last-resort local fallback:
// the body-type list normally arrives from the cascade, which already substitutes the full
// taxonomy when it knows nothing about a combination.
const BODY_TYPES = ["Convertible", "Coupe", "Hatchback", "Minivan", "Pickup", "SUV", "Sedan", "Truck", "Van", "Wagon"];

const inputClass =
  "w-full border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-shadow text-sm disabled:bg-gray-100 dark:disabled:bg-gray-900 disabled:cursor-not-allowed";

// Maps NHTSA's BodyClass (free text, e.g. "Sport Utility Vehicle (SUV)/Multi-Purpose Vehicle
// (MPV)") onto the taxonomy. Mirrors vehicleTypes.store.js#normalizeBodyType — including the two
// corrections the catalog forced: this list spells a minivan "Mini Passenger Van", and a cab style
// implies a pickup even when the word never appears. No match returns "" so the user picks; it
// never invents a value.
function mapBodyClass(bodyClass) {
  const s = String(bodyClass || "").toLowerCase();
  if (!s) return "";
  if (s.includes("minivan") || s.includes("mini passenger van") || s.includes("mini cargo van")) return "Minivan";
  if (s.includes("suv") || s.includes("sport utility") || s.includes("multi-purpose")) return "SUV";
  if (s.includes("pickup") || /\b(crew|ext|extended|reg|regular|club|quad|king|access|double|super)\s*cab\b/.test(s)) return "Pickup";
  if (s.includes("convertible") || s.includes("cabriolet") || s.includes("roadster")) return "Convertible";
  if (s.includes("hatchback") || s.includes("liftback")) return "Hatchback";
  if (s.includes("wagon")) return "Wagon";
  if (s.includes("van")) return "Van";
  if (s.includes("coupe")) return "Coupe";
  if (s.includes("sedan") || s.includes("saloon")) return "Sedan";
  if (s.includes("truck")) return "Truck";
  return "";
}

// Adds a vehicle the catalog does not have, without leaving the quote. Nothing already typed into
// the quote is rebuilt — this appends to the catalog and writes the chosen vehicle onto the form.
//
// NHTSA appears here and nowhere else in this component's dropdowns: when the catalog has no
// models for a year and make, it is asked for suggestions so the user is not typing from memory.
// What gets saved goes to the catalog either way.
function AddVehicleModal({ initial, t, tc, onCancel, onSaved }) {
  const [year, setYear] = useState(String(initial.year || ""));
  const [make, setMake] = useState(initial.make || "");
  const [model, setModel] = useState(initial.model || "");
  const [bodyType, setBodyType] = useState(initial.bodyType || "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [duplicate, setDuplicate] = useState(null);
  const [suggestions, setSuggestions] = useState([]);

  useEffect(() => {
    const y = String(year || "");
    if (!/^\d{4}$/.test(y) || !make.trim()) {
      setSuggestions([]);
      return;
    }
    let cancelled = false;
    // Name -> NHTSA makeId, then that make's models for the year. Best-effort: suggestions failing
    // must never block adding a vehicle by hand.
    getVehicleMakes(y)
      .then((r) => {
        const match = (r.makes || []).find((m) => m.name.toLowerCase() === make.trim().toLowerCase());
        if (!match) return { models: [] };
        return getVehicleModels(y, match.id);
      })
      .then((r) => { if (!cancelled) setSuggestions(r.models || []); })
      .catch(() => { if (!cancelled) setSuggestions([]); });
    return () => { cancelled = true; };
  }, [year, make]);

  async function handleSave() {
    if (saving || !year.trim() || !make.trim() || !model.trim()) return;
    setSaving(true);
    setError("");
    setDuplicate(null);
    try {
      const created = await createVehicleType({ year: Number(year), make: make.trim(), model: model.trim(), bodyType });
      onSaved(created);
    } catch (err) {
      // The server compares the whole combination with case and spacing squashed out, and hands
      // back what it found. Offering that is what the user wanted anyway.
      if (err.details?.duplicate && err.details.existing) setDuplicate(err.details.existing);
      else setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  // Rendered inside the quote's <form>, so a stray Enter would submit the whole quote.
  function handleKeyDown(e) {
    if (e.key !== "Enter") return;
    e.preventDefault();
    handleSave();
  }

  const labelClass = "block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1";

  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4" onClick={onCancel}>
      <div className="bg-white dark:bg-gray-900 rounded-xl shadow-xl w-full max-w-md" onClick={(e) => e.stopPropagation()}>
        <div className="px-4 py-3 border-b dark:border-gray-800">
          <h3 className="text-sm font-semibold dark:text-gray-100">{t("addVehicleTitle")}</h3>
        </div>

        <div className="p-4 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelClass}>{tc("year")}</label>
              <input type="number" value={year} onChange={(e) => setYear(e.target.value)} onKeyDown={handleKeyDown} className={inputClass} />
            </div>
            <div>
              <label className={labelClass}>{tc("make")}</label>
              <input value={make} onChange={(e) => setMake(e.target.value)} onKeyDown={handleKeyDown} className={inputClass} />
            </div>
          </div>

          <div>
            <label className={labelClass}>{tc("model")}</label>
            <input list="nhtsa-model-suggestions" value={model} onChange={(e) => setModel(e.target.value)} onKeyDown={handleKeyDown} autoFocus className={inputClass} />
            <datalist id="nhtsa-model-suggestions">
              {suggestions.map((s) => <option key={s} value={s} />)}
            </datalist>
            {suggestions.length > 0 && (
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">{t("addVehicleSuggestions", { count: suggestions.length })}</p>
            )}
          </div>

          <div>
            <label className={labelClass}>{tc("bodyType")}</label>
            <select value={bodyType} onChange={(e) => setBodyType(e.target.value)} className={inputClass}>
              <option value="">{t("selectBodyType")}</option>
              {BODY_TYPES.map((b) => <option key={b} value={b}>{b}</option>)}
            </select>
          </div>

          {duplicate && (
            <div className="rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-500/10 dark:border-amber-700 px-3 py-2 text-sm">
              <div className="text-amber-800 dark:text-amber-300">
                {t("addVehicleDuplicate", { vehicle: [duplicate.year, duplicate.make, duplicate.model, duplicate.bodyType].filter(Boolean).join(" ") })}
              </div>
              <button type="button" onClick={() => onSaved(duplicate)} className="mt-2 text-xs font-medium text-blue-600 dark:text-blue-400 hover:underline">
                {t("addVehicleUseExisting")}
              </button>
            </div>
          )}
          {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
        </div>

        <div className="px-4 py-3 border-t dark:border-gray-800 flex justify-end gap-2">
          <button type="button" onClick={onCancel} className="text-sm font-medium text-gray-600 dark:text-gray-300 border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 rounded-lg px-4 py-1.5">
            {tc("cancel")}
          </button>
          <button type="button" onClick={handleSave} disabled={saving || !year.trim() || !make.trim() || !model.trim()} className="text-sm font-medium bg-gray-900 hover:bg-gray-800 dark:bg-blue-600 dark:hover:bg-blue-700 text-white rounded-lg px-4 py-1.5 disabled:opacity-50">
            {tc("save")}
          </button>
        </div>
      </div>
    </div>
  );
}

// value / onChange work directly on the shape quotes and work orders already store:
// { year, make, model, bodyType, vin, plate }. Everything the dropdowns offer comes from the local
// catalog, addressed by name — the quote holds text, and a catalog id on it would break the moment
// a catalog row was edited or removed.
export default function VehicleSelector({ value, onChange }) {
  const t = useTranslations("quoteForm");
  const tc = useTranslations("common");

  const [years, setYears] = useState([]);
  const [makes, setMakes] = useState([]);
  const [models, setModels] = useState([]);
  const [bodyTypes, setBodyTypes] = useState(BODY_TYPES);
  const [bodyTypeSource, setBodyTypeSource] = useState("taxonomy");
  const [trim, setTrim] = useState("");
  const [decoding, setDecoding] = useState(false);
  const [decodeError, setDecodeError] = useState("");
  const [otherBodyType, setOtherBodyType] = useState(false);
  const [pendingVehicle, setPendingVehicle] = useState(null);
  const lastDecodedVinRef = useRef("");

  const year = value.year;
  const validYear = /^\d{4}$/.test(String(year || ""));
  const canAddVehicle = ["ADMIN", "AGENT"].includes(getCurrentUser()?.role);

  useEffect(() => {
    let cancelled = false;
    getCatalogYears()
      .then((r) => { if (!cancelled) setYears(r.years || []); })
      .catch(() => { if (!cancelled) setYears([]); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!validYear) {
      setMakes([]);
      return;
    }
    let cancelled = false;
    getCatalogMakes(year)
      .then((r) => { if (!cancelled) setMakes(r.makes || []); })
      .catch(() => { if (!cancelled) setMakes([]); });
    return () => { cancelled = true; };
  }, [validYear, year]);

  useEffect(() => {
    if (!validYear || !value.make) {
      setModels([]);
      return;
    }
    let cancelled = false;
    getCatalogModels(year, value.make)
      .then((r) => { if (!cancelled) setModels(r.models || []); })
      .catch(() => { if (!cancelled) setModels([]); });
    return () => { cancelled = true; };
  }, [validYear, year, value.make]);

  useEffect(() => {
    if (!validYear || !value.make || !value.model) {
      setBodyTypes(BODY_TYPES);
      setBodyTypeSource("taxonomy");
      return;
    }
    let cancelled = false;
    getCatalogBodyTypes(year, value.make, value.model)
      .then((r) => {
        if (cancelled) return;
        setBodyTypes(r.bodyTypes?.length ? r.bodyTypes : BODY_TYPES);
        setBodyTypeSource(r.source || "taxonomy");
      })
      .catch(() => {
        if (cancelled) return;
        setBodyTypes(BODY_TYPES);
        setBodyTypeSource("taxonomy");
      });
    return () => { cancelled = true; };
  }, [validYear, year, value.make, value.model]);

  // A stored body type outside the offered list (an older quote holding raw trim text, e.g.
  // "Base Crew Cab Pickup 4-Door") shows in the free-text mode with its value intact instead of
  // being silently dropped.
  useEffect(() => {
    if (value.bodyType && !bodyTypes.includes(value.bodyType)) setOtherBodyType(true);
  }, [value.bodyType, bodyTypes]);

  const yearOptions = useMemo(() => years.map((y) => ({ value: String(y), label: String(y) })), [years]);
  const makeOptions = useMemo(() => makes.map((m) => ({ value: m, label: m })), [makes]);
  const modelOptions = useMemo(() => models.map((m) => ({ value: m, label: m })), [models]);

  const patch = useCallback((fields) => onChange({ ...value, ...fields }), [onChange, value]);

  function handleYearChange(nextYear) {
    patch({ year: nextYear, make: "", model: "", bodyType: "" });
    setOtherBodyType(false);
  }

  function handleMakeChange(make) {
    patch({ make, model: "", bodyType: "" });
    setOtherBodyType(false);
  }

  function handleModelChange(model) {
    patch({ model, bodyType: "" });
    setOtherBodyType(false);
  }

  function handleBodyTypeSelectChange(e) {
    const v = e.target.value;
    if (v === "__other__") {
      setOtherBodyType(true);
      if (bodyTypes.includes(value.bodyType)) patch({ bodyType: "" });
      return;
    }
    setOtherBodyType(false);
    patch({ bodyType: v });
  }

  // Saved or matched an existing row — select it on the quote and let the cascade effects refresh.
  function handleVehicleSaved(entry) {
    setOtherBodyType(false);
    patch({
      year: String(entry.year || value.year),
      make: entry.make || "",
      model: entry.model || "",
      bodyType: entry.bodyType || "",
    });
    setPendingVehicle(null);
  }

  async function runDecode(vin) {
    setDecoding(true);
    setDecodeError("");
    try {
      const r = await decodeVin(vin);
      setTrim(r.trim || "");
      setOtherBodyType(false);
      patch({
        year: r.year || value.year,
        make: r.make || value.make,
        model: r.model || value.model,
        bodyType: mapBodyClass(r.bodyClass),
      });
    } catch (err) {
      setDecodeError(err.message || t("vinDecodeError"));
    } finally {
      setDecoding(false);
    }
  }

  function handleDecodeVinClick() {
    if (!value.vin) return;
    lastDecodedVinRef.current = value.vin;
    runDecode(value.vin);
  }

  useEffect(() => {
    const vin = value.vin || "";
    if (vin.length !== 17 || vin === lastDecodedVinRef.current) return;
    const timer = setTimeout(() => {
      lastDecodedVinRef.current = vin;
      runDecode(vin);
    }, 500);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value.vin]);

  const bodyTypeSelectValue = otherBodyType ? "__other__" : (bodyTypes.includes(value.bodyType) ? value.bodyType : "");
  const labelClass = "block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1";

  return (
    <>
      <div>
        <label className={labelClass}>
          {tc("year")} <span className="text-red-500">*</span>
        </label>
        <SearchableSelect
          value={String(value.year || "")}
          onChange={handleYearChange}
          options={yearOptions}
          placeholder={t("selectYear")}
          required
          fallbackLabel={String(value.year || "")}
        />
      </div>

      <div>
        <label className={labelClass}>
          {tc("make")} <span className="text-red-500">*</span>
        </label>
        <SearchableSelect
          value={value.make}
          onChange={handleMakeChange}
          options={makeOptions}
          placeholder={t("selectMake")}
          disabled={!validYear}
          required
          fallbackLabel={value.make}
          onCreateOption={canAddVehicle ? (term) => setPendingVehicle({ year: value.year, make: term, model: "", bodyType: "" }) : undefined}
          createOptionLabel={() => t("addVehicleOption")}
        />
      </div>

      <div>
        <label className={labelClass}>
          {tc("model")} <span className="text-red-500">*</span>
        </label>
        <SearchableSelect
          value={value.model}
          onChange={handleModelChange}
          options={modelOptions}
          placeholder={t("selectModel")}
          disabled={!value.make}
          required
          fallbackLabel={value.model}
          onCreateOption={canAddVehicle ? (term) => setPendingVehicle({ year: value.year, make: value.make, model: term, bodyType: "" }) : undefined}
          createOptionLabel={() => t("addVehicleOption")}
        />
      </div>

      <div>
        <label className={labelClass}>{tc("bodyType")}</label>
        <select value={bodyTypeSelectValue} onChange={handleBodyTypeSelectChange} className={inputClass}>
          <option value="">{t("selectBodyType")}</option>
          {bodyTypes.map((b) => <option key={b} value={b}>{b}</option>)}
          <option value="__other__">{tc("other")}</option>
        </select>
        {/* Says where the list came from rather than passing an inference off as a filtered result.
            "model" means it was borrowed from the same model in other years; "taxonomy" means the
            catalog knows nothing about this combination — true for about one in five of them, and
            for anything seeded from NHTSA, whose model listing carries no body type. */}
        {value.model && bodyTypeSource !== "exact" && (
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
            {bodyTypeSource === "model" ? t("bodyTypeFromModel") : t("bodyTypeUnfiltered")}
          </p>
        )}
        {otherBodyType && (
          <input
            type="text"
            value={value.bodyType}
            onChange={(e) => patch({ bodyType: e.target.value })}
            placeholder={t("bodyTypeOtherPlaceholder")}
            className={`${inputClass} mt-2`}
          />
        )}
      </div>

      <div>
        <label className={labelClass}>{tc("vin")}</label>
        <div className="flex gap-2">
          <div className="relative flex-1">
            <input
              type="text"
              value={value.vin}
              onChange={(e) => patch({ vin: e.target.value.toUpperCase() })}
              placeholder={t("vinHint")}
              maxLength={17}
              className={inputClass}
            />
            {decoding && (
              <span
                aria-hidden="true"
                className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 border-2 border-gray-300 border-t-blue-600 rounded-full animate-spin"
              />
            )}
          </div>
          <button
            type="button"
            onClick={handleDecodeVinClick}
            disabled={decoding || !value.vin}
            className="shrink-0 bg-gray-900 hover:bg-gray-800 dark:bg-blue-600 dark:hover:bg-blue-700 disabled:bg-gray-300 dark:disabled:bg-gray-700 disabled:cursor-not-allowed text-white rounded-lg transition-colors px-4 py-2 text-sm"
          >
            {decoding ? t("decodingVin") : t("decodeVin")}
          </button>
        </div>
        {decodeError && <p className="mt-1 text-xs text-red-500">{decodeError}</p>}
        {trim && <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">{t("trimLabel")}: {trim}</p>}
      </div>

      <div>
        <label className={labelClass}>{tc("plate")}</label>
        <input type="text" value={value.plate} onChange={(e) => patch({ plate: e.target.value })} className={inputClass} />
      </div>

      {pendingVehicle && (
        <AddVehicleModal
          initial={pendingVehicle}
          t={t}
          tc={tc}
          onCancel={() => setPendingVehicle(null)}
          onSaved={handleVehicleSaved}
        />
      )}
    </>
  );
}
