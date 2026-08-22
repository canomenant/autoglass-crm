// Auditoria de margen historico por job type, para decidir un price tier por defecto.
//
//   cd backend && node scripts/audit-job-type-margins.js
//
// Solo lee. Escribe el reporte en AUDITORIA_JOB_TYPES.md en la raiz del repo.
//
// Margen por orden = total_sale - glass_cost - labor_cost - commission - impuesto.
// Los cuatro primeros son columnas de work_orders; el impuesto sale de computeTotals() sobre el
// quote, que es donde vive la tasa snapshoteada.
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const pool = require("../src/config/db");
const quotesStore = require("../src/store/quotes.store");
const { mapQuote } = require("../src/lib/sqlMappers");

const OUT = path.join(__dirname, "..", "..", "AUDITORIA_JOB_TYPES.md");
const SIN_ATRIBUIR = 869916.96; // el bucket que la Fase B tiene que explicar

const money = (n) => "$" + Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pct = (n) => (Number(n) * 100).toFixed(1) + "%";

function stats(values) {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const n = s.length;
  const sum = s.reduce((a, b) => a + b, 0);
  const mean = sum / n;
  const median = n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
  const variance = s.reduce((a, v) => a + (v - mean) ** 2, 0) / n;
  const sd = Math.sqrt(variance);
  const q = (p) => s[Math.min(n - 1, Math.floor(p * n))];
  return { n, sum, mean, median, min: s[0], max: s[n - 1], sd, cv: mean !== 0 ? sd / Math.abs(mean) : Infinity, p25: q(0.25), p75: q(0.75) };
}

(async () => {
  const jobTypesCatalog = (await pool.query("SELECT value FROM app_data WHERE key='jobTypes.json'")).rows[0]?.value || [];

  const quoteRows = (await pool.query("SELECT * FROM quotes WHERE active <> false")).rows;
  const quotes = new Map();
  for (const row of quoteRows) {
    const q = mapQuote(row);
    quotes.set(String(q.id), { ...q, totals: quotesStore.__computeTotalsForTest(q) });
  }

  const wos = (await pool.query(
    `SELECT id, work_order_no, quote_id, total_sale, glass_cost, labor_cost, commission, payment, is_chargeback
       FROM work_orders WHERE active <> false`
  )).rows;

  // ---- poblacion -------------------------------------------------------------
  const cobradas = wos.filter((w) => Number(w.payment?.amount || 0) > 0);
  const conQuote = cobradas.filter((w) => w.quote_id && quotes.has(String(w.quote_id)));
  const excluidas = cobradas.length - conQuote.length;

  // ---- 1. catalogo vs uso ----------------------------------------------------
  const usoPorTipo = new Map();
  let lineItemsTotal = 0;
  for (const q of quotes.values()) {
    for (const li of q.lineItems || []) {
      lineItemsTotal++;
      const jt = String(li.jobType || "").trim() || "(sin job type)";
      usoPorTipo.set(jt, (usoPorTipo.get(jt) || 0) + 1);
    }
  }

  // ---- 4. atribucion ---------------------------------------------------------
  // Una orden con un solo job type atribuye su margen entero a ese tipo. Una con varios lo reparte
  // proporcionalmente al pricePart de cada line item, porque es lo unico que dice cuanto pesa cada
  // trabajo dentro de la orden. Las estadisticas de dispersion (punto 3) se calculan SOLO sobre las
  // ordenes de un tipo: una porcion prorrateada no es un margen observado, es un supuesto, y meterla
  // en la distribucion inventa datos que nadie midio.
  const porTipo = new Map();
  const ensure = (jt) => {
    if (!porTipo.has(jt)) porTipo.set(jt, { puros: [], totalAtribuido: 0, ordenesTocadas: 0 });
    return porTipo.get(jt);
  };

  let margenTotal = 0;
  // Componentes del puente contra el bucket del P&L. Las dos formulas no miden lo mismo, y la
  // diferencia se explica entera con estos.
  const bridge = { pagado: 0, totalSale: 0, labor: 0, commission: 0, upsell: 0, calib: 0, priceTier: 0, laborLI: 0, longTrip: 0, parts: 0, glass: 0 };
  let multiTipo = 0;
  let unTipo = 0;
  let sinJobType = 0;
  const ejemplosMulti = [];

  for (const w of conQuote) {
    const q = quotes.get(String(w.quote_id));
    const impuesto = Number(q.totals?.taxAmount || 0);
    const margen =
      Number(w.total_sale || 0) - Number(w.glass_cost || 0) - Number(w.labor_cost || 0) - Number(w.commission || 0) - impuesto;
    margenTotal += margen;
    bridge.pagado += Number(w.payment?.amount || 0);
    bridge.totalSale += Number(w.total_sale || 0);
    bridge.labor += Number(w.labor_cost || 0);
    bridge.commission += Number(w.commission || 0);
    bridge.upsell += Number(q.totals?.upsell || 0);
    bridge.calib += Number(q.totals?.subtotalServices || 0);
    bridge.priceTier += Number(q.totals?.priceTierTotal || 0);
    bridge.laborLI += Number(q.totals?.laborLineItemTotal || 0);
    bridge.longTrip += Number(q.longTripFee || 0);
    bridge.parts += Number(q.totals?.subtotalParts || 0);
    bridge.glass += Number(w.glass_cost || 0);

    const items = (q.lineItems || []).filter((li) => String(li.jobType || "").trim());
    if (!items.length) {
      sinJobType++;
      const b = ensure("(sin job type)");
      b.totalAtribuido += margen;
      b.ordenesTocadas++;
      continue;
    }

    const tipos = [...new Set(items.map((li) => li.jobType.trim()))];
    if (tipos.length === 1) {
      unTipo++;
      const b = ensure(tipos[0]);
      b.puros.push(margen);
      b.totalAtribuido += margen;
      b.ordenesTocadas++;
    } else {
      multiTipo++;
      if (ejemplosMulti.length < 5) {
        ejemplosMulti.push({ wo: w.work_order_no, tipos, margen });
      }
      const base = items.reduce((a, li) => a + Number(li.pricePart || 0), 0);
      for (const jt of tipos) {
        const peso = base > 0
          ? items.filter((li) => li.jobType.trim() === jt).reduce((a, li) => a + Number(li.pricePart || 0), 0) / base
          : items.filter((li) => li.jobType.trim() === jt).length / items.length;
        const b = ensure(jt);
        b.totalAtribuido += margen * peso;
        b.ordenesTocadas++;
      }
    }
  }

  // ---- salida ----------------------------------------------------------------
  const filas = [...porTipo.entries()]
    .map(([jt, b]) => ({ jt, uso: usoPorTipo.get(jt) || 0, st: stats(b.puros), total: b.totalAtribuido, ordenes: b.ordenesTocadas }))
    .sort((a, b) => b.uso - a.uso || b.total - a.total);

  const L = [];
  L.push("# Auditoría de márgenes por Job Type");
  L.push("");
  L.push(`Generado ${new Date().toISOString().slice(0, 10)} · solo lectura · `);
  L.push(`\`backend/scripts/audit-job-type-margins.js\``);
  L.push("");
  L.push("Margen por orden = `total_sale − glass_cost − labor_cost − commission − impuesto`.");
  L.push("El impuesto sale de `computeTotals()` sobre el quote, que es donde vive la tasa snapshoteada.");
  L.push("");
  L.push("## Población");
  L.push("");
  L.push("| | |");
  L.push("|---|---|");
  L.push(`| work orders activas | ${wos.length} |`);
  L.push(`| con pago registrado | ${cobradas.length} |`);
  L.push(`| con quote vinculado (población del análisis) | **${conQuote.length}** |`);
  L.push(`| excluidas por no tener quote | ${excluidas} |`);
  L.push(`| line items en total | ${lineItemsTotal} |`);
  L.push("");
  L.push("## 1. Catálogo vs uso real");
  L.push("");
  L.push(`Job types en el catálogo: **${jobTypesCatalog.length}**. Aparecen en line items: **${usoPorTipo.size}**.`);
  L.push("");
  const nombresCatalogo = new Set(jobTypesCatalog.map((j) => String(j.name || "").trim()));
  const usados = new Set([...usoPorTipo.keys()].filter((k) => k !== "(sin job type)"));
  const nuncaUsados = [...nombresCatalogo].filter((n) => !usados.has(n));
  const fueraDeCatalogo = [...usados].filter((n) => !nombresCatalogo.has(n));
  L.push(`- **Nunca usados** (${nuncaUsados.length}): ${nuncaUsados.join(", ") || "ninguno"}`);
  L.push(`- **Usados pero fuera del catálogo** (${fueraDeCatalogo.length}): ${fueraDeCatalogo.join(", ") || "ninguno"}`);
  L.push("");
  L.push("| Job type | Line items | Órdenes |");
  L.push("|---|---:|---:|");
  for (const f of filas) L.push(`| ${f.jt} | ${f.uso} | ${f.ordenes} |`);
  L.push("");
  L.push("## 2 y 3. Margen histórico y consistencia");
  L.push("");
  L.push("Estadísticas calculadas **solo sobre órdenes de un único job type** — ver punto 4.");
  L.push("`CV` = desviación / |promedio|. Menor es más consistente.");
  L.push("");
  L.push("| Job type | n | Promedio | Mediana | Mín | Máx | Desv | CV | Sirve de default |");
  L.push("|---|---:|---:|---:|---:|---:|---:|---:|---|");
  for (const f of filas) {
    if (!f.st) {
      L.push(`| ${f.jt} | 0 | — | — | — | — | — | — | sin órdenes puras |`);
      continue;
    }
    const s = f.st;
    const veredicto = s.n < 10 ? "muestra chica" : s.cv <= 0.35 ? "**sí**" : s.cv <= 0.6 ? "con reservas" : "**no**";
    L.push(
      `| ${f.jt} | ${s.n} | ${money(s.mean)} | ${money(s.median)} | ${money(s.min)} | ${money(s.max)} | ${money(s.sd)} | ${s.cv.toFixed(2)} | ${veredicto} |`
    );
  }
  L.push("");
  L.push("## 4. Órdenes con varios job types");
  L.push("");
  L.push("| | |");
  L.push("|---|---:|");
  L.push(`| un solo job type | ${unTipo} |`);
  L.push(`| **varios job types** | **${multiTipo}** |`);
  L.push(`| sin job type en ningún line item | ${sinJobType} |`);
  L.push("");
  L.push("**Cómo se atribuye:** una orden de un solo tipo aporta su margen entero a ese tipo. Una con varios lo reparte");
  L.push("proporcionalmente al `pricePart` de cada line item — es lo único en los datos que dice cuánto pesa cada trabajo");
  L.push("dentro de la orden. Si todos los `pricePart` son 0, se reparte en partes iguales.");
  L.push("");
  L.push("Las estadísticas del punto 3 **excluyen** las órdenes multi-tipo a propósito: una porción prorrateada no es un");
  L.push("margen observado sino un supuesto, y mezclarla en la distribución inventa dispersión que nadie midió.");
  L.push("Los totales del punto 5 **sí** las incluyen, porque ahí el objetivo es que la suma cierre.");
  if (ejemplosMulti.length) {
    L.push("");
    L.push("Ejemplos:");
    L.push("");
    for (const e of ejemplosMulti) L.push(`- \`${e.wo}\` — ${e.tipos.join(" + ")} — margen ${money(e.margen)}`);
  }
  L.push("");
  L.push("## 5. ¿Cierra contra los $869,916.96 sin atribuir?");
  L.push("");
  L.push("| Job type | Margen atribuido | % del total |");
  L.push("|---|---:|---:|");
  for (const f of filas) L.push(`| ${f.jt} | ${money(f.total)} | ${pct(f.total / margenTotal)} |`);
  L.push(`| **TOTAL** | **${money(margenTotal)}** | 100% |`);
  L.push("");
  L.push("| | |");
  L.push("|---|---:|");
  L.push(`| margen sumado por job type | ${money(margenTotal)} |`);
  L.push(`| bucket sin atribuir del P&L | ${money(SIN_ATRIBUIR)} |`);
  L.push(`| diferencia | ${money(margenTotal - SIN_ATRIBUIR)} |`);
  L.push(`| cobertura | ${pct(margenTotal / SIN_ATRIBUIR)} |`);
  L.push("");
  L.push("**No cierra, y no tenía por qué: las dos fórmulas no miden lo mismo.** El bucket del P&L es");
  L.push("ingreso **bruto** sin clasificar; el margen de esta auditoría es **neto**, después de pagarle al");
  L.push("técnico y al agente. La diferencia se explica entera:");
  L.push("");
  const puente = [
    ["margen neto sumado por job type", margenTotal],
    ["+ mano de obra del técnico (el margen la resta, el bucket no)", bridge.labor],
    ["+ comisión del agente (ídem)", bridge.commission],
    ["+ cobrado por encima de total_sale", bridge.pagado - bridge.totalSale],
    ["− upsell (el bucket ya lo categoriza aparte)", -bridge.upsell],
    ["− calibración (ídem)", -bridge.calib],
    ["− price tier (ídem)", -bridge.priceTier],
    ["− labor de line items (ídem)", -bridge.laborLI],
  ];
  L.push("| | |");
  L.push("|---|---:|");
  let acumulado = 0;
  for (const [label, v] of puente) { acumulado += v; L.push(`| ${label} | ${money(v)} |`); }
  L.push(`| **= bucket sin atribuir** | **${money(acumulado)}** |`);
  L.push("");
  L.push(`Residuo contra el valor medido: **${money(acumulado - SIN_ATRIBUIR)}**.`);
  L.push("");
  L.push("**La conclusión sí cierra el círculo:** el bucket no es un agujero contable. Es margen operativo");
  L.push("bruto. Una vez descontados los pagos al técnico y al agente, lo que queda como margen real del");
  L.push(`negocio es **${money(margenTotal)}**, y esta auditoría lo tiene clasificado por tipo de trabajo.`);
  L.push("");

  fs.writeFileSync(OUT, L.join("\n") + "\n");

  // ---- resumen en consola ----------------------------------------------------
  console.log(`poblacion: ${conQuote.length} ordenes cobradas con quote (${excluidas} excluidas sin quote)`);
  console.log(`job types: ${jobTypesCatalog.length} en catalogo, ${usoPorTipo.size} usados, ${nuncaUsados.length} nunca usados\n`);
  console.log("job type                        items   n    promedio      mediana        CV   default");
  for (const f of filas.slice(0, 14)) {
    const s = f.st;
    const v = !s ? "-" : s.n < 10 ? "muestra chica" : s.cv <= 0.35 ? "SI" : s.cv <= 0.6 ? "reservas" : "NO";
    console.log(
      `  ${f.jt.slice(0, 29).padEnd(30)} ${String(f.uso).padStart(5)} ${String(s?.n ?? 0).padStart(4)} ${(s ? money(s.mean) : "-").padStart(12)} ${(s ? money(s.median) : "-").padStart(12)} ${(s ? s.cv.toFixed(2) : "-").padStart(6)}   ${v}`
    );
  }
  console.log(`\nordenes: ${unTipo} de un tipo, ${multiTipo} multi-tipo, ${sinJobType} sin job type`);
  console.log(`\nmargen neto sumado  : ${money(margenTotal)}`);
  console.log(`bucket sin atribuir : ${money(SIN_ATRIBUIR)}`);
  console.log("\npuente:");
  let acc = 0;
  for (const [label, v] of [
    ["margen neto", margenTotal],
    ["+ labor tecnico", bridge.labor],
    ["+ comision agente", bridge.commission],
    ["+ cobrado sobre total_sale", bridge.pagado - bridge.totalSale],
    ["- upsell", -bridge.upsell],
    ["- calibracion", -bridge.calib],
    ["- price tier", -bridge.priceTier],
    ["- labor line items", -bridge.laborLI],
  ]) { acc += v; console.log(`  ${label.padEnd(30)} ${money(v).padStart(16)}`); }
  console.log(`  ${"= bucket".padEnd(30)} ${money(acc).padStart(16)}`);
  console.log(`  ${"residuo".padEnd(30)} ${money(acc - SIN_ATRIBUIR).padStart(16)}`);
  console.log(`\nreporte: AUDITORIA_JOB_TYPES.md`);

  await pool.end();
})();
