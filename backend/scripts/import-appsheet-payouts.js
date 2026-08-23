// PASO 3/4: importa los lotes de pago historicos de AppSheet y el estado de cada obligacion.
//
//   cd backend && node scripts/import-appsheet-payouts.js          # dry-run, ROLLBACK
//   cd backend && node scripts/import-appsheet-payouts.js --apply
//
// Reemplaza los 200 lotes TECHNICIAN del import de ejemplo del 30-jul: no tenian numeracion ni
// fecha, agrupaban una sola work order cada uno y cubrian el 5.6% del labor real.
//
// Numeracion: tech y distribuidor la traen del export y se importa tal cual, es la trazabilidad
// contra AppSheet. Agente no la trae, se genera Agent-0001.. ordenando por (DATE PAYMENT, ID) —
// el desempate por ID importa porque hay 76 fechas repetidas y hasta 5 lotes en un mismo dia.
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const pool = require("../src/config/db");

const APPLY = process.argv.includes("--apply");
const DIR = path.join(__dirname, "..", "imports", "appsheet", "csv");

function parseCSV(t) {
  const R = []; let r = [], f = "", q = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (q) { if (c === '"') { if (t[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
    else if (c === '"') q = true;
    else if (c === ",") { r.push(f); f = ""; }
    else if (c === "\n") { r.push(f); R.push(r); r = []; f = ""; }
    else if (c !== "\r") f += c;
  }
  if (f || r.length) { r.push(f); R.push(r); }
  const h = R.shift().map((x) => x.trim());
  return R.filter((x) => x.length > 1).map((x) => Object.fromEntries(h.map((k, i) => [k, (x[i] ?? "").trim()])));
}
const num = (v) => { const n = Number(String(v ?? "").replace(/[$,]/g, "")); return Number.isFinite(n) ? n : 0; };
const money = (n) => "$" + Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const woNo = (l) => { const m = String(l ?? "").match(/^(Wo-\d+)/i); return m ? m[1] : null; };
const fecha = (v) => {
  const s = String(v ?? "").trim(); if (!s) return null;
  if (/^\d+$/.test(s)) { const d = new Date(Date.UTC(1899, 11, 30) + Number(s) * 86400000); return isNaN(d) ? null : d.toISOString().slice(0, 10); }
  const d = new Date(s); return isNaN(d) ? null : d.toISOString().slice(0, 10);
};
const col = (row, re) => Object.keys(row).find((k) => re.test(k));
const verdadero = (v) => /^(true|1|si|yes)$/i.test(String(v ?? "").trim());

(async () => {
  const det = parseCSV(fs.readFileSync(path.join(DIR, "BD_WORKORDER_DETAIL.csv"), "utf8"));
  const techWo = parseCSV(fs.readFileSync(path.join(DIR, "BD_TECHWO.csv"), "utf8"));
  const agWo = parseCSV(fs.readFileSync(path.join(DIR, "BD_AGENTCOMISSIONWO.csv"), "utf8"));
  const pTech = parseCSV(fs.readFileSync(path.join(DIR, "BD_PAYMENTTECH.csv"), "utf8"));
  const pAg = parseCSV(fs.readFileSync(path.join(DIR, "BD_PAYMENTAGENT.csv"), "utf8"));
  const pDist = parseCSV(fs.readFileSync(path.join(DIR, "BD_PAYMENTDISTRIBUTOR.csv"), "utf8"));

  const c = await pool.connect();
  const totales = async () => (await c.query(`SELECT
      COALESCE(SUM((payment->>'amount')::numeric),0) pagado, COALESCE(SUM(glass_cost),0) glass,
      COALESCE(SUM(labor_cost),0) labor, COALESCE(SUM(commission),0) comision
    FROM work_orders WHERE active <> false`)).rows[0];

  try {
    await c.query("BEGIN");
    const antes = await totales();

    // --- 1. fuera los 200 de ejemplo ---
    const borrados = (await c.query(
      "DELETE FROM payouts WHERE type='TECHNICIAN' AND created_by='Excel Import (EJEMPLO XLSX)' RETURNING 1")).rowCount;

    // --- 2. lotes ---
    let siguienteId = Number((await c.query("SELECT COALESCE(MAX(id),0) m FROM payouts")).rows[0].m);
    const insertarLote = async (numero, tipo, fila, extra = {}) => {
      siguienteId++;
      await c.query(
        `INSERT INTO payouts (id, payment_number, type, status, payment_method, payment_date, notes,
           work_order_ids, base_amount, bonus, deductions, cash_advance, parts_deduction, parts_return,
           net_amount, total_amount, subtotal, active, created_by, created_at, updated_at, audit_log)
         VALUES ($1,$2,$3,'Paid',$4,$5::date,$6,'[]'::jsonb,$7,$8,$9,$10,$11,$12,$13,$14,$15,true,
           'appsheet_import', now(), now(), $16::jsonb)`,
        [siguienteId, numero, tipo, extra.metodo || "", extra.fecha, extra.notas || "",
         extra.subtotal || 0, extra.bonus || 0, extra.discount || 0, extra.cash || 0,
         extra.parts || 0, extra.partsSuma || 0, extra.total || 0, extra.total || 0, extra.subtotal || 0,
         JSON.stringify([{ user: "appsheet_import", timestamp: new Date().toISOString(), action: "Imported from AppSheet" }])]
      );
      return siguienteId;
    };

    // TECH: numeracion propia del export
    const cNumT = col(pTech[0], /Consecutive Payment Tech/i);
    const loteTech = new Map();
    for (const r of pTech) {
      const sub = num(r.SUBTOTAL), bonus = num(r.BONUS), disc = num(r.DISCOUNT);
      const cash = num(r.CASH), parts = num(r.PARTS), partsS = num(r.PARTS_SUMA ?? r["PARTS SUMA"]);
      const id = await insertarLote(r[cNumT], "TECHNICIAN", r, {
        fecha: fecha(r["DATE PAYMENT"] ?? r.DATE), metodo: r.PAYMENT_METHOD ?? r.METHOD ?? "",
        notas: r.NOTE ?? r.NOTES ?? "", subtotal: sub, bonus, discount: disc, cash, parts, partsSuma: partsS,
        total: num(r.TOTAL) || sub + bonus - disc - cash - parts + partsS,
      });
      loteTech.set(r.ID, id);
    }
    // DIST: idem
    const cNumD = col(pDist[0], /CONSECUTIVE DISTRIBUTOR/i);
    const loteDist = new Map();
    for (const r of pDist) {
      const id = await insertarLote(r[cNumD] || null, "DISTRIBUTOR", r, {
        fecha: fecha(r["DATE PAYMENT"] ?? r.DATE), metodo: r.PAYMENT_METHOD ?? "",
        notas: r.NOTE ?? "", subtotal: num(r.SUBTOTAL), total: num(r.TOTAL) || num(r.SUBTOTAL),
      });
      loteDist.set(r.ID, id);
    }
    // AGENT: numeracion generada, ordenando por (DATE PAYMENT, ID)
    const cFechaA = col(pAg[0], /DATE.*PAYMENT/i) || "DATE PAYMENT";
    const ordenados = [...pAg].sort((a, b) =>
      String(fecha(a[cFechaA]) ?? "").localeCompare(String(fecha(b[cFechaA]) ?? "")) || String(a.ID).localeCompare(String(b.ID)));
    const loteAg = new Map();
    let iAg = 0;
    for (const r of ordenados) {
      iAg++;
      const id = await insertarLote(`Agent-${String(iAg).padStart(4, "0")}`, "AGENT", r, {
        fecha: fecha(r[cFechaA]), metodo: r.PAYMENT_METHOD ?? "", notas: r.NOTE ?? "",
        subtotal: num(r.SUBTOTAL), total: num(r.TOTAL) || num(r.SUBTOTAL),
      });
      loteAg.set(r.ID, id);
    }

    // --- 3. estado de cada obligacion ---
    const marcar = async (extPrefix, filas, colId, colStatus, mapaLote, colLote) => {
      let pag = 0, pen = 0;
      for (const r of filas) {
        const ext = extPrefix + (colId ? r[colId] : r.ID);
        const pagado = verdadero(r[colStatus]);
        const lote = pagado && colLote ? mapaLote.get(r[colLote]) ?? null : null;
        const res = await c.query(
          "UPDATE payable SET status=$2, payout_id=$3, updated_at=now() WHERE external_id=$1 RETURNING 1",
          [ext, pagado ? "pagado" : "pendiente", lote]);
        if (res.rowCount) (pagado ? pag++ : pen++);
      }
      return { pag, pen };
    };
    const rt = await marcar("tech:", techWo, "ID", "Status", loteTech, "ID_PAYMENTTECH");
    const ra = await marcar("agent:", agWo, "ID", "STATUS", loteAg, "ID_PAYMENTAGENT");
    const rd = await marcar("dist:", det, "ID", "Status", loteDist, "ID_PAYMENTDISTRIBUTOR");

    // --- validaciones ---
    const esp = {
      TECH: { pagado: [3050, 357307.00], pendiente: [517, 59853.94] },
      AGENT: { pagado: [3139, 48164.21], pendiente: [434, 4032.26] },
      DISTRIBUTOR: { pagado: [3186, 361384.45], pendiente: [1457, 113281.49] },
    };
    const real = (await c.query("SELECT kind, status, count(*) n, SUM(amount) s FROM payable GROUP BY 1,2")).rows;
    let ok = true;
    console.log(`lotes: tech ${pTech.length} · dist ${pDist.length} · agent ${ordenados.length} (generados) · borrados de ejemplo ${borrados}`);
    console.log(`obligaciones marcadas: tech ${rt.pag}/${rt.pen} · agent ${ra.pag}/${ra.pen} · dist ${rd.pag}/${rd.pen}\n`);
    console.log("tipo         estado      n      monto          esperado       ok");
    for (const k of ["TECH", "AGENT", "DISTRIBUTOR"]) for (const st of ["pagado", "pendiente"]) {
      const f = real.find((x) => x.kind === k && x.status === st) || { n: 0, s: 0 };
      const [en, es] = esp[k][st];
      const bien = Number(f.n) === en && Math.abs(Number(f.s) - es) < 0.01; if (!bien) ok = false;
      console.log(`${k.padEnd(12)} ${st.padEnd(10)} ${String(f.n).padStart(5)} ${money(f.s).padStart(14)} ${money(es).padStart(15)}   ${bien ? "OK" : "FALLA"}`);
    }
    const desp = await totales();
    for (const [k, l, e] of [["pagado", "payment.amount", 1502199.13], ["glass", "glass_cost", 436290.19],
      ["labor", "labor_cost", 417160.94], ["comision", "commission", 52196.47]]) {
      const bien = Math.abs(Number(desp[k]) - e) < 0.01; if (!bien) ok = false;
      console.log(`${l.padEnd(23)} ${money(desp[k]).padStart(14)} ${money(e).padStart(15)}   ${bien ? "OK" : "FALLA"}`);
    }

    if (APPLY && ok) { await c.query("COMMIT"); console.log("\nAPLICADO"); }
    else { await c.query("ROLLBACK"); console.log(ok ? "\nROLLBACK — dry-run" : "\nROLLBACK — validaciones en falla"); }
  } catch (e) {
    await c.query("ROLLBACK").catch(() => {});
    console.log("ERROR:", e.message);
  } finally { c.release(); await pool.end(); }
})();
