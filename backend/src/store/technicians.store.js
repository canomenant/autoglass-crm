const crypto = require("crypto");
const workordersStore = require("./workorders.store");
const pool = require("../config/db");
const { mapTechnician } = require("../lib/sqlMappers");
const { hashPassword } = require("../lib/password");

const STATUSES = ["Active", "Inactive"];

const SIN_TRABAJOS = { completedJobs: 0, openJobs: 0, revenueGenerated: 0, averageTicket: 0, lastWorkOrder: "" };

/* Las estadisticas de todos los tecnicos en una sola consulta.
 *
 * Antes cada ficha traia las 4,580 ordenes completas y las filtraba en memoria, asi que listar la
 * pagina de tecnicos hacia ese recorrido una vez por tecnico: 24 pasadas, casi 12 segundos. Es el
 * mismo conteo, hecho donde estan los datos.
 */
async function statsPorTecnico() {
  const r = await pool.query(
    `SELECT technician_id,
       count(*) FILTER (WHERE status = ANY($1))::int  AS completados,
       count(*) FILTER (WHERE NOT (status = ANY($1)) AND NOT (status = ANY($2)))::int AS abiertos,
       COALESCE(sum(total_sale) FILTER (WHERE status = ANY($1)), 0) AS ingreso,
       (ARRAY_AGG(work_order_no ORDER BY COALESCE(updated_at, created_at) DESC))[1] AS ultima
     FROM work_orders
     WHERE active <> false AND technician_id IS NOT NULL
     GROUP BY technician_id`,
    [workordersStore.COMPLETED_STATUSES, workordersStore.CLOSED_STATUSES]
  );
  const porId = new Map();
  for (const f of r.rows) {
    const ingreso = Number(f.ingreso) || 0;
    porId.set(f.technician_id, {
      completedJobs: f.completados,
      openJobs: f.abiertos,
      revenueGenerated: ingreso,
      averageTicket: f.completados ? ingreso / f.completados : 0,
      lastWorkOrder: f.ultima || "",
    });
  }
  return porId;
}

async function computeStats(id) {
  return (await statsPorTecnico()).get(id) || { ...SIN_TRABAJOS };
}

function sanitize(item) {
  if (!item) return item;
  // tokenVersion es estado interno de la sesión, no un campo del recurso: no forma parte de la
  // ficha del técnico y no tiene por qué salir por la API.
  const { password, tokenVersion, ...rest } = item;
  return rest;
}

async function withStats(item) {
  if (!item) return item;
  return { ...sanitize(item), stats: await computeStats(item.id) };
}

async function list() {
  const r = await pool.query("SELECT * FROM technicians WHERE active <> false ORDER BY created_at");
  // Una sola consulta de estadisticas para toda la lista, no una por ficha.
  const stats = await statsPorTecnico();
  return r.rows.map(mapTechnician).map((t) => ({ ...sanitize(t), stats: stats.get(t.id) || { ...SIN_TRABAJOS } }));
}

// technicians.id es uuid: si llega cualquier otra cosa, Postgres lanza "invalid input syntax for
// type uuid" en vez de no encontrar nada. Express 4 no encamina el rechazo de un handler async al
// manejador de errores, asi que eso no daba un 400 sino una peticion colgada sin respuesta. Un id
// mal formado no es un error del servidor, es un tecnico que no existe.
const ES_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function get(id) {
  if (!ES_UUID.test(String(id || ""))) return null;
  const r = await pool.query("SELECT * FROM technicians WHERE id = $1 AND active <> false", [id]);
  if (!r.rows[0]) return null;
  return withStats(mapTechnician(r.rows[0]));
}

async function findByEmail(email) {
  const r = await pool.query("SELECT * FROM technicians WHERE active <> false AND lower(email) = lower($1)", [email]);
  if (!r.rows[0]) return null;
  return mapTechnician(r.rows[0]);
}

// Lo mínimo que requireAuth necesita para decidir si un token sigue siendo válido, y nada más.
// Deliberadamente aparte de get(): ése pasa por withStats(), que hace un GROUP BY sobre las
// 4.580 órdenes de trabajo. Eso una vez por petición autenticada dejaría la API inservible.
// Esto es una búsqueda por clave primaria con dos columnas.
async function authState(id) {
  if (!ES_UUID.test(String(id || ""))) return null;
  const r = await pool.query(
    "SELECT status, token_version FROM technicians WHERE id = $1 AND active <> false",
    [id]
  );
  if (!r.rows[0]) return null;
  return { status: r.rows[0].status || "Active", tokenVersion: r.rows[0].token_version || 0 };
}

// taxId/driverLicense/insuranceExpiration/notes/photo/serviceAreas/languages/canReceiveSms/
// canReceiveLinks/calendarColor NO tenían columna (hueco de la Fase 4, arrastrado desde la
// migración a Postgres): se aceptaban aquí y se devolvían en la respuesta como si se hubieran
// guardado, pero desaparecían al recargar. Quien rellenaba el Tax ID veía "Técnico actualizado"
// y perdía el dato en silencio, que es la peor forma de fallar.
// Las columnas las crea scripts/add-technician-missing-columns.js.
function writeTechnicianToSql(item) {
  return pool.query(
    `INSERT INTO technicians (id, name, company_name, phone, mobile, email, password, must_change_password,
       address, city, state, zip_code, status, default_labor_rate, default_commission, active, token_version,
       tax_id, driver_license, insurance_expiration, notes, photo, service_areas, languages,
       can_receive_sms, can_receive_links, calendar_color)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27)
     ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, company_name = EXCLUDED.company_name,
       phone = EXCLUDED.phone, mobile = EXCLUDED.mobile, email = EXCLUDED.email, password = EXCLUDED.password,
       must_change_password = EXCLUDED.must_change_password,
       address = EXCLUDED.address, city = EXCLUDED.city, state = EXCLUDED.state, zip_code = EXCLUDED.zip_code,
       status = EXCLUDED.status, default_labor_rate = EXCLUDED.default_labor_rate,
       default_commission = EXCLUDED.default_commission, active = EXCLUDED.active,
       token_version = EXCLUDED.token_version,
       tax_id = EXCLUDED.tax_id, driver_license = EXCLUDED.driver_license,
       insurance_expiration = EXCLUDED.insurance_expiration, notes = EXCLUDED.notes,
       photo = EXCLUDED.photo, service_areas = EXCLUDED.service_areas, languages = EXCLUDED.languages,
       can_receive_sms = EXCLUDED.can_receive_sms, can_receive_links = EXCLUDED.can_receive_links,
       calendar_color = EXCLUDED.calendar_color`,
    [
      item.id, item.name || "", item.companyName || "", item.phone || "", item.mobile || "", item.email || "",
      item.password || "", item.mustChangePassword || false, item.address || "", item.city || "", item.state || "",
      item.zipCode || "", item.status || "Active", item.defaultLaborRate || 0, item.defaultCommission || 0,
      item.active !== false, item.tokenVersion || 0,
      item.taxId || "", item.driverLicense || "", item.insuranceExpiration || "", item.notes || "",
      item.photo ? JSON.stringify(item.photo) : null,
      JSON.stringify(Array.isArray(item.serviceAreas) ? item.serviceAreas : []),
      JSON.stringify(Array.isArray(item.languages) ? item.languages : []),
      item.canReceiveSms !== false, item.canReceiveLinks !== false,
      item.calendarColor || "#2563eb",
    ]
  );
}

async function create(data) {
  const item = {
    id: crypto.randomUUID(),
    name: data.name || "",
    companyName: data.companyName || "",
    phone: data.phone || "",
    mobile: data.mobile || "",
    email: data.email || "",
    password: data.password ? await hashPassword(data.password) : "",
    mustChangePassword: !!data.password,
    // Se incrementa al cambiar la contraseña; requireAuth compara este número con el que lleva
    // el token, de modo que los emitidos antes del cambio dejan de valer en el acto.
    tokenVersion: 0,
    address: data.address || "",
    city: data.city || "",
    state: data.state || "",
    zipCode: data.zipCode || "",
    taxId: data.taxId || "",
    driverLicense: data.driverLicense || "",
    insuranceExpiration: data.insuranceExpiration || "",
    notes: data.notes || "",
    photo: data.photo || null,
    status: STATUSES.includes(data.status) ? data.status : "Active",
    defaultLaborRate: data.defaultLaborRate ?? 0,
    defaultCommission: data.defaultCommission ?? 0,
    serviceAreas: Array.isArray(data.serviceAreas) ? data.serviceAreas : [],
    languages: Array.isArray(data.languages) ? data.languages : [],
    canReceiveSms: data.canReceiveSms ?? true,
    canReceiveLinks: data.canReceiveLinks ?? true,
    calendarColor: data.calendarColor || "#2563eb",
    active: true,
    deletedAt: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  await writeTechnicianToSql(item);
  return withStats(item);
}

async function update(id, data) {
  if (!ES_UUID.test(String(id || ""))) return null;
  const existing = await pool.query("SELECT * FROM technicians WHERE id = $1 AND active <> false", [id]);
  if (!existing.rows[0]) return null;
  const item = { ...mapTechnician(existing.rows[0]) };
  Object.assign(item, {
    name: data.name ?? item.name,
    companyName: data.companyName ?? item.companyName,
    phone: data.phone ?? item.phone,
    mobile: data.mobile ?? item.mobile,
    email: data.email ?? item.email,
    password: data.password ? await hashPassword(data.password) : item.password,
    mustChangePassword: data.mustChangePassword ?? item.mustChangePassword,
    tokenVersion: data.tokenVersion ?? item.tokenVersion ?? 0,
    address: data.address ?? item.address,
    city: data.city ?? item.city,
    state: data.state ?? item.state,
    zipCode: data.zipCode ?? item.zipCode,
    taxId: data.taxId ?? item.taxId,
    driverLicense: data.driverLicense ?? item.driverLicense,
    insuranceExpiration: data.insuranceExpiration ?? item.insuranceExpiration,
    notes: data.notes ?? item.notes,
    photo: data.photo !== undefined ? data.photo : item.photo,
    status: data.status && STATUSES.includes(data.status) ? data.status : item.status,
    defaultLaborRate: data.defaultLaborRate ?? item.defaultLaborRate,
    defaultCommission: data.defaultCommission ?? item.defaultCommission,
    serviceAreas: Array.isArray(data.serviceAreas) ? data.serviceAreas : item.serviceAreas,
    languages: Array.isArray(data.languages) ? data.languages : item.languages,
    canReceiveSms: data.canReceiveSms !== undefined ? data.canReceiveSms : item.canReceiveSms,
    canReceiveLinks: data.canReceiveLinks !== undefined ? data.canReceiveLinks : item.canReceiveLinks,
    calendarColor: data.calendarColor ?? item.calendarColor,
    updatedAt: new Date().toISOString(),
  });
  await writeTechnicianToSql(item);
  return withStats(item);
}

async function remove(id) {
  if (!ES_UUID.test(String(id || ""))) return false;
  const r = await pool.query("UPDATE technicians SET active = false WHERE id = $1 AND active <> false", [id]);
  return r.rowCount > 0;
}

module.exports = { STATUSES, list, get, create, update, remove, findByEmail, authState };
