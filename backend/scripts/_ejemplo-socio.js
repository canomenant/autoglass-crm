require("dotenv").config();
const fs = require("fs");
const path = require("path");
const pool = require("../src/config/db");
const store = require("../src/store/payments.store");
const { describePayoutMethod, preferredPayoutMethod } = require("../src/lib/payoutMethods");

// Una copia suelta del comprobante del socio, para revisarlo o mandarlo por fuera del CRM.
//
// Lee EXACTAMENTE los mismos datos que la página /statement/owner/<token>
// (store.ownerStatementByToken), así que lo que sale aquí es lo que ve el socio. No escribe nada
// en el CRM salvo emitir el token del lote si aún no existía.
//
//   node scripts/_ejemplo-socio.js Tech-0373
const NUMERO = process.argv[2] || "Tech-0373";

// El menos va delante del signo de dólar, igual que en la página.
const money = (n) => {
  const v = Number(n || 0);
  return (v < 0 ? "−$" : "$") + Math.abs(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

// Los nombres de los bonos salen del mismo catálogo que ve el socio en el CRM, para no escribir
// aquí una segunda lista que se quede atrás.
let BONOS = {};
try { BONOS = require("../../frontend/messages/en.json").payments.bonusTypes || {}; } catch { /* sin catálogo va el código */ }
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const fecha = (v) => (v ? String(v).slice(0, 10) : "—");

const TERMINOS = {
  laborSubtotal: "Labour", subtotal: "Subtotal", bonus: "Bonus", deductions: "Deductions",
  cashCollected: "Cash he already collected", partsCharged: "Parts charged", partsReturned: "Tech Part (reimbursed)",
  tax: "Tax", creditNotes: "Credit notes", debitNotes: "Debit notes",
};

(async () => {
  // Sin esto los catálogos se leen del archivo local, que va atrás del servidor: el de agentes
  // tiene 7 y app_data tiene 10, así que Digiclique no se reconocía como compañía y el aviso de
  // "no agent" no salía. El servidor hace esto mismo al arrancar.
  await require("../src/lib/initPostgres").initPostgres();

  const p = await pool.query("SELECT id FROM payouts WHERE payment_number = $1", [NUMERO]);
  if (!p.rows[0]) throw new Error(`No existe ${NUMERO}`);
  const { ownerToken } = await store.ensureOwnerToken(p.rows[0].id, "Ejemplo");
  const d = await store.ownerStatementByToken(ownerToken, { ip: null });

  const jobs = d.obligations || [];
  const perfil = d.jobProfit || {};
  const r = d.profit || {};
  const notas = d.notes || [];
  const piezas = d.techParts || [];
  const esTecnico = d.type === "TECHNICIAN";
  // La columna que este lote paga va resaltada; el nombre de quien cobra no se repite renglón a
  // renglón porque ya está arriba en "Paid to".
  const columnaPagada = esTecnico ? "labour" : d.type === "AGENT" ? "commission" : "part";
  const pag = (cual) => (columnaPagada === cual ? " pag" : "");
  const pagados = (d.parties || []).map((x) => String(x || "").trim().toLowerCase()).filter(Boolean);
  const esElPagado = (n0) => {
    const n = String(n0 || "").trim().toLowerCase();
    return n ? pagados.some((p) => p === n || p.startsWith(n) || n.startsWith(p)) : false;
  };
  const preferida = preferredPayoutMethod(d.payoutMethods || []);
  const otras = (d.payoutMethods || []).filter((m) => m !== preferida);
  const fechas = jobs.map((o) => fecha(o.workDate)).filter((x) => x !== "—").sort();

  const terminos = [
    { k: esTecnico ? "laborSubtotal" : "subtotal", v: esTecnico ? d.baseAmount : d.type === "AGENT" ? d.grossAmount : d.subtotal, s: "", siempre: true },
    { k: "bonus", v: d.bonus, s: "+", items: d.bonusItems || [] },
    { k: "deductions", v: d.deductions, s: "−" },
    { k: "cashCollected", v: d.cashAdvance, s: "−" },
    { k: "partsCharged", v: d.partsDeduction, s: "−" },
    { k: "partsReturned", v: d.partsReturn, s: "+" },
    { k: "tax", v: d.taxAmount, s: "+" },
    { k: "creditNotes", v: d.creditNotesTotal, s: "−" },
    { k: "debitNotes", v: d.debitNotesTotal, s: "+" },
  ].filter((x) => x.siempre || Number(x.v || 0) !== 0);

  const filas = jobs.map((o) => {
    const j = perfil[o.workOrderNo] || {};
    return `<tr>
      <td class="b">${esc(o.workOrderNo)}<span class="s">${esc(fecha(o.workDate))}</span></td>
      <td>${esc(o.customerName || "—")}<span class="s">${esc(o.vehicle || "")}</span></td>
      <td>${esc(j.jobType || o.jobType || "—")}${o.partNumber && o.partNumber !== (j.jobType || o.jobType) ? `<span class="s mono">${esc(o.partNumber)}</span>` : ""}${j.insurance ? `<span class="s seg">Insurance</span>` : ""}</td>
      <td class="r">${money(j.sale)}</td>
      <td class="r g${pag("part")}">${money(j.partCost)}${esElPagado(j.distributor) ? "" : `<span class="s">${esc(j.distributor || (j.partCost ? "—" : "no part"))}</span>`}</td>
      <td class="r g${pag("commission")}">${money(j.agentCommission)}${
        j.agentIsCompany
          ? `<span class="s falta">no agent</span>`
          : esElPagado(j.agentName) ? "" : `<span class="s">${esc(j.agentName || "—")}</span>`
      }</td>
      <td class="r g${pag("labour")}">${money(j.technicianLabour)}${
        j.technicianName && !esElPagado(j.technicianName) ? `<span class="s">${esc(j.technicianName)}</span>` : ""
      }</td>
      <td class="r ${j.insurance ? "gris" : Number(j.grossProfit) < 0 ? "neg" : "p"}">${money(j.grossProfit)}${j.insurance ? `<span class="s">not counted</span>` : ""}</td>
    </tr>`;
  }).join("");

  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${esc(NUMERO)} — copia del socio</title>
<style>
 @page { margin: 12mm; size: landscape }
 @media print { * { -webkit-print-color-adjust: exact; print-color-adjust: exact } }
 body{font-family:Segoe UI,Arial,sans-serif;color:#111;background:#f3f4f6;margin:0;padding:24px}
 .hoja{max-width:1040px;margin:0 auto;background:#fff;border-radius:12px;padding:32px}
 .cab{display:flex;gap:16px;align-items:flex-start;border-bottom:2px solid #111;padding-bottom:14px;margin-bottom:18px}
 .cab img{width:110px}
 .der{margin-left:auto;text-align:right}
 h1{font-size:19px;margin:0}
 .tag{display:inline-block;font-size:10px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;background:#dcfce7;color:#166534;border-radius:99px;padding:3px 9px}
 .solo{background:#fef3c7;color:#92400e}
 h2{font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:#666;margin:24px 0 8px}
 table{width:100%;border-collapse:collapse;font-size:13px}
 th{text-align:left;font-size:10px;text-transform:uppercase;letter-spacing:.04em;color:#888;border-bottom:1px solid #ddd;padding:0 6px 6px 0;font-weight:600}
 td{padding:7px 6px 7px 0;border-bottom:1px solid #eee;vertical-align:top}
 .r{text-align:right;white-space:nowrap}
 .b{font-weight:600;white-space:nowrap}
 .s{display:block;font-size:10.5px;color:#999;font-weight:400}
 .mono{font-family:Consolas,monospace}
 .g{color:#b91c1c}
 .pag{background:#fffbeb}
 th.pag{color:#b45309}
 th.pag em{display:block;font-style:normal;text-transform:none;letter-spacing:0;color:#d97706;font-weight:400}
 .neg{color:#b91c1c;font-weight:600}
 .p{color:#15803d;font-weight:600}
 .gris{color:#9ca3af;font-weight:600}
 .falta{color:#b45309}
 .seg{color:#0369a1;font-weight:600}
 tfoot td{border-top:2px solid #111;border-bottom:none;font-weight:700;padding-top:9px}
 .caja{background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:16px;font-size:14px}
 .caja .l{display:flex;justify-content:space-between;gap:12px;padding:3px 0}
 .caja .l span:last-child{white-space:nowrap}
 .tot{border-top:1px solid #cbd5e1;margin-top:8px;padding-top:8px;font-weight:700}
 .grande{font-size:20px;color:#15803d}
 .dos{display:flex;gap:18px;flex-wrap:wrap;margin-top:8px}
 .dos>div{flex:1;min-width:320px}
 .nota{font-size:11px;color:#777;margin-top:8px;line-height:1.5}
 .aviso{background:#f0f9ff;border:1px solid #bae6fd;color:#0c4a6e;border-radius:8px;padding:10px 12px;font-size:12px;margin:14px 0}
 .pago{background:#f0f9ff;border:1px solid #bae6fd;border-radius:8px;padding:12px 14px;margin-top:12px}
 .pago .t{font-size:10px;text-transform:uppercase;letter-spacing:.05em;color:#0369a1;margin-bottom:3px}
 .pago .v{font-weight:700;color:#0c4a6e}
</style></head><body><div class="hoja">

<div class="cab">
  <img src="logo.png" alt="">
  <div><div style="font-weight:700">Reyes Auto Glass Group</div>
  <div style="font-size:11px;color:#666">info@reyesautoglassgroup.com</div>
  <div style="font-size:11px;color:#666">crmreyesautoglassgroup.com</div></div>
  <div class="der">
    <h1>Payment statement</h1>
    <div style="font-size:11px;color:#666">${esc(d.paymentNumber || "")}</div>
    <span class="tag">${esc(d.status || "")}</span>
    <div style="font-size:11px;color:#666;margin-top:3px">${esc(d.paymentDate || "")}</div>
    <div style="margin-top:6px"><span class="tag solo">Owner copy</span></div>
  </div>
</div>

<div style="display:flex;justify-content:space-between;align-items:flex-end;margin-bottom:6px">
  <div><span style="font-size:10px;text-transform:uppercase;letter-spacing:.06em;color:#999">Paid to</span>
  <div style="font-size:16px;font-weight:700">${esc((d.parties || []).join(", ") || "—")}</div></div>
  ${fechas.length ? `<div style="font-size:12px;color:#666">${jobs.length} jobs · ${esc(fechas[0])} to ${esc(fechas[fechas.length - 1])}</div>` : ""}
</div>

<h2>Jobs included (${jobs.length})</h2>
<table>
 <thead><tr>
  <th>Work order</th><th>Customer</th><th>Job type</th>
  <th class="r">Sale</th>
  <th class="r${pag("part")}">Part cost${columnaPagada === "part" ? "<em>paid here</em>" : ""}</th>
  <th class="r${pag("commission")}">Agent com.${columnaPagada === "commission" ? "<em>paid here</em>" : ""}</th>
  <th class="r${pag("labour")}">Tech labour${columnaPagada === "labour" ? "<em>paid here</em>" : ""}</th>
  <th class="r">Gross profit</th>
 </tr></thead>
 <tbody>${filas}</tbody>
 <tfoot><tr>
  <td colspan="3">Total</td>
  <td class="r">${money(r.revenue)}</td><td class="r g${pag("part")}">${money(r.partCost)}</td><td class="r g${pag("commission")}">${money(r.agentCommission)}</td><td class="r g${pag("labour")}">${money(r.technicianLabour)}</td>
  <td class="r ${Number(r.grossProfit) < 0 ? "neg" : "p"}">${money(r.grossProfit)}</td>
 </tr></tfoot>
</table>
${Number(r.insuranceCount) > 0 ? `<div class="aviso">${r.insuranceCount} insurance job(s) are shown but left out of the total and the margin: the CRM only has what the customer paid, not what the insurer pays.</div>` : ""}

${piezas.length ? `<h2>Parts the technician paid for</h2>
<table><thead><tr><th>Work order</th><th>Customer</th><th>Part number</th><th class="r">Amount</th></tr></thead>
<tbody>${piezas.map((x) => `<tr><td class="b">${esc(x.workOrderNo || "—")}</td><td>${esc(x.customerName || "—")}</td><td class="mono" style="font-size:12px">${esc(x.partNumber || x.partDescription || "—")}</td><td class="r">${money(x.amount)}</td></tr>`).join("")}
<tr style="font-weight:700"><td colspan="3">Total</td><td class="r">${money(piezas.reduce((s, x) => s + Number(x.amount || 0), 0))}</td></tr></tbody></table>` : ""}

${notas.length ? `<h2>Credit &amp; debit notes</h2>
<table><thead><tr><th>Note</th><th>Kind</th><th>Part / invoice</th><th>Reason</th><th class="r">Amount</th></tr></thead>
<tbody>${notas.map((n) => {
    const resta = n.noteType === "CREDIT" || n.chargedHere;
    return `<tr><td class="b">${esc(n.noteNumber || "—")}${n.issueDate ? `<span class="s">${esc(fecha(n.issueDate))}</span>` : ""}</td>
      <td>${n.noteType === "CREDIT" ? "Credit" : "Debit"}</td>
      <td class="mono" style="font-size:12px">${esc(n.partNumber || n.invoiceNumber || "—")}</td>
      <td style="font-size:12px;color:#666">${esc(n.reason || "—")}</td>
      <td class="r">${resta ? "− " : "+ "}${money(n.amount)}</td></tr>`;
  }).join("")}</tbody></table>` : ""}

<div class="dos">
  <div>
    <h2>Profit summary</h2>
    <div class="caja">
      <div class="l"><span>Revenue</span><span>${money(r.revenue)}</span></div>
      <div class="l"><span>− Part cost</span><span class="g">${money(r.partCost)}</span></div>
      <div class="l"><span>− Agent commission</span><span class="g">${money(r.agentCommission)}</span></div>
      <div class="l"><span>− Technician labour</span><span class="g">${money(r.technicianLabour)}</span></div>
      <div class="l tot"><span>Gross profit</span><span class="grande">${money(r.grossProfit)}</span></div>
      <div class="l"><span>Margin</span><span><b>${Number(r.margin || 0).toFixed(1)}%</b></span></div>
    </div>
  </div>
  <div>
    <h2>What we pay</h2>
    <div class="caja">
      ${terminos.map((x) => `<div class="l"><span>${x.s ? `${x.s} ` : ""}${esc(TERMINOS[x.k] || x.k)}</span><span class="${x.s === "−" ? "g" : ""}">${money(x.v)}</span></div>
        ${(x.items || []).map((b) => `<div class="l" style="padding-left:14px;font-size:11px;color:#999"><span>${esc(BONOS[b.bonusType] || b.bonusType || "")}${b.note ? ` · ${esc(b.note)}` : ""}</span><span>${money(b.amount)}</span></div>`).join("")}`).join("")}
      <div class="l tot"><span>Net paid</span><span style="font-size:20px">${money(d.amount)}</span></div>
    </div>
    ${preferida ? `<div class="pago">
      <div class="t">Send the payment to</div>
      <div class="v">${esc(describePayoutMethod(preferida))}</div>
      ${preferida.notes ? `<div style="font-size:11px;color:#0369a1;margin-top:2px">${esc(preferida.notes)}</div>` : ""}
      ${otras.length ? `<div style="font-size:11px;color:#0369a1;margin-top:5px">Also accepts: ${esc(otras.map(describePayoutMethod).join(" · "))}</div>` : ""}
    </div>` : ""}
    ${Number(r.unpaidCount) > 0 ? `<p class="nota">${r.unpaidCount} of these jobs are not collected from the customer yet.</p>` : ""}
  </div>
</div>

<p class="nota" style="border-top:1px solid #eee;padding-top:12px;margin-top:22px">
  Owner copy — contains costs and margins. The statement the payee receives does not show these columns.
</p>

</div></body></html>`;

  const out = path.join(process.env.TEMP || __dirname, `comprobante-socio-${NUMERO}.html`);
  fs.writeFileSync(out, html);
  console.log("listo:", out);
  console.log(`ingreso ${money(r.revenue)} · ganancia ${money(r.grossProfit)} (${Number(r.margin || 0).toFixed(1)}%) · neto pagado ${money(d.amount)}`);
  console.log("trabajos:", jobs.length, "| notas:", notas.length, "| piezas del técnico:", piezas.length, "| de seguro:", r.insuranceCount);
  await pool.end();
})().catch((e) => { console.error(e.message); process.exit(1); });
