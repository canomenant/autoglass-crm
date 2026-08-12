const express = require('express');
const axios = require('axios');

const router = express.Router();

const VPIC_BASE = 'https://vpic.nhtsa.dot.gov/api/vehicles';
const TIMEOUT_MS = 15000;

// ── Cache en memoria (makes/models cambian muy poco) ─────────────────────────
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24h
const cache = new Map();

function cacheGet(key) {
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }
  return hit.value;
}

function cacheSet(key, value) {
  cache.set(key, { value, at: Date.now() });
}

// ── Helpers ──────────────────────────────────────────────────────────────────
const clean = (v) => {
  if (v === null || v === undefined) return '';
  const s = String(v).trim();
  if (!s || s.toLowerCase() === 'null' || s.toLowerCase() === 'not applicable') return '';
  return s;
};

// VIN: 17 caracteres, sin I, O ni Q
const VIN_RE = /^[A-HJ-NPR-Z0-9]{17}$/i;

// ─────────────────────────────────────────────────────────────────────────────
// A) GET /api/vehicle/vin/:vin
// ─────────────────────────────────────────────────────────────────────────────
router.get('/vin/:vin', async (req, res) => {
  const vin = String(req.params.vin || '').trim().toUpperCase();

  if (!VIN_RE.test(vin)) {
    return res.status(400).json({ error: 'VIN inválido. Debe tener 17 caracteres (sin I, O, Q).' });
  }

  try {
    const url = `${VPIC_BASE}/DecodeVinValuesExtended/${encodeURIComponent(vin)}?format=json`;
    const { data } = await axios.get(url, { timeout: TIMEOUT_MS });

    const r = (data && data.Results && data.Results[0]) || null;
    if (!r) {
      return res.status(502).json({ error: 'Respuesta vacía de NHTSA vPIC.' });
    }

    const year = clean(r.ModelYear);
    const make = clean(r.Make);
    const model = clean(r.Model);

    // ErrorCode "0" = decodificado OK. Otros códigos pueden traer datos parciales.
    if (!year && !make && !model) {
      return res.status(404).json({
        error: 'No se pudo decodificar el VIN.',
        detail: clean(r.ErrorText) || 'Sin datos para este VIN.',
      });
    }

    return res.json({
      vin,
      year,
      make,
      model,
      trim: clean(r.Trim) || clean(r.Series),
      bodyClass: clean(r.BodyClass),
    });
  } catch (err) {
    const status = err.code === 'ECONNABORTED' ? 504 : 502;
    return res.status(status).json({
      error: 'Error al consultar NHTSA vPIC.',
      detail: err.message,
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// B) GET /api/vehicle/makes/:year
//    NOTA: GetMakesForVehicleType/car NO filtra por año — vPIC devuelve todas
//    las marcas de tipo "car". El :year se acepta pero la API lo ignora.
// ─────────────────────────────────────────────────────────────────────────────
router.get('/makes/:year', async (req, res) => {
  const year = String(req.params.year || '').trim();

  if (!/^\d{4}$/.test(year)) {
    return res.status(400).json({ error: 'Año inválido. Debe ser de 4 dígitos.' });
  }

  const cacheKey = 'makes:car';
  const cached = cacheGet(cacheKey);
  if (cached) return res.json({ year, count: cached.length, makes: cached });

  try {
    const url = `${VPIC_BASE}/GetMakesForVehicleType/car?format=json`;
    const { data } = await axios.get(url, { timeout: TIMEOUT_MS });

    const rows = (data && data.Results) || [];
    // MakeId es el identificador estable que /models necesita para poder filtrar por
    // vehicletype=car (GetModelsForMakeYear, basada en el nombre, no soporta ese filtro).
    const byId = new Map();
    for (const m of rows) {
      const id = m.MakeId;
      const name = clean(m.MakeName);
      if (id == null || !name || byId.has(id)) continue;
      byId.set(id, { id, name });
    }
    const makes = [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));

    cacheSet(cacheKey, makes);
    return res.json({ year, count: makes.length, makes });
  } catch (err) {
    const status = err.code === 'ECONNABORTED' ? 504 : 502;
    return res.status(status).json({ error: 'Error al consultar marcas.', detail: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// C) GET /api/vehicle/models/:year/:makeId
//    :makeId es el MakeId numérico devuelto por /makes (no el nombre) — hace falta para
//    poder pedirle a vPIC que filtre por tipo de vehículo.
// ─────────────────────────────────────────────────────────────────────────────
router.get('/models/:year/:makeId', async (req, res) => {
  const year = String(req.params.year || '').trim();
  const makeId = String(req.params.makeId || '').trim();

  if (!/^\d{4}$/.test(year)) {
    return res.status(400).json({ error: 'Año inválido. Debe ser de 4 dígitos.' });
  }
  if (!/^\d+$/.test(makeId)) {
    return res.status(400).json({ error: 'makeId inválido. Debe ser el ID numérico de la marca (ver /api/vehicle/makes).' });
  }

  const cacheKey = `models:${makeId}:${year}`;
  const cached = cacheGet(cacheKey);
  if (cached) return res.json({ year, makeId: Number(makeId), count: cached.length, models: cached });

  try {
    // vehicletype/car excluye motos y otros tipos que no aplican a un CRM de auto glass.
    // GetModelsForMakeIdYear espera el NOMBRE del tipo ("car"), no el VehicleTypeId numérico
    // — probado contra la API real: vehicletype/2 (el ID real de "Passenger Car") devuelve 0
    // resultados, vehicletype/car sí filtra correctamente.
    const url =
      `${VPIC_BASE}/GetModelsForMakeIdYear/makeId/${encodeURIComponent(makeId)}` +
      `/modelyear/${encodeURIComponent(year)}/vehicletype/car?format=json`;
    const { data } = await axios.get(url, { timeout: TIMEOUT_MS });

    const rows = (data && data.Results) || [];
    const models = [...new Set(rows.map((m) => clean(m.Model_Name)).filter(Boolean))].sort();

    cacheSet(cacheKey, models);
    return res.json({ year, makeId: Number(makeId), count: models.length, models });
  } catch (err) {
    const status = err.code === 'ECONNABORTED' ? 504 : 502;
    return res.status(status).json({ error: 'Error al consultar modelos.', detail: err.message });
  }
});

module.exports = router;
