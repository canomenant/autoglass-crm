require("dotenv").config();
const fs = require("fs");
const path = require("path");
const pool = require("../src/config/db");
const store = require("../src/store/payments.store");

// Ejemplo del comprobante que recibiría el SOCIO (copia del dueño): la misma lista de trabajos que
// ve el técnico más las columnas de costo y ganancia, y un resumen tipo Admin Profit Panel.
// Sólo genera un HTML para revisar; no toca el CRM.
const NUMERO = process.argv[2] || "Tech-0373";

const money = (n) => "$" + Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

(async () => {
  const p = await pool.query("SELECT id FROM payouts WHERE payment_number = $1", [NUMERO]);
  if (!p.rows[0]) throw new Error(`No existe ${NUMERO}`);
  const st = await store.statementById(p.rows[0].id);

  const nos = [...new Set(st.obligations.map((o) => o.workOrderNo))];
  const w = await pool.query(
    `SELECT w.work_order_no, w.total_sale, w.glass_cost, w.commission, w.labor_cost, w.job_type,
            NULLIF(btrim(w.distributor), '') AS distributor,
            (w.payment->>'paid')::boolean AS pagada,
            q.agent_name, q.agent_id
       FROM work_orders w LEFT JOIN quotes q ON q.id = w.quote_id
      WHERE w.work_order_no = ANY($1) AND w.active <> false`,
    [nos]
  );
  const porWo = Object.fromEntries(w.rows.map((r) => [r.work_order_no, r]));

  // El distribuidor casi nunca está en la orden: vive en su obligación (una por parte).
  const d = await pool.query(
    `SELECT work_order_no, string_agg(DISTINCT btrim(party), ' · ') AS distribuidores
       FROM payable WHERE kind = 'DISTRIBUTOR' AND status <> 'retirada' AND work_order_no = ANY($1)
      GROUP BY 1`,
    [nos]
  );
  const distPorWo = Object.fromEntries(d.rows.map((r) => [r.work_order_no, r.distribuidores]));

  // Los agentes que son una COMPAÑIA cubren a varias personas (Digiclique = David Cruz, Ashley
  // Diaz, Kayla Lopez). El socio quiere ver la persona, no la razón social (Antonio, 21-sep-2026).
  // Cuando la cotización guardó la compañía y no a la persona, no hay nombre que poner: se muestra
  // la compañía en corto para que se note que falta capturar quién fue.
  const ag = await pool.query("SELECT value FROM app_data WHERE key = $1", ["agents.json"]);
  const agentes = Array.isArray(ag.rows[0]?.value) ? ag.rows[0].value : [];
  const esCompania = new Set(agentes.filter((a) => agentes.some((b) => b.companyName === a.name)).map((a) => a.id));
  // Digiclique es un call center: adentro están David Cruz, Ashley Diaz y Kayla Lopez, y la
  // comisión se les paga a los tres juntos en un solo lote a nombre de la compañía (Antonio,
  // 21-sep-2026). Quien refiere es la PERSONA, así que es su nombre el que va en el comprobante;
  // cuando la cotización guardó la compañía no se sabe cuál de los tres fue.
  const nombreCorto = (nombre, id) => {
    if (!nombre) return "";
    if (!esCompania.has(Number(id))) return nombre;
    return nombre.split(/s+/)[0]; // "Digiclique Digital Marketing Services" -> "Digiclique"
  };

  let tVenta = 0, tParte = 0, tCom = 0, tLabor = 0;
  const filas = st.obligations.map((o) => {
    const r = porWo[o.workOrderNo] || {};
    const venta = Number(r.total_sale || 0);
    const parte = Number(r.glass_cost || 0);
    const com = Number(r.commission || 0);
    const labor = Number(r.labor_cost || 0);
    const bruta = venta - parte - com - labor;
    tVenta += venta; tParte += parte; tCom += com; tLabor += labor;
    const dist = distPorWo[o.workOrderNo] || r.distributor || "";
    const persona = nombreCorto(r.agent_name, r.agent_id);
    const agente = persona;
    const faltaPersona = esCompania.has(Number(r.agent_id));
    const trabajo = o.jobType || r.job_type || "";
    return `<tr>
      <td class="b">${esc(o.workOrderNo)}<span class="s">${esc(String(o.workDate || "").slice(0, 10))}</span></td>
      <td>${esc(o.customerName || "—")}<span class="s">${esc(o.vehicle || "")}</span></td>
      <td>${esc(trabajo || "—")}${o.partNumber && o.partNumber !== trabajo ? `<span class="s mono">${esc(o.partNumber)}</span>` : ""}</td>
      <td class="r">${money(venta)}</td>
      <td class="r g">${money(parte)}<span class="s">${esc(dist || (parte ? "—" : "sin parte"))}</span></td>
      <td class="r g">${money(com)}<span class="s${faltaPersona ? " falta" : ""}">${esc(agente || "—")}${faltaPersona ? " · sin agente" : ""}</span></td>
      <td class="r g">${money(labor)}</td>
      <td class="r p">${money(bruta)}</td>
    </tr>`;
  }).join("");

  const bruta = tVenta - tParte - tCom - tLabor;
  const margen = tVenta ? (bruta / tVenta) * 100 : 0;
  const sinCobrar = w.rows.filter((r) => !r.pagada).length;

  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Ejemplo — comprobante del socio ${esc(NUMERO)}</title>
<style>
 body{font-family:Segoe UI,Arial,sans-serif;color:#111;background:#f3f4f6;margin:0;padding:24px}
 .hoja{max-width:1000px;margin:0 auto;background:#fff;border-radius:12px;padding:32px}
 .cab{display:flex;gap:16px;align-items:flex-start;border-bottom:2px solid #111;padding-bottom:14px;margin-bottom:18px}
 .cab img{width:110px;height:auto}
 .cab h1{font-size:19px;margin:0}
 .der{margin-left:auto;text-align:right}
 .tag{display:inline-block;font-size:10px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;background:#dcfce7;color:#166534;border-radius:99px;padding:3px 9px}
 .solo{background:#fef3c7;color:#92400e}
 h2{font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:#666;margin:22px 0 8px}
 table{width:100%;border-collapse:collapse;font-size:13px}
 th{text-align:left;font-size:10px;text-transform:uppercase;letter-spacing:.04em;color:#888;border-bottom:1px solid #ddd;padding:0 6px 6px 0;font-weight:600}
 td{padding:7px 6px 7px 0;border-bottom:1px solid #eee;vertical-align:top}
 .r{text-align:right;white-space:nowrap}
 .b{font-weight:600;white-space:nowrap}
 .nw{white-space:nowrap;color:#555}
 .s{display:block;font-size:10.5px;color:#999;font-weight:400}
 .mono{font-family:Consolas,monospace}
 .falta{color:#b45309}
 .g{color:#b91c1c}
 .p{color:#15803d;font-weight:600}
 tfoot td{border-top:2px solid #111;border-bottom:none;font-weight:700;padding-top:9px}
 .caja{background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:16px;margin-top:8px}
 .caja table{font-size:14px}
 .caja td{border:none;padding:4px 0}
 .grande{font-size:20px;font-weight:700;color:#15803d}
 .dos{display:flex;gap:18px;flex-wrap:wrap}
 .dos>div{flex:1;min-width:300px}
 .nota{font-size:11px;color:#777;margin-top:8px;line-height:1.5}
 .aviso{background:#fef2f2;border:1px solid #fecaca;color:#991b1b;border-radius:8px;padding:10px 12px;font-size:12px;margin-bottom:18px}
</style></head><body><div class="hoja">

<div class="aviso"><b>Ejemplo, no se ha aplicado.</b> Así quedaría el comprobante del socio, con datos reales de ${esc(NUMERO)}.</div>

<div class="cab">
  <img src="http://localhost:3000/logo-print.png" alt="">
  <div><div style="font-weight:700">Reyes Auto Glass Group</div>
  <div style="font-size:11px;color:#666">info@reyesautoglassgroup.com</div></div>
  <div class="der">
    <h1>Payment statement</h1>
    <div style="font-size:11px;color:#666">${esc(st.paymentNumber)}</div>
    <span class="tag">${esc(st.status)}</span>
    <div style="font-size:11px;color:#666;margin-top:3px">${esc(st.paymentDate || "")}</div>
    <div style="margin-top:6px"><span class="tag solo">Owner copy</span></div>
  </div>
</div>

<div style="display:flex;justify-content:space-between;align-items:flex-end;margin-bottom:6px">
  <div><span style="font-size:10px;text-transform:uppercase;letter-spacing:.06em;color:#999">Paid to</span>
  <div style="font-size:16px;font-weight:700">${esc((st.parties || []).join(", "))}</div></div>
  <div style="font-size:12px;color:#666">${st.obligations.length} jobs</div>
</div>

<h2>Jobs included (${st.obligations.length})</h2>
<table>
 <thead><tr>
  <th>Work order</th><th>Customer</th><th>Job type</th>
  <th class="r">Sale</th><th class="r">Part cost</th><th class="r">Agent com.</th><th class="r">Tech labour</th><th class="r">Gross profit</th>
 </tr></thead>
 <tbody>${filas}</tbody>
 <tfoot><tr>
  <td colspan="3">Total</td>
  <td class="r">${money(tVenta)}</td><td class="r g">${money(tParte)}</td><td class="r g">${money(tCom)}</td><td class="r g">${money(tLabor)}</td>
  <td class="r p">${money(bruta)}</td>
 </tr></tfoot>
</table>

<div class="dos" style="margin-top:26px">
  <div>
    <h2>Profit summary</h2>
    <div class="caja">
      <table>
        <tr><td>Revenue</td><td class="r">${money(tVenta)}</td></tr>
        <tr><td>− Part cost</td><td class="r g">${money(tParte)}</td></tr>
        <tr><td>− Agent commission</td><td class="r g">${money(tCom)}</td></tr>
        <tr><td>− Technician labour</td><td class="r g">${money(tLabor)}</td></tr>
        <tr><td style="border-top:1px solid #cbd5e1;padding-top:8px"><b>Gross profit</b></td>
            <td class="r" style="border-top:1px solid #cbd5e1;padding-top:8px"><span class="grande">${money(bruta)}</span></td></tr>
        <tr><td>Margin</td><td class="r"><b>${margen.toFixed(1)}%</b></td></tr>
      </table>
    </div>
  </div>
  <div>
    <h2>What we pay the technician</h2>
    <div class="caja">
      <table>
        <tr><td>Labour</td><td class="r">${money(st.baseAmount)}</td></tr>
        ${Number(st.cashAdvance) ? `<tr><td>− Cash he already collected</td><td class="r g">${money(st.cashAdvance)}</td></tr>` : ""}
        ${Number(st.partsReturn) ? `<tr><td>+ Tech Part (reimbursed)</td><td class="r">${money(st.partsReturn)}</td></tr>` : ""}
        ${Number(st.bonus) ? `<tr><td>+ Bonus</td><td class="r">${money(st.bonus)}</td></tr>` : ""}
        ${Number(st.deductions) ? `<tr><td>− Deductions</td><td class="r g">${money(st.deductions)}</td></tr>` : ""}
        <tr><td style="border-top:1px solid #cbd5e1;padding-top:8px"><b>Net paid</b></td>
            <td class="r" style="border-top:1px solid #cbd5e1;padding-top:8px"><b style="font-size:20px">${money(st.amount)}</b></td></tr>
      </table>
    </div>
    <p class="nota">${sinCobrar ? `<b>Ojo:</b> ${sinCobrar} de estos ${st.obligations.length} trabajos todavía no están cobrados al cliente.` : "Todos estos trabajos ya están cobrados al cliente."}</p>
  </div>
</div>

<p class="nota" style="border-top:1px solid #eee;padding-top:12px;margin-top:22px">
  <b>Importante:</b> esta copia lleva costos y márgenes. El técnico recibe la suya <b>sin</b> las columnas de costo de parte, comisión y ganancia — su link seguiría igual que hoy.
</p>

</div></body></html>`;

  const out = path.join(process.env.TEMP || __dirname, `ejemplo-socio-${NUMERO}.html`);
  fs.writeFileSync(out, html);
  console.log("listo:", out);
  console.log(`venta ${money(tVenta)} · parte ${money(tParte)} · comision ${money(tCom)} · labor ${money(tLabor)} · bruta ${money(bruta)} (${margen.toFixed(1)}%)`);
  await pool.end();
})().catch((e) => { console.error(e.message); process.exit(1); });
