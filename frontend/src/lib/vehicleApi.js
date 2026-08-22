import { request } from "./api";

// The catalog cascade. This is what the quote form's dropdowns read — one source, each level
// answering only for the one above it.
const q = (params) =>
  new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== "")).toString();

export const getCatalogYears = () => request("/settings/vehicle-types/cascade/years");
export const getCatalogMakes = (year) => request(`/settings/vehicle-types/cascade/makes?${q({ year })}`);
export const getCatalogModels = (year, make) => request(`/settings/vehicle-types/cascade/models?${q({ year, make })}`);
export const getCatalogBodyTypes = (year, make, model) =>
  request(`/settings/vehicle-types/cascade/body-types?${q({ year, make, model })}`);

// NHTSA. No longer feeds any dropdown — it decodes VINs, which is what it is genuinely good at,
// and suggests values inside the add-a-vehicle modal when the catalog has nothing for a year and
// make. Whatever the user accepts from a suggestion is written to the catalog, never read from
// here again.
export const decodeVin = (vin) => request(`/vehicle/vin/${encodeURIComponent(vin)}`);
export const getVehicleMakes = (year) => request(`/vehicle/makes/${encodeURIComponent(year)}`);
export const getVehicleModels = (year, makeId) =>
  request(`/vehicle/models/${encodeURIComponent(year)}/${encodeURIComponent(makeId)}`);
