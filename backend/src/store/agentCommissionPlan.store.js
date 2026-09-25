const { getAppData, setAppData } = require("../lib/initPostgres");
const { normalizePlanVersions } = require("../lib/agentCommission");

// El plan de comisión GENERAL: el que usa todo agente que no tiene uno propio (ver
// lib/agentCommission). Va directo a app_data con su propia llave, no por persistence.save(): un
// store nuevo que sólo escribe el archivo local se pierde en el siguiente despliegue si nadie
// sembró antes su fila en app_data (pasó con el mensaje al técnico, 18-sep-2026).
const KEY = "agentCommissionPlan.default";

let cache = null;

async function getDefault() {
  if (cache) return cache;
  const stored = await getAppData(KEY, null);
  cache = normalizePlanVersions(stored?.versions || []);
  return cache;
}

async function setDefault(versions, actor) {
  const normalized = normalizePlanVersions(
    (Array.isArray(versions) ? versions : []).map((v) => ({ ...v, createdBy: v.createdBy || actor || "" }))
  );
  await setAppData(KEY, { versions: normalized, updatedAt: new Date().toISOString(), updatedBy: actor || "" });
  cache = normalized;
  return normalized;
}

// Las versiones que le aplican a un agente: las suyas si tiene, si no las del plan general.
async function versionsForAgent(agentId) {
  const own = require("./agents.store").planVersions(agentId);
  if (own && own.length) return { versions: own, source: "agent" };
  return { versions: await getDefault(), source: "default" };
}

module.exports = { getDefault, setDefault, versionsForAgent };
