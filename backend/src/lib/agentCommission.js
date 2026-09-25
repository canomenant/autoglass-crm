// Comisión del agente calculada por su plan (Antonio, 24-sep-2026).
//
// Hasta hoy work_orders.commission se tecleaba a mano en cada orden: el "Commission Type / Rate" de
// la ficha del agente no calculaba nada. Ahora el agente tiene un PLAN con versiones, cada una con
// su fecha "vigente desde", y la comisión de una orden sale de ahí. Reglas de Antonio:
//
//   - Se paga POR VIDRIO según SU price tier, y se suman: un windshield Aftermarket, un door glass
//     Aftermarket y un back glass OEM son tres comisiones (Aftermarket + Aftermarket + OEM).
//   - Un renglón de servicio (chip repair, calibración...) paga lo del renglón "Servicios" del plan;
//     una pieza que no es vidrio (moldura, sensor, adhesivo) y el labor/viaje/entrega no pagan.
//   - La fecha que decide qué versión aplica es el día en que la orden quedó PAGADA
//     (work_orders.paid_at). Una orden pagada antes de la fecha de un plan no se toca, y las
//     pagadas antes de que existiera paid_at no tienen fecha: ningún plan las alcanza.
//   - Lo que una persona teclea en la orden gana (commission_source = 'manual') y el plan ya no lo
//     recalcula, salvo que alguien pida explícitamente volver al plan.
//
// Plan general + excepción por agente: un agente sin versiones propias usa las del plan general.

const jobTypesStore = require("../store/jobTypes.store");

const RATE_TYPES = ["Fixed", "Percentage"];

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

// Una tasa lleva DOS cifras: `value` cuando el cliente pagó electrónico (Zelle, tarjeta, Venmo,
// Cash App...) y `cashValue` cuando pagó en efectivo, que al agente se le paga menos (Antonio,
// 25-sep-2026). Sin cashValue, el efectivo paga lo mismo que el electrónico.
function normalizeRate(r) {
  const type = RATE_TYPES.includes(r?.type) ? r.type : "Fixed";
  const value = round2(r?.value);
  const cash = r?.cashValue === undefined || r?.cashValue === null || r?.cashValue === "" ? null : round2(r.cashValue);
  return { type, value: value > 0 ? value : 0, cashValue: cash === null ? null : cash > 0 ? cash : 0 };
}

function rateValue(rate, cash) {
  if (!rate) return 0;
  return cash && rate.cashValue !== null && rate.cashValue !== undefined ? rate.cashValue : rate.value;
}

function isIsoDate(s) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(s || "")) && !Number.isNaN(new Date(`${s}T00:00:00Z`).getTime());
}

// Las metas del bono semanal (10/20/30 trabajos → $). Viajan con la versión del plan para que un
// cambio de metas también tenga su fecha. Ordenadas y sin repetidos.
function normalizeGoals(goals) {
  const porTrabajos = new Map();
  for (const g of Array.isArray(goals) ? goals : []) {
    const jobs = Math.floor(Number(g?.jobs));
    const bonus = round2(g?.bonus);
    if (jobs > 0 && bonus > 0) porTrabajos.set(jobs, { jobs, bonus });
  }
  return [...porTrabajos.values()].sort((a, b) => a.jobs - b.jobs);
}

// Una versión del plan. `tiers` va por NOMBRE del price tier, igual que lo guarda el renglón de la
// cotización (li.priceTier). `noTier` es el vidrio sin tier (típico de seguro); `services` va POR
// TIPO DE TRABAJO (Chip Repair no paga lo mismo que Rock Chip Repair — Antonio, 24-sep-2026);
// `calibration` es aparte porque casi siempre viaja DENTRO del renglón del parabrisas
// (li.calibrationType), no como renglón propio; `lead` lo que gana por lead vendido (fijo).
function normalizeVersion(v) {
  if (!isIsoDate(v?.effectiveFrom)) throw new Error("Each commission plan version needs a valid 'effective from' date.");
  const tiers = {};
  for (const [name, rate] of Object.entries(v?.tiers || {})) {
    const key = String(name || "").trim();
    if (key) tiers[key] = normalizeRate(rate);
  }
  return {
    id: v.id || `${v.effectiveFrom}-${Math.random().toString(36).slice(2, 8)}`,
    effectiveFrom: v.effectiveFrom,
    tiers,
    noTier: normalizeRate(v.noTier),
    services: Object.fromEntries(
      Object.entries(v?.services && typeof v.services === "object" && !("type" in v.services) ? v.services : {})
        .map(([name, rate]) => [String(name || "").trim(), normalizeRate(rate)])
        .filter(([name]) => name)
    ),
    calibration: normalizeRate(v.calibration),
    lead: { value: round2(v.lead?.value) > 0 ? round2(v.lead?.value) : 0 },
    goals: normalizeGoals(v.goals),
    note: String(v.note || "").trim(),
    createdAt: v.createdAt || new Date().toISOString(),
    createdBy: v.createdBy || "",
  };
}

// Lista de versiones ordenada por fecha. Dos versiones con la misma fecha no tienen sentido: la
// segunda nunca aplicaría. Se rechaza en vez de escoger una en silencio.
function normalizePlanVersions(list) {
  const versions = (Array.isArray(list) ? list : []).map(normalizeVersion);
  versions.sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom));
  for (let i = 1; i < versions.length; i += 1) {
    if (versions[i].effectiveFrom === versions[i - 1].effectiveFrom) {
      throw new Error(`Two commission plan versions start on ${versions[i].effectiveFrom}.`);
    }
  }
  return versions;
}

// La fecha en que se pagó, en el día de Texas: una orden cobrada a las 8 pm del 30 de septiembre
// es del 30, aunque en UTC ya sea 1 de octubre.
function businessDate(value) {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
}

function versionFor(versions, date) {
  if (!date) return null;
  let found = null;
  for (const v of versions || []) {
    if (v.effectiveFrom <= date) found = v;
  }
  return found;
}

// Los tipos de trabajo que son SERVICIO para la comisión: ni vidrio con tier, ni pieza, ni el labor,
// viaje o entrega (costo del trabajo), ni la calibración (tiene su propio renglón en el plan).
function isServiceJobType(name) {
  const jt = jobTypesStore.findByName(name);
  if (!jt) return false;
  if (jt.allowsPriceTier !== false) return false;
  if (jt.isTaxable !== false) return false;
  return !/labor|trip|delivery|delibery|calibra/i.test(String(name)) && !isCancellationJobType(name);
}

// El cobro por cancelar: no es trabajo hecho, así que no paga comisión ni cuenta para la meta
// semanal (Antonio, 25-sep-2026).
function isCancellationJobType(name) {
  return /cancel/i.test(String(name || ""));
}

// ¿La orden tuvo trabajo de verdad? Cuenta para la meta si tiene algún renglón que no sea el cobro
// por cancelar ni el viaje. Wo-4817 (cancelación cobrada como upsell sobre un Trip en $0) no cuenta.
function countsAsJob(lineItems) {
  return (Array.isArray(lineItems) ? lineItems : []).some((li) => {
    const jt = String(li?.jobType || "").trim();
    return jt && !isCancellationJobType(jt) && !/^trip$/i.test(jt);
  });
}

function serviceJobTypes() {
  return jobTypesStore.list().filter((j) => isServiceJobType(j.name)).map((j) => j.name).sort();
}

// Qué tipo de renglón es para la comisión.
function lineKind(li) {
  if (isCancellationJobType(li?.jobType)) return null;
  if (/calibra/i.test(String(li?.jobType || ""))) return "calibration";
  if (String(li?.priceTier || "").trim()) return "tier";
  const jobType = String(li?.jobType || "");
  // Un vidrio al que no se le puso tier (las cotizaciones de seguro no lo llevan).
  if (jobType && jobTypesStore.allowsPriceTier(jobType) && jobTypesStore.findByName(jobType)) return "noTier";
  // Lo que no es venta: la mano de obra, el viaje y la entrega son costo del trabajo, no producto.
  if (/labor|trip|delivery|delibery/i.test(jobType)) return null;
  const quotesStore = require("../store/quotes.store");
  if (quotesStore.isPartLineItem(li)) return null; // moldura, sensor, adhesivo: pieza, no vidrio
  return jobType ? "service" : null;
}

// Lo que se le cobra al cliente por ese renglón, para las tasas en porcentaje: la parte más la
// mano de obra de su tier.
function linePrice(li, priceTiers) {
  const tier = (priceTiers || []).find((p) => p.name === li.priceTier);
  return round2(Number(li.pricePart || 0) + Number(tier?.amount || 0));
}

// El cálculo en sí. Devuelve el total y el desglose renglón por renglón. `cash` = el cliente pagó
// en efectivo (ver cashCollected.esEfectivoEnMano): se usa la cifra de efectivo de cada tasa.
function computeCommission(lineItems, version, priceTiers, { cash = false } = {}) {
  const calibrationTypes = require("../store/calibrationTypes.store").list();
  const lines = [];
  const push = (li, kind, rate, base, label) => {
    const value = rateValue(rate, cash);
    if (!(value > 0)) return;
    const amount = rate.type === "Percentage" ? round2((base * value) / 100) : round2(value);
    if (!(amount > 0)) return;
    lines.push({
      label,
      jobType: li.jobType || "",
      priceTier: kind === "tier" ? li.priceTier : "",
      kind,
      type: rate.type,
      value,
      base: rate.type === "Percentage" ? base : null,
      amount,
    });
  };
  for (const li of Array.isArray(lineItems) ? lineItems : []) {
    const kind = lineKind(li);
    const calType = String(li.calibrationType || "").trim();
    const calPrice = Number(calibrationTypes.find((c) => c.name === calType)?.amount || 0);
    if (kind === "calibration") {
      // Renglón de calibración propio: paga una vez, aunque además traiga su tipo de calibración.
      push(li, "calibration", version.calibration, round2(Number(li.pricePart || 0) + calPrice), calType || li.jobType || "Calibration");
      continue;
    }
    // La calibración que va dentro del renglón del vidrio paga ADEMÁS del vidrio.
    if (calType) push(li, "calibration", version.calibration, round2(calPrice), `Calibration · ${calType}`);
    if (!kind) continue;
    const rate = kind === "tier" ? version.tiers?.[li.priceTier] : kind === "noTier" ? version.noTier : version.services?.[li.jobType];
    push(li, kind, rate, linePrice(li, priceTiers), li.nagsDescription || li.jobType || "");
  }
  return { amount: round2(lines.reduce((s, l) => s + l.amount, 0)), lines, payMode: cash ? "cash" : "electronic" };
}

module.exports = {
  RATE_TYPES,
  serviceJobTypes,
  countsAsJob,
  normalizePlanVersions,
  versionFor,
  businessDate,
  computeCommission,
  round2,
};
