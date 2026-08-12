"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import SearchableSelect from "./SearchableSelect";
import { decodeVin, getVehicleMakes, getVehicleModels } from "@/lib/vehicleApi";

const BODY_TYPES = ["Sedan", "Coupe", "SUV", "Pickup", "Van", "Wagon", "Hatchback", "Convertible", "Truck", "Minivan", "Other"];

const inputClass =
  "w-full border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-shadow text-sm disabled:bg-gray-100 dark:disabled:bg-gray-900 disabled:cursor-not-allowed";

// Mapea el BodyClass de NHTSA (texto libre y muy variado, ej. "Sport Utility Vehicle (SUV)/Multi-
// Purpose Vehicle (MPV)") a la lista fija de body types. Sin match conocido devuelve "" para que
// el usuario elija a mano — nunca inventa un valor.
function mapBodyClass(bodyClass) {
  if (!bodyClass) return "";
  const s = bodyClass.toLowerCase();
  if (s.includes("minivan")) return "Minivan";
  if (s.includes("suv") || s.includes("sport utility") || s.includes("multi-purpose")) return "SUV";
  if (s.includes("pickup")) return "Pickup";
  if (s.includes("convertible") || s.includes("cabriolet") || s.includes("roadster")) return "Convertible";
  if (s.includes("hatchback") || s.includes("liftback")) return "Hatchback";
  if (s.includes("wagon")) return "Wagon";
  if (s.includes("van")) return "Van";
  if (s.includes("coupe")) return "Coupe";
  if (s.includes("sedan") || s.includes("saloon")) return "Sedan";
  if (s.includes("truck")) return "Truck";
  return "";
}

// value / onChange trabajan directamente sobre el shape existente de quotes/work orders:
// { year, make, model, bodyType, vin, plate }. makeId es un detalle interno de NHTSA —
// nunca sale de este componente.
export default function VehicleSelector({ value, onChange }) {
  const t = useTranslations("quoteForm");
  const tc = useTranslations("common");

  const [makes, setMakes] = useState([]);
  const [models, setModels] = useState([]);
  const [makeId, setMakeId] = useState(null);
  const [trim, setTrim] = useState("");
  const [decoding, setDecoding] = useState(false);
  const [decodeError, setDecodeError] = useState("");
  const [otherBodyType, setOtherBodyType] = useState(false);
  // Último VIN de 17 caracteres ya consultado (éxito o error) — evita repetir la llamada
  // tanto para el auto-trigger como para un VIN que el usuario cambió y volvió a dejar igual.
  // El botón manual lo ignora a propósito: un click siempre dispara.
  const lastDecodedVinRef = useRef("");

  const year = value.year;
  const validYear = /^\d{4}$/.test(String(year || ""));

  // Marcas: sólo hace falta un año con formato válido (NHTSA no filtra por año, pero el
  // endpoint lo exige en la URL) — se mantiene el mismo gate "elegí año primero" del form original.
  useEffect(() => {
    if (!validYear) {
      setMakes([]);
      return;
    }
    let cancelled = false;
    getVehicleMakes(year)
      .then((r) => { if (!cancelled) setMakes(r.makes || []); })
      .catch(() => { if (!cancelled) setMakes([]); });
    return () => { cancelled = true; };
  }, [validYear, year]);

  // Resuelve el makeId a partir del nombre guardado en value.make — cubre tanto editar un
  // vehículo ya cargado como el resultado de un VIN decode (que sólo trae el nombre).
  useEffect(() => {
    if (!value.make || makes.length === 0) {
      setMakeId(null);
      return;
    }
    const match = makes.find((m) => m.name.toLowerCase() === value.make.toLowerCase());
    setMakeId(match ? match.id : null);
  }, [value.make, makes]);

  // Modelos: hace falta año + makeId resuelto.
  useEffect(() => {
    if (!validYear || !makeId) {
      setModels([]);
      return;
    }
    let cancelled = false;
    getVehicleModels(year, makeId)
      .then((r) => { if (!cancelled) setModels(r.models || []); })
      .catch(() => { if (!cancelled) setModels([]); });
    return () => { cancelled = true; };
  }, [validYear, makeId, year]);

  // Si value.bodyType llega con un valor que no está en la lista fija (vehículo ya guardado
  // con texto libre de antes), mostrar el modo "Otro" con ese texto en vez de perderlo.
  useEffect(() => {
    if (value.bodyType && !BODY_TYPES.includes(value.bodyType)) setOtherBodyType(true);
  }, [value.bodyType]);

  const makeOptions = useMemo(() => makes.map((m) => ({ value: String(m.id), label: m.name })), [makes]);
  const modelOptions = useMemo(() => models.map((m) => ({ value: m, label: m })), [models]);

  function patch(fields) {
    onChange({ ...value, ...fields });
  }

  function handleYearChange(e) {
    patch({ year: e.target.value, make: "", model: "", bodyType: "" });
    setMakeId(null);
    setModels([]);
    setOtherBodyType(false);
  }

  function handleMakeChange(id) {
    const match = makes.find((m) => String(m.id) === String(id));
    setMakeId(id ? Number(id) : null);
    patch({ make: match ? match.name : "", model: "", bodyType: "" });
  }

  function handleModelChange(model) {
    patch({ model });
  }

  function handleBodyTypeSelectChange(e) {
    const v = e.target.value;
    if (v === "Other") {
      setOtherBodyType(true);
      if (BODY_TYPES.includes(value.bodyType)) patch({ bodyType: "" });
    } else {
      setOtherBodyType(false);
      patch({ bodyType: v });
    }
  }

  async function runDecode(vin) {
    setDecoding(true);
    setDecodeError("");
    try {
      const r = await decodeVin(vin);
      setTrim(r.trim || "");
      const mappedBodyType = mapBodyClass(r.bodyClass);
      setOtherBodyType(false);
      patch({
        year: r.year || value.year,
        make: r.make || value.make,
        model: r.model || value.model,
        bodyType: mappedBodyType,
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

  // Auto-trigger: apenas el VIN llega a 17 caracteres, espera 500ms sin más cambios y
  // decodifica sola. El chequeo es solo de longitud (no de formato) para que un VIN de 17
  // caracteres mal formado también dispare la consulta y el error del backend salga por
  // decodeError, en vez de tragárselo en silencio.
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

  const bodyTypeSelectValue = otherBodyType ? "Other" : (BODY_TYPES.includes(value.bodyType) ? value.bodyType : "");

  return (
    <>
      <div>
        <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
          {tc("year")} <span className="text-red-500">*</span>
        </label>
        <input
          type="number"
          value={value.year}
          onChange={handleYearChange}
          placeholder={t("selectYear")}
          min="1980"
          max={new Date().getFullYear() + 1}
          className={inputClass}
          required
        />
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
          {tc("make")} <span className="text-red-500">*</span>
        </label>
        <SearchableSelect
          value={makeId || ""}
          onChange={handleMakeChange}
          options={makeOptions}
          placeholder={t("selectMake")}
          disabled={!validYear}
          required
          fallbackLabel={value.make}
        />
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
          {tc("model")} <span className="text-red-500">*</span>
        </label>
        <SearchableSelect
          value={value.model}
          onChange={handleModelChange}
          options={modelOptions}
          placeholder={t("selectModel")}
          disabled={!makeId}
          required
        />
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">{tc("bodyType")}</label>
        <select value={bodyTypeSelectValue} onChange={handleBodyTypeSelectChange} className={inputClass}>
          <option value="">{t("selectBodyType")}</option>
          {BODY_TYPES.map((b) => (
            <option key={b} value={b}>{b === "Other" ? tc("other") : b}</option>
          ))}
        </select>
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
        <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">{tc("vin")}</label>
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
        {decoding && <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">{t("decodingVin")}</p>}
        {decodeError && <p className="mt-1 text-xs text-red-500">{decodeError}</p>}
        {trim && <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">{t("trimLabel")}: {trim}</p>}
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">{tc("plate")}</label>
        <input
          type="text"
          value={value.plate}
          onChange={(e) => patch({ plate: e.target.value })}
          className={inputClass}
        />
      </div>
    </>
  );
}
