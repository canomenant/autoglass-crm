// Verifies that the technician's mobile link is the only credential-free way to write to a work
// order, and that it is actually a credential.
//
//   cd backend && node scripts/verify-mobile-link-auth.js     (needs the API running on :4000)
//
// The hole this closes: PUT /api/workorders/:id used optionalAuth and, with no session, fell
// through to a branch that wrote status and techPhotos. The token was never checked, so the work
// order's id was the whole credential — and an id is not a secret. It appears in the dashboard URL,
// in API responses and in browser history.
//
// Everything here runs against a scratch work order created for the run and removed at the end.
require("dotenv").config();
const pool = require("../src/config/db");
const jwt = require("jsonwebtoken");

const API = "http://localhost:4000/api";
const adminToken = jwt.sign(
  { id: "user-1", email: "verify@local", name: "Verificacion", role: "ADMIN", entityId: 1 },
  process.env.JWT_SECRET,
  { expiresIn: "10m" }
);

let failures = 0;
function check(label, ok, detail) {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}`);
  if (!ok) {
    failures++;
    if (detail !== undefined) console.log("        " + JSON.stringify(detail).slice(0, 220));
  }
}

async function call(method, path, { auth = false, body } = {}) {
  const res = await fetch(API + path, {
    method,
    headers: { "Content-Type": "application/json", ...(auth ? { Authorization: `Bearer ${adminToken}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let payload = null;
  try {
    payload = await res.json();
  } catch {}
  return { status: res.status, body: payload };
}

(async () => {
  // Scratch order, so nothing real is touched.
  const src = (await pool.query("SELECT id FROM work_orders WHERE active <> false LIMIT 1")).rows[0];
  const scratchId = "00000000-0000-4000-8000-0000000000ff";
  await pool.query(
    `INSERT INTO work_orders (id, work_order_no, status, active, created_at, updated_at, tech, technician_id)
     VALUES ($1, 'Wo-VERIFY', 'Scheduled', true, now(), now(), 'Tecnico de Prueba', NULL)
     ON CONFLICT (id) DO UPDATE SET status = 'Scheduled', public_token = NULL, public_access_log = '[]'::jsonb`,
    [scratchId]
  );

  try {
    console.log("--- PUT /workorders/:id ya no acepta anonimos ---");
    let r = await call("PUT", `/workorders/${scratchId}`, { body: { status: "Completed" } });
    check("sin sesion -> 401", r.status === 401, r);
    const after = (await pool.query("SELECT status FROM work_orders WHERE id=$1", [scratchId])).rows[0];
    check("  y no escribio nada", after.status === "Scheduled", after);

    r = await call("PUT", `/workorders/${scratchId}`, { auth: true, body: { status: "Assigned" } });
    check("con sesion admin -> 200", r.status === 200, r.status);

    console.log("\n--- PUT /workorders/mobile/:token ---");
    r = await call("PUT", `/workorders/mobile/token-inventado-000000`, { body: { status: "Completed" } });
    check("token invalido -> 404", r.status === 404, r);

    // Un token real se genera por revocacion (que es tambien como se emite el primero).
    r = await call("POST", `/workorders/${scratchId}/mobile-link/regenerate`, { auth: true });
    check("regenerar token (admin) -> 200", r.status === 200, r);
    const token = r.body?.token;
    check("  devuelve un token de 20 caracteres", typeof token === "string" && token.length === 20, token);

    r = await call("POST", `/workorders/${scratchId}/mobile-link/regenerate`);
    check("regenerar sin sesion -> 401", r.status === 401, r.status);

    r = await call("PUT", `/workorders/mobile/${token}`, { body: { status: "In Progress" } });
    check("token correcto -> 200", r.status === 200, r.status);
    check("  aplico el cambio", r.body?.status === "In Progress", r.body?.status);

    console.log("\n--- solo status y techPhotos son escribibles ---");
    r = await call("PUT", `/workorders/mobile/${token}`, {
      body: { status: "Completed", totalSale: 999999, customerName: "Hackeado", commission: 500 },
    });
    check("acepto el status", r.body?.status === "Completed", r.body?.status);
    check("  ignoro totalSale", Number(r.body?.totalSale || 0) !== 999999, r.body?.totalSale);
    check("  ignoro customerName", r.body?.customerName !== "Hackeado", r.body?.customerName);
    check("  ignoro commission", Number(r.body?.commission || 0) !== 500, r.body?.commission);

    console.log("\n--- auditoria ---");
    const log = (await pool.query("SELECT public_access_log FROM work_orders WHERE id=$1", [scratchId])).rows[0].public_access_log;
    check("quedo registrado", Array.isArray(log) && log.length >= 3, log?.length);
    const viaLink = log.filter((e) => e.via === "mobile-link");
    check("  registra los cambios por link", viaLink.length === 2, viaLink.length);
    check("  guarda que cambio", viaLink[0]?.changes?.status?.to === "In Progress", viaLink[0]);
    check("  guarda a que tecnico se emitio", viaLink[0]?.issuedToTechnician === "Tecnico de Prueba", viaLink[0]);
    check("  registra la regeneracion del token", log.some((e) => e.via === "token-regenerated"), log);

    console.log("\n--- revocacion ---");
    const viejo = token;
    r = await call("POST", `/workorders/${scratchId}/mobile-link/regenerate`, { auth: true });
    const nuevo = r.body?.token;
    check("el token nuevo es distinto", nuevo && nuevo !== viejo);
    r = await call("PUT", `/workorders/mobile/${viejo}`, { body: { status: "Paid" } });
    check("  el token viejo deja de funcionar -> 404", r.status === 404, r.status);
    r = await call("PUT", `/workorders/mobile/${nuevo}`, { body: { status: "Paid" } });
    check("  el nuevo funciona -> 200", r.status === 200, r.status);
  } catch (err) {
    console.log("ERROR:", err.message);
    console.log(err.stack);
    failures++;
  } finally {
    await pool.query("DELETE FROM work_orders WHERE id = $1", [scratchId]);
    const left = (await pool.query("SELECT count(*) n FROM work_orders WHERE id = $1", [scratchId])).rows[0].n;
    check(`la orden de prueba quedo borrada (${left})`, Number(left) === 0);
    await pool.end();
  }

  console.log(failures ? `\n${failures} FALLARON` : "\ntodo OK");
  process.exit(failures ? 1 : 0);
})();
