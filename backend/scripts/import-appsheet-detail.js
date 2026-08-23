// FASE 2/3 del import de AppSheet.
//
//   cd backend && node scripts/import-appsheet-detail.js          # dry-run, ROLLBACK al final
//   cd backend && node scripts/import-appsheet-detail.js --apply  # commit real
//
// Regla de oro: agrega COMPOSICION, nunca MONTOS. La unica cabecera que se toca es glass_cost en
// las 59 work orders que hoy lo tienen en 0 y tienen total_sale >= 0; las 10 con total_sale negativo
// quedan fuera a proposito (posibles chargebacks, pendiente criterio contable).
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const pool = require("./../src/config/db");

const DIR = path.join(__dirname, "..", "imports", "appsheet", "csv");
const OUT = path.join(__dirname, "..", "..", "ANALISIS_IMPORT_APPSHEET.md");
const APPLY = process.argv.includes("--apply");
const SOURCE = "appsheet_import";

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
const money = (n) => "$" + Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const normPart = (v) => String(v ?? "").toLowerCase().replace(/[ \t\r\n\-._/]+/g, "");
const woNo = (l) => { const m = String(l ?? "").match(/^(Wo-\d+)/i); return m ? m[1] : null; };
const vacio = (v) => v === undefined || v === null || String(v).trim() === "" || Number(v) === 0;
// AppSheet exporta las fechas como serial de Excel ("46011"), no como texto. Todo lo que no sea
// un serial o una fecha reconocible entra como NULL: una fecha inventada seria peor que ninguna.
const fecha = (v) => {
  const s = String(v ?? "").trim();
  if (!s) return null;
  if (/^\d+$/.test(s)) {
    const d = new Date(Date.UTC(1899, 11, 30) + Number(s) * 86400000);
    return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
  }
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
};

(async () => {
  const det = parseCSV(fs.readFileSync(path.join(DIR, "BD_WORKORDER_DETAIL.csv"), "utf8"));
  const tech = parseCSV(fs.readFileSync(path.join(DIR, "BD_TECHWO.csv"), "utf8"));
  const agent = parseCSV(fs.readFileSync(path.join(DIR, "BD_AGENTCOMISSIONWO.csv"), "utf8"));

  const client = await pool.connect();
  const totales = async () => {
    const r = await client.query(`SELECT
        COALESCE(SUM((payment->>'amount')::numeric),0) pagado,
        COALESCE(SUM(labor_cost),0) labor, COALESCE(SUM(commission),0) comision,
        COALESCE(SUM(glass_cost),0) glass, COALESCE(SUM(total_sale),0) venta
      FROM work_orders WHERE active <> false`);
    return r.rows[0];
  };

  const salida = [];
  const log = (s) => { salida.push(s); console.log(s); };

  try {
    await client.query("BEGIN");
    const antes = await totales();

    // Columnas y tablas nuevas. En dry-run el ROLLBACK las deshace.
    await client.query("ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS glass_cost_source TEXT");
    await client.query(`CREATE TABLE IF NOT EXISTS work_order_tech_labor (
      id BIGSERIAL PRIMARY KEY, work_order_no TEXT NOT NULL, technician TEXT, labor NUMERIC(12,2) DEFAULT 0,
      cash NUMERIC(12,2) DEFAULT 0, work_date DATE, status TEXT, source TEXT, external_id TEXT UNIQUE)`);
    await client.query(`CREATE TABLE IF NOT EXISTS work_order_agent_commission (
      id BIGSERIAL PRIMARY KEY, work_order_no TEXT NOT NULL, agent TEXT, company TEXT,
      aftermarket NUMERIC(12,2) DEFAULT 0, recommended NUMERIC(12,2) DEFAULT 0, oem NUMERIC(12,2) DEFAULT 0,
      services NUMERIC(12,2) DEFAULT 0, insurance NUMERIC(12,2) DEFAULT 0, total_pay NUMERIC(12,2) DEFAULT 0,
      work_date DATE, status TEXT, source TEXT, external_id TEXT UNIQUE)`);

    const wos = (await client.query("SELECT work_order_no, quote_id, glass_cost, total_sale FROM work_orders WHERE active <> false")).rows;
    const porNo = new Map(wos.map((w) => [w.work_order_no, w]));

    // ---- lineas ----
    const porQuote = new Map();
    let completadas = 0, creadas = 0, camposLlenados = 0, omitidasSinQuote = 0;
    for (const d of det) {
      const k = woNo(d.WORKORDER_LABEL);
      if (!k || !porNo.has(k)) continue;              // huerfanas y no resueltas: se omiten
      const w = porNo.get(k);
      if (!w.quote_id) { omitidasSinQuote++; continue; }
      if (!porQuote.has(String(w.quote_id))) {
        const q = await client.query("SELECT line_items FROM quotes WHERE id = $1", [w.quote_id]);
        porQuote.set(String(w.quote_id), q.rows[0]?.line_items || []);
      }
      const items = porQuote.get(String(w.quote_id));
      const pn = normPart(d.PARTNUMBER_LABEL);
      const match = pn ? items.find((li) => normPart(li.partNumber) === pn) : null;

      // Campos nuevos: se guardan y se muestran, no entran en ningun calculo.
      const extra = {
        priceTierAmount: num(d.AMOUNT),
        laborCharged: num(d.TOTAL_LABOR),
        servicesAmount: num(d.SERVICES_AMOUNT),
        servicesDescription: d.SERVICES_DESCRIPTION || "",
        calibrationAmount: num(d.AMOUNT_CALIBRATION_TYPE),
      };

      if (match) {
        completadas++;
        // Solo lo vacio. Nunca pisar un valor que ya tiene dato.
        for (const [campo, valor] of [
          ["jobType", d.JOBTYPE_LABEL], ["partNumber", d.PARTNUMBER_LABEL],
          ["nagsDescription", d["NAGS DESCRIPTION"]], ["calibrationType", d.CALIBRATION_LABEL],
          ["priceTier", d.PRICETIER_LABEL], ["distributor", d.DISTRIBUTOR_LABEL],
          ["orderNumber", d["Order Number"]],
        ]) { if (vacio(match[campo]) && String(valor || "").trim()) { match[campo] = valor; camposLlenados++; } }
        if (vacio(match.pricePart) && num(d["Glass Cost"])) { match.pricePart = num(d["Glass Cost"]); camposLlenados++; }
        Object.assign(match, extra, { source: SOURCE });
      } else {
        creadas++;
        items.push({
          id: require("crypto").randomUUID(), jobType: d.JOBTYPE_LABEL || "", partNumber: d.PARTNUMBER_LABEL || "",
          nagsDescription: d["NAGS DESCRIPTION"] || "", calibrationType: d.CALIBRATION_LABEL || "",
          priceTier: d.PRICETIER_LABEL || "", pricePart: num(d["Glass Cost"]),
          distributor: d.DISTRIBUTOR_LABEL || "", orderNumber: d["Order Number"] || "",
          isTaxable: true, ...extra, source: SOURCE,
        });
      }
    }
    for (const [qid, items] of porQuote) {
      await client.query("UPDATE quotes SET line_items = $2::jsonb WHERE id = $1", [qid, JSON.stringify(items)]);
    }

    // ---- glass_cost en las 60 ----
    const sumaPorWo = new Map();
    for (const d of det) {
      const k = woNo(d.WORKORDER_LABEL);
      if (!k || !porNo.has(k)) continue;
      sumaPorWo.set(k, (sumaPorWo.get(k) || 0) + num(d["Glass Cost"]));
    }
    const candidatas = [], excluidasNeg = [];
    for (const [k, suma] of sumaPorWo) {
      const w = porNo.get(k);
      if (Number(w.glass_cost || 0) !== 0 || Math.abs(suma) < 0.01) continue;
      (Number(w.total_sale || 0) >= 0 ? candidatas : excluidasNeg).push({ wo: k, monto: suma, venta: Number(w.total_sale || 0) });
    }
    for (const c of candidatas) {
      await client.query("UPDATE work_orders SET glass_cost = $2, glass_cost_source = $3 WHERE work_order_no = $1", [c.wo, c.monto, SOURCE]);
    }

    // ---- detalle de tecnicos y agentes ----
    let techIns = 0, agentIns = 0;
    for (const r of tech) {
      const k = woNo(r.WORKORDER_LABEL); if (!k || !porNo.has(k)) continue;
      await client.query(
        `INSERT INTO work_order_tech_labor (work_order_no, technician, labor, cash, work_date, status, source, external_id)
         VALUES ($1,$2,$3,$4,$5::date,$6,$7,$8) ON CONFLICT (external_id) DO NOTHING`,
        [k, r.TECH_LABEL || "", num(r.LABOR), num(r.CASH), fecha(r["DATE WORK ORDER"]), r.Status || "", SOURCE, r.ID]
      ); techIns++;
    }
    const colPay = Object.keys(agent[0]).find((c) => /TOTAL.*PAY/i.test(c));
    for (const r of agent) {
      const k = woNo(r.WORKORDER_LABEL); if (!k || !porNo.has(k)) continue;
      await client.query(
        `INSERT INTO work_order_agent_commission (work_order_no, agent, company, aftermarket, recommended, oem, services, insurance, total_pay, work_date, status, source, external_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::date,$11,$12,$13) ON CONFLICT (external_id) DO NOTHING`,
        [k, r.AGENT_LABEL || "", r.COMPANY_LABEL || "", num(r.AFTERMARKET), num(r.RECOMMENDED), num(r.OEM),
         num(r.SERVICES), num(r.INSURANCE), num(r[colPay]), fecha(r["DATE WORK ORDER"]), r.STATUS || "", SOURCE, r.ID]
      ); agentIns++;
    }

    // ---- validaciones ----
    const desp = await totales();
    const esperado = { pagado: 1502199.13, labor: 417160.94, comision: 52196.47, glass: 436290.19, venta: Number(antes.venta) };
    const ok = (a, b) => Math.abs(Number(a) - Number(b)) < 0.01;

    log(`lineas: completadas ${completadas} · creadas ${creadas} · campos llenados ${camposLlenados} · sin quote ${omitidasSinQuote}`);
    log(`glass_cost llenado en ${candidatas.length} WOs (+${money(candidatas.reduce((a, c) => a + c.monto, 0))}) · excluidas por venta negativa: ${excluidasNeg.length}`);
    log(`detalle insertado: tecnicos ${techIns} · agentes ${agentIns}`);
    log("");
    log("magnitud            antes            despues         esperado    ok");
    let todoOk = true;
    for (const [k, label] of [["pagado", "payment.amount"], ["labor", "labor_cost"], ["comision", "commission"], ["glass", "glass_cost"], ["venta", "total_sale"]]) {
      const bien = ok(desp[k], esperado[k]); if (!bien) todoOk = false;
      log(`${label.padEnd(16)} ${money(antes[k]).padStart(16)} ${money(desp[k]).padStart(16)} ${money(esperado[k]).padStart(16)}   ${bien ? "OK" : "FALLA"}`);
    }

    // Cambios fuera de lo previsto
    const previstas = new Set(candidatas.map((c) => c.wo));
    const cambiadas = (await client.query(
      `SELECT work_order_no FROM work_orders WHERE active <> false AND glass_cost_source = $1`, [SOURCE]
    )).rows.map((r) => r.work_order_no).filter((n) => !previstas.has(n));
    log("");
    log(cambiadas.length ? `WOs cambiadas fuera de lo previsto: ${cambiadas.join(", ")}` : "WOs cambiadas fuera de lo previsto: ninguna");
    log(todoOk ? "TODAS LAS VALIDACIONES OK" : "HAY VALIDACIONES EN FALLA");

    // ---- listas al reporte, no al output ----
    const cero = candidatas.filter((c) => c.venta === 0).sort((a, b) => b.monto - a.monto);
    const bajas = candidatas.filter((c) => c.venta > 0 && c.venta < c.monto).sort((a, b) => b.monto - a.monto);
    const L = ["", "---", "", "## Listas para revisión contable", "",
      `### ${cero.length} work orders con \`total_sale = 0\` — posibles garantías o re-trabajos`, "",
      "| WO | Costo a asignar |", "|---|---:|",
      ...cero.map((c) => `| ${c.wo} | ${money(c.monto)} |`), "",
      `### ${bajas.length} con \`total_sale\` positivo muy por debajo del costo — posible ingreso de aseguranza no registrado`, "",
      "| WO | Venta | Costo | Diferencia |", "|---|---:|---:|---:|",
      ...bajas.map((c) => `| ${c.wo} | ${money(c.venta)} | ${money(c.monto)} | ${money(c.venta - c.monto)} |`), "",
      `### ${excluidasNeg.length} excluidas — \`total_sale\` negativo, posibles chargebacks, pendiente criterio contable`, "",
      "| WO | Venta | Costo que NO se asignó |", "|---|---:|---:|",
      ...excluidasNeg.sort((a, b) => b.monto - a.monto).map((c) => `| ${c.wo} | ${money(c.venta)} | ${money(c.monto)} |`), ""];
    fs.appendFileSync(OUT, L.join("\n") + "\n");

    if (APPLY && todoOk) { await client.query("COMMIT"); log("APLICADO (COMMIT)"); }
    else { await client.query("ROLLBACK"); log(APPLY ? "ROLLBACK por validaciones en falla" : "ROLLBACK — dry-run"); }
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    console.log("ERROR:", e.message);
  } finally {
    client.release();
    await pool.end();
  }
})();
