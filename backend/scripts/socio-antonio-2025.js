require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
// Antonio Cano como socio (7-sep-2026): $25 por cada orden PAGADA de 2025, Personal o aseguranza,
// con ganancia bruta mayor a $25 y donde el técnico no sea Antonio Cano. Solo 2025.
//   node scripts/socio-antonio-2025.js          -> reporte
//   node scripts/socio-antonio-2025.js --apply  -> da de alta al socio y la configuración en app_data y genera las distribuciones
const pool = require("../src/config/db");
const APPLY = process.argv.includes("--apply");
const m = (n) => Math.round(Number(n || 0) * 100) / 100;
(async () => {
  // 1) socio y configuración (app_data es lo que lee el servidor; el archivo local solo es respaldo)
  const partners = (await pool.query("SELECT value FROM app_data WHERE key='businessPartners.json'")).rows[0]?.value || [];
  let socio = partners.find((p) => /antonio cano/i.test(p.name));
  if (!socio) socio = { id: (partners.reduce((mx, p) => Math.max(mx, Number(p.id) || 0), 0) + 1), name: "Antonio Cano", active: true, rates: [] };
  Object.assign(socio, { flatRate: 25, minGrossProfit: 25, excludeTechnicianName: "Antonio Cano", active: true });
  if (!partners.includes(socio)) partners.push(socio);
  const settings = { startDate: "2025-01-01", endDate: null }; // 2026 también (Antonio, 7-sep-2026)
  if (APPLY) {
    await pool.query("INSERT INTO app_data (key, value, updated_at) VALUES ('businessPartners.json', $1::jsonb, now()) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()", [JSON.stringify(partners)]);
    await pool.query("INSERT INTO app_data (key, value, updated_at) VALUES ('partnerDistributionSettings.json', $1::jsonb, now()) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()", [JSON.stringify(settings)]);
  }
  // 2) los stores en este proceso: mismos datos
  const bp = require("../src/store/businessPartners.store"); const st = require("../src/store/partnerDistributionSettings.store");
  bp.list().length = 0; bp.list().push(...partners); st.update(settings);
  const dist = require("../src/store/partnerDistributions.store");
  const ws = require("../src/store/workorders.store");
  const all = await ws.list();
  const wos = all.filter((w) => w.status !== "Cancelled" && w.payment?.paid && ["2025","2026"].includes(String(w.appointmentDate || "").slice(0, 4)));
  let crear = 0, quitar = 0, total = 0; const porTecnico = {}; const porMes = {};
  for (const w of wos) {
    const changes = await dist.syncForWorkOrder(w, { dryRun: !APPLY });
    for (const c of changes) {
      if (c.action === "crear") { crear++; total += c.amount; const k = w.tech || "(sin técnico)"; porTecnico[k] = (porTecnico[k] || 0) + 1; const mes = dist.paymentDateOf(w).toISOString().slice(0, 7); porMes[mes] = (porMes[mes] || 0) + c.amount; }
      if (c.action === "quitar") quitar++;
    }
  }
  console.log(`órdenes pagadas 2025 revisadas: ${wos.length} | distribuciones a crear: ${crear} ($${m(total)}) | a quitar: ${quitar}`);
  console.log("por técnico:", Object.entries(porTecnico).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(" | "));
  console.log("por mes de cobro:", Object.entries(porMes).sort().map(([k, v]) => `${k} $${m(v)}`).join(" | "));
  if (APPLY) { const r = (await pool.query("SELECT count(*)::int n, sum(amount)::float s FROM partner_distributions WHERE partner_name='Antonio Cano'")).rows[0]; console.log("en la base:", r.n, "distribuciones, $" + m(r.s)); }
  await pool.end(); process.exit(0);
})().catch((e) => { console.error(e.stack); process.exit(1); });
