// FASE 1 del import de AppSheet: analisis, solo lectura. No escribe una sola fila.
//
//   cd backend && node scripts/analyze-appsheet-import.js
//
// Lee backend/imports/appsheet/csv/ (gitignoreado) y escribe los hallazgos en
// ANALISIS_IMPORT_APPSHEET.md, en la raiz del repo.
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const pool = require("../src/config/db");

const DIR = path.join(__dirname, "..", "imports", "appsheet", "csv");
const OUT = path.join(__dirname, "..", "..", "ANALISIS_IMPORT_APPSHEET.md");

function parseCSV(text) {
  const rows = [];
  let row = [], field = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else q = false; } else field += c; }
    else if (c === '"') q = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else if (c !== "\r") field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  const h = rows.shift().map((x) => x.trim());
  return rows.filter((r) => r.length > 1).map((r) => Object.fromEntries(h.map((k, i) => [k, (r[i] ?? "").trim()])));
}

const num = (v) => { const n = Number(String(v ?? "").replace(/[$,]/g, "").trim()); return Number.isFinite(n) ? n : 0; };
const m = (n) => "$" + Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
// Misma normalizacion que usa el catalogo de part numbers.
const normPart = (v) => String(v ?? "").toLowerCase().replace(/[ \t\r\n\-._/]+/g, "");
const woNo = (label) => { const m2 = String(label ?? "").match(/^(Wo-\d+)/i); return m2 ? m2[1] : null; };

(async () => {
  const det = parseCSV(fs.readFileSync(path.join(DIR, "BD_WORKORDER_DETAIL.csv"), "utf8"));
  const tech = parseCSV(fs.readFileSync(path.join(DIR, "BD_TECHWO.csv"), "utf8"));
  const agent = parseCSV(fs.readFileSync(path.join(DIR, "BD_AGENTCOMISSIONWO.csv"), "utf8"));

  const wos = (await pool.query(
    "SELECT id, work_order_no, quote_id, glass_cost, labor_cost, commission, total_sale FROM work_orders WHERE active <> false"
  )).rows;
  const porNo = new Map(wos.map((w) => [w.work_order_no, w]));

  const quotes = new Map();
  for (const r of (await pool.query("SELECT id, line_items FROM quotes WHERE active <> false")).rows) {
    quotes.set(String(r.id), r.line_items || []);
  }

  const L = [];
  const say = (s = "") => { L.push(s); console.log(s.replace(/\*\*/g, "")); };

  say("# Análisis del import de AppSheet — Fase 1");
  say("");
  say(`Generado ${new Date().toISOString().slice(0, 10)} · **solo lectura, no se escribió nada**`);
  say("`backend/scripts/analyze-appsheet-import.js`");
  say("");

  // ---------- 1. cobertura del enlace ----------
  say("## 1. Cobertura del enlace");
  say("");
  const conLabel = det.filter((d) => woNo(d.WORKORDER_LABEL));
  const sinLabel = det.filter((d) => !woNo(d.WORKORDER_LABEL));
  const resuelven = conLabel.filter((d) => porNo.has(woNo(d.WORKORDER_LABEL)));
  const noResuelven = conLabel.filter((d) => !porNo.has(woNo(d.WORKORDER_LABEL)));
  const wosTocadas = new Set(resuelven.map((d) => woNo(d.WORKORDER_LABEL)));

  say("| | |");
  say("|---|---:|");
  say(`| líneas de detalle | ${det.length} |`);
  say(`| con \`WORKORDER_LABEL\` en formato Wo-#### | ${conLabel.length} |`);
  say(`| **resuelven a una work order existente** | **${resuelven.length}** (${((resuelven.length / det.length) * 100).toFixed(1)}%) |`);
  say(`| con label pero sin work order en la base | ${noResuelven.length} |`);
  say(`| **huérfanas (label vacío)** | **${sinLabel.length}** |`);
  say(`| work orders distintas alcanzadas | ${wosTocadas.size} de ${wos.length} |`);
  say("");
  if (noResuelven.length) {
    const nos = [...new Set(noResuelven.map((d) => woNo(d.WORKORDER_LABEL)))];
    say(`Work orders del export que no existen acá (${nos.length}): ${nos.slice(0, 15).join(", ")}${nos.length > 15 ? " …" : ""}`);
    say("");
  }

  // ---------- 2. completar vs crear ----------
  say("## 2. Líneas a completar vs a crear");
  say("");
  let completar = 0, crear = 0, sinQuote = 0;
  const camposAllenar = { calibrationType: 0, priceTier: 0, pricePart: 0, distributor: 0, orderNumber: 0, jobType: 0, partNumber: 0, nagsDescription: 0 };
  const yaConDato = { calibrationType: 0, priceTier: 0, pricePart: 0, distributor: 0, orderNumber: 0 };

  for (const d of resuelven) {
    const w = porNo.get(woNo(d.WORKORDER_LABEL));
    const items = w.quote_id ? quotes.get(String(w.quote_id)) : null;
    if (!items) { sinQuote++; crear++; continue; }
    const pn = normPart(d.PARTNUMBER_LABEL);
    const match = pn ? items.find((li) => normPart(li.partNumber) === pn) : null;
    if (!match) { crear++; continue; }
    completar++;
    const vacio = (v) => !String(v ?? "").trim() || Number(v) === 0;
    if (vacio(match.calibrationType) && d.CALIBRATION_LABEL) camposAllenar.calibrationType++; else if (!vacio(match.calibrationType)) yaConDato.calibrationType++;
    if (vacio(match.priceTier) && d.PRICETIER_LABEL) camposAllenar.priceTier++; else if (!vacio(match.priceTier)) yaConDato.priceTier++;
    if (vacio(match.pricePart) && num(d["Glass Cost"])) camposAllenar.pricePart++; else if (!vacio(match.pricePart)) yaConDato.pricePart++;
    if (vacio(match.distributor) && d.DISTRIBUTOR_LABEL) camposAllenar.distributor++; else if (!vacio(match.distributor)) yaConDato.distributor++;
    if (vacio(match.orderNumber) && d["Order Number"]) camposAllenar.orderNumber++; else if (!vacio(match.orderNumber)) yaConDato.orderNumber++;
  }
  say("| | |");
  say("|---|---:|");
  say(`| **completar** una línea existente (match por part number) | **${completar}** |`);
  say(`| **crear** línea nueva | **${crear}** |`);
  say(`| de esas, work orders sin quote vinculado | ${sinQuote} |`);
  say("");
  say("De las que se completan, campos que hoy están vacíos y el export puede llenar:");
  say("");
  say("| Campo | A llenar | Ya tienen dato (no se tocan) |");
  say("|---|---:|---:|");
  for (const k of Object.keys(yaConDato)) say(`| ${k} | ${camposAllenar[k]} | ${yaConDato[k]} |`);
  say("");

  // ---------- A. Glass Cost ----------
  say("## A. `Glass Cost` vs `pricePart`");
  say("");
  const glassTotal = resuelven.reduce((a, d) => a + num(d["Glass Cost"]), 0);
  const glassTodas = det.reduce((a, d) => a + num(d["Glass Cost"]), 0);
  const glassActual = wos.reduce((a, w) => a + Number(w.glass_cost || 0), 0);
  say("| | |");
  say("|---|---:|");
  say(`| \`Glass Cost\` todas las líneas | ${m(glassTodas)} |`);
  say(`| \`Glass Cost\` solo líneas que resuelven | ${m(glassTotal)} |`);
  say(`| \`glass_cost\` actual en work_orders | ${m(glassActual)} |`);
  say(`| diferencia | ${m(glassTotal - glassActual)} |`);
  say("");
  const porTipoParte = new Map();
  for (const d of det) {
    const t = d["TYPE PART"] || "(vacío)";
    if (!porTipoParte.has(t)) porTipoParte.set(t, { n: 0, glass: 0 });
    const b = porTipoParte.get(t); b.n++; b.glass += num(d["Glass Cost"]);
  }
  say("| TYPE PART | Líneas | `Glass Cost` |");
  say("|---|---:|---:|");
  for (const [t, b] of [...porTipoParte].sort((a, b) => b[1].n - a[1].n)) say(`| ${t} | ${b.n} | ${m(b.glass)} |`);
  say("");

  // ---------- reconciliacion por WO ----------
  say("## Reconciliación: `Glass Cost` por WO vs `glass_cost` actual");
  say("");
  const porWo = new Map();
  for (const d of resuelven) {
    const k = woNo(d.WORKORDER_LABEL);
    porWo.set(k, (porWo.get(k) || 0) + num(d["Glass Cost"]));
  }
  const desajustes = [];
  for (const [k, suma] of porWo) {
    const w = porNo.get(k);
    const actual = Number(w.glass_cost || 0);
    if (Math.abs(suma - actual) >= 0.01) desajustes.push({ wo: k, export: suma, actual, dif: suma - actual });
  }
  desajustes.sort((a, b) => Math.abs(b.dif) - Math.abs(a.dif));
  say(`Work orders comparadas: **${porWo.size}** · **cuadran exacto: ${porWo.size - desajustes.length}** · no cuadran: **${desajustes.length}**`);
  say("");
  if (desajustes.length) {
    say("Las 15 mayores diferencias (no se corrigen, solo se listan):");
    say("");
    say("| WO | Export | Actual | Diferencia |");
    say("|---|---:|---:|---:|");
    for (const d of desajustes.slice(0, 15)) say(`| ${d.wo} | ${m(d.export)} | ${m(d.actual)} | ${m(d.dif)} |`);
    say("");
    say(`Suma de todas las diferencias: **${m(desajustes.reduce((a, b) => a + b.dif, 0))}**`);
    say("");
  }

  // ---------- B. campos sin destino ----------
  say("## B. Campos sin destino en el esquema actual");
  say("");
  const tot = (f) => resuelven.reduce((a, d) => a + num(d[f]), 0);
  say("| Campo del export | Suma (líneas que resuelven) | Destino |");
  say("|---|---:|---|");
  say(`| \`AMOUNT\` (monto del price tier) | ${m(tot("AMOUNT"))} | **no existe** |`);
  say(`| \`TOTAL_LABOR\` (cobrado al cliente) | ${m(tot("TOTAL_LABOR"))} | **no existe** — distinto del pagado al técnico |`);
  say(`| \`SERVICES_AMOUNT\` | ${m(tot("SERVICES_AMOUNT"))} | **no existe** |`);
  say(`| \`AMOUNT_CALIBRATION_TYPE\` | ${m(tot("AMOUNT_CALIBRATION_TYPE"))} | **no existe** (hay \`calibrationType\`, sin monto) |`);
  say("");

  // ---------- C. NAGS ----------
  say("## C. Campos NAGS — excluidos");
  say("");
  say("| Campo | Con dato | % |");
  say("|---|---:|---:|");
  for (const f of ["List Price", "Nags Discount Rate", "Amount List Price", "Nags Labour Hour", "Price for hour", "Total Labor Hour"]) {
    const c = det.filter((d) => { const v = String(d[f] ?? "").trim(); return v && v !== "NULL" && num(v) !== 0; }).length;
    say(`| \`${f}\` | ${c} de ${det.length} | ${((c / det.length) * 100).toFixed(1)}% |`);
  }
  say("");

  // ---------- D. huerfanas ----------
  say("## D. Huérfanas");
  say("");
  say(`Líneas de detalle sin \`WORKORDER_LABEL\`: **${sinLabel.length}**. Aportan ${m(sinLabel.reduce((a, d) => a + num(d["Glass Cost"]), 0))} de \`Glass Cost\`.`);
  say("");
  const sinLineas = [...porNo.keys()].filter((k) => !wosTocadas.has(k));
  say(`Work orders de la base sin ninguna línea en el export: **${sinLineas.length}**.`);
  say("");
  say(`Primeras 20: ${sinLineas.slice(0, 20).join(", ")}`);
  say("");

  // ---------- tech y agent ----------
  say("## Labor de técnicos y comisiones de agentes");
  say("");
  const techTotal = tech.reduce((a, r) => a + num(r.LABOR), 0);
  const agentCol = Object.keys(agent[0]).find((k) => /TOTAL.*PAY/i.test(k));
  const agentTotal = agent.reduce((a, r) => a + num(r[agentCol]), 0);
  const laborActual = wos.reduce((a, w) => a + Number(w.labor_cost || 0), 0);
  const commActual = wos.reduce((a, w) => a + Number(w.commission || 0), 0);
  say("| | Export | Sistema actual | Diferencia |");
  say("|---|---:|---:|---:|");
  say(`| Labor a técnicos | ${m(techTotal)} | ${m(laborActual)} | ${m(techTotal - laborActual)} |`);
  say(`| Comisión a agentes | ${m(agentTotal)} | ${m(commActual)} | ${m(agentTotal - commActual)} |`);
  say("");
  const techRes = tech.filter((r) => porNo.has(woNo(r.WORKORDER_LABEL))).length;
  const agentRes = agent.filter((r) => porNo.has(woNo(r.WORKORDER_LABEL))).length;
  say(`Filas que resuelven a una WO: técnicos **${techRes} de ${tech.length}**, agentes **${agentRes} de ${agent.length}**.`);
  say("");
  const techPorWo = new Map();
  for (const r of tech) { const k = woNo(r.WORKORDER_LABEL); if (k) techPorWo.set(k, (techPorWo.get(k) || 0) + 1); }
  const multiTech = [...techPorWo.values()].filter((n) => n > 1).length;
  say(`Work orders con más de un técnico: **${multiTech}** — por eso el detalle necesita tabla propia, no un campo en la cabecera.`);
  say("");

  fs.writeFileSync(OUT, L.join("\n") + "\n");
  console.log(`\nreporte: ANALISIS_IMPORT_APPSHEET.md`);
  await pool.end();
})();
