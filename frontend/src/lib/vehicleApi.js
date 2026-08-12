import { request } from "./api";

export const decodeVin = (vin) => request(`/vehicle/vin/${encodeURIComponent(vin)}`);
export const getVehicleMakes = (year) => request(`/vehicle/makes/${encodeURIComponent(year)}`);
export const getVehicleModels = (year, makeId) =>
  request(`/vehicle/models/${encodeURIComponent(year)}/${encodeURIComponent(makeId)}`);
