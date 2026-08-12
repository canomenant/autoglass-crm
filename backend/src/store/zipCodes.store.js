const crypto = require("crypto");
const pool = require("../config/db");

function mapRow(row) {
  return {
    id: row.id,
    zipcode: row.zipcode,
    city: row.city || "",
    county: row.county || "",
    state: row.state || "",
    tax: Number(row.tax) || 0,
    serviceArea: row.service_area !== false,
    longTripRequired: !!row.long_trip_required,
    longTripFee: Number(row.long_trip_fee) || 0,
    distanceFromBase: Number(row.distance_from_base) || 0,
  };
}

async function list() {
  const r = await pool.query("SELECT * FROM zip_codes ORDER BY zipcode");
  return r.rows.map(mapRow);
}

async function get(id) {
  const r = await pool.query("SELECT * FROM zip_codes WHERE id = $1", [id]);
  if (!r.rows[0]) return null;
  return mapRow(r.rows[0]);
}

async function findByZipcode(zipcode) {
  const r = await pool.query("SELECT * FROM zip_codes WHERE zipcode = $1 LIMIT 1", [String(zipcode).trim()]);
  if (!r.rows[0]) return null;
  return mapRow(r.rows[0]);
}

async function create(data) {
  const zipcode = String(data.zipcode || "").trim();
  const existing = await findByZipcode(zipcode);
  if (existing) return update(existing.id, data);

  const id = crypto.randomUUID();
  const r = await pool.query(
    `INSERT INTO zip_codes (id, zipcode, city, county, state, tax, service_area, long_trip_required, long_trip_fee, distance_from_base, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10, now())
     RETURNING *`,
    [
      id, zipcode, data.city || "", data.county || "", data.state || "CA",
      data.tax ?? 0, data.serviceArea ?? true, data.longTripRequired ?? false,
      data.longTripFee ?? 0, data.distanceFromBase ?? 0,
    ]
  );
  return mapRow(r.rows[0]);
}

async function update(id, data) {
  const existing = await get(id);
  if (!existing) return null;
  const merged = {
    zipcode: data.zipcode ?? existing.zipcode,
    city: data.city ?? existing.city,
    county: data.county ?? existing.county,
    state: data.state ?? existing.state,
    tax: data.tax ?? existing.tax,
    serviceArea: data.serviceArea ?? existing.serviceArea,
    longTripRequired: data.longTripRequired ?? existing.longTripRequired,
    longTripFee: data.longTripFee ?? existing.longTripFee,
    distanceFromBase: data.distanceFromBase ?? existing.distanceFromBase,
  };
  const r = await pool.query(
    `UPDATE zip_codes SET zipcode = $2, city = $3, county = $4, state = $5, tax = $6,
       service_area = $7, long_trip_required = $8, long_trip_fee = $9, distance_from_base = $10,
       updated_at = now()
     WHERE id = $1
     RETURNING *`,
    [
      id, merged.zipcode, merged.city, merged.county, merged.state, merged.tax,
      merged.serviceArea, merged.longTripRequired, merged.longTripFee, merged.distanceFromBase,
    ]
  );
  return mapRow(r.rows[0]);
}

async function remove(id) {
  const r = await pool.query("DELETE FROM zip_codes WHERE id = $1", [id]);
  return r.rowCount > 0;
}

module.exports = { list, get, create, update, remove, findByZipcode };
