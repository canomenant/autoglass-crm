// Exporta a CSV las 69 work orders que quedaron pendientes de criterio contable tras el import
// de AppSheet, para revisar en Excel.
//
//   cd backend && node scripts/export-69-wo-review.js
//
// Solo lee. Tres grupos:
//   GARANTIA    total_sale = 0 — se les asigno costo, posibles garantias o re-trabajos
//   BAJO_COSTO  total_sale > 0 pero por debajo del costo — posible ingreso de aseguranza sin registrar
//   CHARGEBACK  total_sale < 0 — excluidas del import, no se les asigno costo
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const pool = require("../src/config/db");

const DIR = path.join(__dirname, "..", "imports", "appsheet", "csv");
const OUT = path.join(__dirname, "..", "imports", "REVISAR_69_WO.csv");

function parseCSV(text) {
  const rows = []; let row = [], f = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
    else if (c === '"') q = true;
    else if (c === ",") { row.push(f); f = ""; }
    else if (c === "\n") { row.push(f); rows.push(row); row = []; f = ""; }
    else if (c !== "\r") f += c;
  }
  if (f || row.length) { row.push(f); rows.push(row); }
  const h = rows.shift().map((x) => x.trim());
  return rows.filter((r) => r.length > 1).map((r) => Object.fromEntries(h.map((k, i) => [k, (r[i] ?? "").trim()])));
}
const num = (v) => { const n = Number(String(v ?? "").replace(/[$,]/g, "")); return Number.isFinite(n) ? n : 0; };
const woNo = (l) => { const m = String(l ?? "").match(/^(Wo-\d+)/i); return m ? m[1] : null; };
// Excel abre CSV con comas; todo campo de texto va entrecomillado y con las comillas escapadas.
const csv = (v) => {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
};

(async () => {
  const det = parseCSV(fs.readFileSync(path.join(DIR, "BD_WORKORDER_DETAIL.csv"), "utf8"));

  const wos = (await pool.query(`
    SELECT w.work_order_no, w.appointment_date, w.created_at, w.customer_name, w.tech, w.state,
           w.total_sale, w.glass_cost, w.glass_cost_source, w.labor_cost, w.commission, w.internal_notes,
           (w.payment->>'amount')::numeric AS payment_amount,
           q.agent_name, q.line_items
      FROM work_orders w
      LEFT JOIN quotes q ON q.id = w.quote_id
     WHERE w.active <> false`)).rows;
  const porNo = new Map(wos.map((w) => [w.work_order_no, w]));

  // Costo que el export asigna a cada WO — para las CHARGEBACK es el que NO se importo.
  const costoExport = new Map();
  for (const d of det) {
    const k = woNo(d.WORKORDER_LABEL);
    if (!k || !porNo.has(k)) continue;
    costoExport.set(k, (costoExport.get(k) || 0) + num(d["Glass Cost"]));
  }

  const filas = [];
  for (const [k, costo] of costoExport) {
    if (Math.abs(costo) < 0.01) continue;
    const w = porNo.get(k);
    const venta = Number(w.total_sale || 0);
    const glass = Number(w.glass_cost || 0);

    // El marcador identifica exactamente las 59 a las que el import les asigno costo; las
    // negativas quedaron fuera y siguen con glass_cost en 0. Inferirlo por los montos dejaba
    // afuera las que venden por encima del costo, que tambien son parte de las 69 a revisar.
    const importada = w.glass_cost_source === "appsheet_import";
    let grupo = null;
    if (venta < 0) grupo = "CHARGEBACK";
    else if (importada && venta === 0) grupo = "GARANTIA";
    else if (importada && venta < glass) grupo = "BAJO_COSTO";
    else if (importada) grupo = "REVISADA_OK";   // venta >= costo: no es un problema, va para cerrar el set
    if (!grupo) continue;

    const li = (w.line_items || [])[0] || {};
    const costoMostrado = grupo === "CHARGEBACK" ? costo : glass;
    const pagado = Number(w.payment_amount || 0);
    filas.push({
      GRUPO: grupo,
      work_order_no: k,
      fecha: (w.appointment_date ? new Date(w.appointment_date) : new Date(w.created_at)).toISOString().slice(0, 10),
      cliente: w.customer_name || "",
      agente: w.agent_name || "",
      tecnico: w.tech || "",
      estado: w.state || "",
      job_type: li.jobType || "",
      part_number: li.partNumber || "",
      distributor: li.distributor || "",
      total_sale: venta.toFixed(2),
      payment_amount: pagado.toFixed(2),
      glass_cost: costoMostrado.toFixed(2),
      labor_cost: Number(w.labor_cost || 0).toFixed(2),
      commission: Number(w.commission || 0).toFixed(2),
      margen: (pagado - costoMostrado - Number(w.labor_cost || 0) - Number(w.commission || 0)).toFixed(2),
      notas: w.internal_notes || "",
    });
  }

  const orden = { GARANTIA: 0, BAJO_COSTO: 1, CHARGEBACK: 2, REVISADA_OK: 3 };
  filas.sort((a, b) => orden[a.GRUPO] - orden[b.GRUPO] || a.fecha.localeCompare(b.fecha));

  const cols = Object.keys(filas[0]);
  fs.writeFileSync(OUT, [cols.join(","), ...filas.map((f) => cols.map((c) => csv(f[c])).join(","))].join("\n") + "\n");

  const porGrupo = filas.reduce((a, f) => ((a[f.GRUPO] = (a[f.GRUPO] || 0) + 1), a), {});
  for (const g of ["GARANTIA", "BAJO_COSTO", "CHARGEBACK", "REVISADA_OK"]) console.log(`  ${g.padEnd(12)} ${porGrupo[g] || 0}`);
  console.log(`  TOTAL       ${filas.length}`);
  console.log(`\n  ${OUT}`);
  await pool.end();
})();
