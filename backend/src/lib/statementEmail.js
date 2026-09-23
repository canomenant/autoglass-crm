// El correo con el comprobante de un lote de pago (técnico, agente o distribuidor), para mandárselo
// al socio o a quien haga falta desde el propio lote (Antonio, 20-sep-2026). Lleva el resumen
// completo —a quién, cuántos trabajos, desglose y neto, y la lista de órdenes— y el link al
// comprobante público, que es de donde se guarda el PDF. Mismo estilo que invoiceEmail.js.

function money(n) {
  return "$" + Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

const TIPO = { TECHNICIAN: "Technician", AGENT: "Agent", DISTRIBUTOR: "Distributor" };

const { describePayoutMethod, preferredPayoutMethod } = require("./payoutMethods");

// Los mismos renglones y el mismo orden que el comprobante; lo que vale cero no se lista.
function terms(st) {
  const esTecnico = st.type === "TECHNICIAN";
  const base = esTecnico ? st.baseAmount : st.type === "AGENT" ? st.grossAmount : st.subtotal;
  return [
    { label: esTecnico ? "Labour" : st.type === "AGENT" ? "Commission" : "Subtotal", v: base, sign: "", always: true },
    { label: "Bonus", v: st.bonus, sign: "+" },
    { label: "Deductions", v: st.deductions, sign: "−" },
    { label: "Cash already collected", v: st.cashAdvance, sign: "−" },
    { label: "Parts charged", v: st.partsDeduction, sign: "−" },
    { label: "Tech Part (reimbursed)", v: st.partsReturn, sign: "+" },
    { label: "Tax", v: st.taxAmount, sign: "+" },
    { label: "Credit notes", v: st.creditNotesTotal, sign: "−" },
    { label: "Debit notes", v: st.debitNotesTotal, sign: "+" },
  ].filter((x) => x.always || Number(x.v || 0) !== 0);
}

// El texto fijo de Company Profile con los comodines resueltos: {party} a quién se paga, {amount}
// el neto, {number} el lote, {type} técnico/agente/distribuidor.
function fillTemplate(tpl, { paidTo, numero, st }) {
  return String(tpl || "")
    .replace(/\{party\}/g, paidTo)
    .replace(/\{amount\}/g, money(st.amount))
    .replace(/\{number\}/g, numero)
    .replace(/\{type\}/g, (TIPO[st.type] || st.type || "").toLowerCase());
}

function buildStatementEmail({ statement: st, company, publicUrl, frontendUrl, note = "" }) {
  const empresa = company?.name || "Reyes Auto Glass Group";
  const paidTo = (st.parties || []).join(", ") || "—";
  const numero = st.paymentNumber || "(no number yet)";
  const intro = fillTemplate(company?.statementEmailNote, { paidTo, numero, st }).trim();
  const subject = `Payment statement ${numero} · ${paidTo} · ${money(st.amount)} — ${empresa}`;
  const logo = `${frontendUrl}/logo-print.png`;
  const contacto = [company?.phone, company?.email].filter(Boolean).join(" · ");
  const jobs = st.obligations || [];
  const fechas = jobs.map((o) => (o.workDate ? String(o.workDate).slice(0, 10) : "")).filter(Boolean).sort();
  const periodo = fechas.length ? `${jobs.length} jobs · ${fechas[0]} to ${fechas[fechas.length - 1]}` : `${jobs.length} jobs`;
  // A dónde mandar el dinero: la forma preferida primero y las demás como alternativa. Es el
  // dato que el socio necesita para pagar sin preguntar (Antonio, 21-sep-2026).
  const payout = Array.isArray(st.payoutMethods) ? st.payoutMethods : [];
  const payoutPref = preferredPayoutMethod(payout);
  const payoutOtras = payout.filter((m) => m !== payoutPref);
  const filasTerminos = terms(st).map((x) =>
    `<tr><td style="padding:4px 0;color:#374151"><span style="display:inline-block;width:12px">${x.sign}</span>${esc(x.label)}</td><td style="padding:4px 0;text-align:right;white-space:nowrap${x.sign === "−" ? ";color:#991b1b" : ""}">${money(x.v)}</td></tr>`
  ).join("");
  // Cómo pagó el cliente, como en el comprobante: el método siempre (salvo distribuidor, que no
  // cobra al cliente) y, cuando fue efectivo que el técnico se quedó, el monto que se le descuenta
  // (Antonio, 20-sep-2026).
  const conMetodo = st.type !== "DISTRIBUTOR" && jobs.some((o) => o.customerMethod);
  const pagoCliente = (o) => {
    const cash = Number(o.cashInHand || 0);
    if (cash > 0) return `<span style="color:#b45309;font-weight:600">Cash ${money(cash)}</span><br><span style="font-size:11px;color:#b45309">kept by tech · deducted</span>`;
    return esc(o.customerMethod || "—");
  };
  // La copia del dueño (lo que se le manda al socio) trae venta, costos y ganancia por orden: el
  // correo tiene que verse como ese comprobante y no como el del técnico (Antonio, 23-sep-2026).
  const perfil = st.jobProfit || null;
  const resumen = st.profit || {};
  const esTecnico = st.type === "TECHNICIAN";
  const columnaPagada = esTecnico ? "labour" : st.type === "AGENT" ? "commission" : "part";
  const MARCA = "background:#fef3c7;";
  const ROJO = "#991b1b", VERDE = "#166534", AMBAR = "#92400e", GRIS = "#374151";
  const celda = "padding:6px 5px;border-bottom:1px solid #e5e7eb;vertical-align:top;";
  const sub = (txt, color = GRIS, extra = "") => `<br><span style="font-size:11px;color:${color};${extra}">${esc(txt)}</span>`;
  const pagados = (st.parties || []).map((x) => String(x || "").trim().toLowerCase()).filter(Boolean);
  const esElPagado = (n) => {
    const x = String(n || "").trim().toLowerCase();
    return !!x && pagados.some((p) => p === x || p.startsWith(x) || x.startsWith(p));
  };
  const filaDueno = (o) => {
    const p = perfil[o.workOrderNo] || {};
    const cash = Number(o.cashInHand || 0);
    const venta = [
      money(p.sale),
      p.customerPaid === false ? sub("not collected yet", AMBAR, "font-weight:600") : o.customerMethod ? sub(o.customerMethod) : "",
      cash > 0 ? sub(`${money(cash)} kept by the tech`, AMBAR, "font-weight:600") : "",
    ].join("");
    const colorGanancia = p.insurance ? GRIS : Number(p.grossProfit) < 0 ? ROJO : VERDE;
    const costo = (col, v, debajo) =>
      `<td style="${celda}text-align:right;white-space:nowrap;color:${ROJO};${columnaPagada === col ? MARCA : ""}">${money(v)}${debajo}</td>`;
    return `<tr>
      <td style="${celda}white-space:nowrap;font-weight:700">${esc(o.workOrderNo || "—")}${sub(o.workDate ? String(o.workDate).slice(0, 10) : "—")}</td>
      <td style="${celda}">${esc(o.customerName || "—")}${o.vehicle ? sub(o.vehicle) : ""}</td>
      <td style="${celda}">${esc(p.jobType || o.jobType || "—")}${o.partNumber && o.partNumber !== (p.jobType || o.jobType) ? sub(o.partNumber) : ""}${p.insurance ? sub("INSURANCE", "#075985", "font-weight:700") : ""}</td>
      <td style="${celda}text-align:right;white-space:nowrap">${venta}</td>
      ${costo("part", p.partCost, !esElPagado(p.distributor) ? sub(p.distributor || (p.partCost ? "—" : "no part")) : "")}
      ${costo("commission", p.agentCommission, !esElPagado(p.agentName) ? sub(p.agentName || "no agent") : "")}
      ${costo("labour", p.technicianLabour, !esElPagado(p.technicianName) && p.technicianName ? sub(p.technicianName) : "")}
      <td style="${celda}text-align:right;white-space:nowrap;font-weight:700;color:${colorGanancia}">${money(p.grossProfit)}${p.insurance ? sub("excluded") : ""}</td>
    </tr>`;
  };
  const thDueno = (txt, col, der = true) => {
    const pagada = col && col === columnaPagada;
    return `<th style="padding:0 5px 6px;font-weight:700;${der ? "text-align:right;" : ""}${pagada ? `${MARCA}color:${AMBAR};` : ""}">${txt}${pagada ? `<br><span style="text-transform:none">paid here</span>` : ""}</th>`;
  };
  const pie = (v, col, color = ROJO) =>
    `<td style="padding:8px 5px;border-top:2px solid #111;text-align:right;white-space:nowrap;color:${color};${col && columnaPagada === col ? MARCA : ""}">${money(v)}</td>`;
  const totalTrabajos = perfil
    ? `<tr style="font-weight:700"><td colspan="3" style="padding:8px 5px;border-top:2px solid #111">Total</td>${pie(resumen.revenue, null, "#111")}${pie(resumen.partCost, "part")}${pie(resumen.agentCommission, "commission")}${pie(resumen.technicianLabour, "labour")}${pie(resumen.grossProfit, null, Number(resumen.grossProfit) < 0 ? ROJO : VERDE)}</tr>`
    : "";
  const linea = (label, valor, color = "#111") =>
    `<tr><td style="padding:3px 0;color:${GRIS}">${label}</td><td style="padding:3px 0;text-align:right;white-space:nowrap;color:${color}">${valor}</td></tr>`;
  const resumenGanancia = perfil
    ? `<h2 style="margin:0 0 8px;font-size:12px;text-transform:uppercase;letter-spacing:.04em;color:${GRIS}">Profit summary</h2>
    <table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 18px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px"><tr><td style="padding:12px 14px">
      <table width="100%" cellpadding="0" cellspacing="0" style="font-size:14px">
        ${linea("Revenue", money(resumen.revenue))}
        ${linea("− Part cost", money(resumen.partCost), ROJO)}
        ${linea("− Agent com.", money(resumen.agentCommission), ROJO)}
        ${linea("− Tech labour", money(resumen.technicianLabour), ROJO)}
        <tr><td style="padding:8px 0 0;border-top:1px solid #cbd5e1;font-weight:700">Gross profit</td><td style="padding:8px 0 0;border-top:1px solid #cbd5e1;text-align:right;font-weight:700;font-size:18px;color:${Number(resumen.grossProfit) < 0 ? ROJO : VERDE}">${money(resumen.grossProfit)}</td></tr>
        ${linea("Margin", `${Number(resumen.margin || 0).toFixed(1)}%`)}
      </table>
      ${Number(resumen.insuranceCount) > 0 ? `<div style="font-size:12px;color:#075985;margin-top:6px">${resumen.insuranceCount} insurance job(s) left out of the total and margin: the CRM only has what the customer paid.</div>` : ""}
    </td></tr></table>`
    : "";

  const filasTrabajos = perfil ? jobs.map(filaDueno).join("") : jobs.map((o) =>
    `<tr>
      <td style="padding:5px 6px 5px 0;border-bottom:1px solid #eee;white-space:nowrap;font-weight:600">${esc(o.workOrderNo || "—")}</td>
      <td style="padding:5px 6px;border-bottom:1px solid #eee;white-space:nowrap;color:#374151">${esc(o.workDate ? String(o.workDate).slice(0, 10) : "—")}</td>
      <td style="padding:5px 6px;border-bottom:1px solid #eee">${esc(o.customerName || "—")}${o.vehicle ? `<br><span style="font-size:11px;color:#4b5563">${esc(o.vehicle)}</span>` : ""}</td>
      ${conMetodo ? `<td style="padding:5px 6px;border-bottom:1px solid #eee;font-size:12px">${pagoCliente(o)}</td>` : ""}
      <td style="padding:5px 0 5px 6px;border-bottom:1px solid #eee;text-align:right;white-space:nowrap">${money(o.amount)}</td>
    </tr>`
  ).join("");
  const encabezadoTrabajos = perfil
    ? `<tr style="font-size:10px;text-transform:uppercase;color:${GRIS};text-align:left">${thDueno("Work order", null, false)}${thDueno("Customer", null, false)}${thDueno("Job type", null, false)}${thDueno("Sale")}${thDueno("Part cost", "part")}${thDueno("Agent com.", "commission")}${thDueno("Tech labour", "labour")}${thDueno("Gross profit")}</tr>`
    : `<tr style="font-size:11px;text-transform:uppercase;color:#4b5563;text-align:left">
      <th style="padding:0 6px 6px 0;font-weight:600">Work order</th><th style="padding:0 6px 6px;font-weight:600">Work date</th><th style="padding:0 6px 6px;font-weight:600">Customer</th>${conMetodo ? '<th style="padding:0 6px 6px;font-weight:600">How the customer paid</th>' : ""}<th style="padding:0 0 6px 6px;font-weight:600;text-align:right">Amount</th>
    </tr>`;

  // Ancho: la copia del dueño tiene ocho columnas y a 600px se amontonaban.
  const ancho = perfil ? 780 : 600;
  // lang/translate/notranslate: Gmail traducía el correo solo y salían "Ver declaración" o "16
  // puestos de trabajo" (Antonio, 23-sep-2026). Los términos van en inglés a propósito.
  const html = `<!doctype html><html lang="en" translate="no"><head><meta charset="utf-8"><meta name="google" content="notranslate"></head><body class="notranslate" translate="no" style="margin:0;background:#f3f4f6;font-family:Segoe UI,Arial,sans-serif;color:#111">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:24px 12px"><tr><td align="center">
<table width="${ancho}" cellpadding="0" cellspacing="0" style="max-width:${ancho}px;background:#fff;border-radius:12px;padding:28px">
  <tr><td>
    <img src="${logo}" alt="${esc(empresa)}" width="150" style="display:block;width:150px;height:auto;margin-bottom:12px">
    <h1 style="margin:0 0 4px;font-size:18px">Payment statement ${esc(numero)}${perfil ? ` <span style="font-size:11px;font-weight:700;background:#fef3c7;color:${AMBAR};padding:3px 8px;border-radius:999px;vertical-align:middle">OWNER COPY</span>` : ""}</h1>
    <p style="margin:0 0 14px;font-size:13px;color:#374151">${esc(TIPO[st.type] || st.type)} · ${esc(st.status || "")}${st.paymentDate ? ` · ${esc(st.paymentDate)}` : ""}${st.paymentMethod ? ` · ${esc(st.paymentMethod)}` : ""}</p>
    ${intro ? `<div style="margin:0 0 16px;font-size:15px;line-height:1.55;white-space:pre-wrap">${esc(intro)}</div>` : ""}
    ${note ? `<div style="margin:0 0 16px;padding:12px 14px;background:#f8fafc;border-left:4px solid #2976b2;border-radius:6px;font-size:14px;line-height:1.5;white-space:pre-wrap">${esc(note)}</div>` : ""}
    <table width="100%" cellpadding="0" cellspacing="0" style="font-size:14px;margin:0 0 14px">
      <tr><td style="padding:2px 0;color:#374151">Paid to</td><td style="padding:2px 0;text-align:right;font-weight:700">${esc(paidTo)}</td></tr>
      <tr><td style="padding:2px 0;color:#374151">Jobs</td><td style="padding:2px 0;text-align:right">${esc(periodo)}</td></tr>
    </table>
    <table width="100%" cellpadding="0" cellspacing="0" style="font-size:14px;margin:0 0 18px">
      ${filasTerminos}
      <tr><td style="padding:8px 0 0;border-top:2px solid #111;font-weight:700;font-size:16px">Net paid</td><td style="padding:8px 0 0;border-top:2px solid #111;text-align:right;font-weight:700;font-size:16px">${money(st.amount)}</td></tr>
    </table>
    ${payoutPref ? `<table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 18px;background:#f0f9ff;border:1px solid #bae6fd;border-radius:8px"><tr><td style="padding:12px 14px">
      <div style="font-size:11px;text-transform:uppercase;letter-spacing:.04em;color:#0369a1;margin-bottom:4px">Send the payment to</div>
      <div style="font-size:15px;font-weight:700;color:#0c4a6e">${esc(describePayoutMethod(payoutPref))}</div>
      ${payoutPref.notes ? `<div style="font-size:12px;color:#0369a1;margin-top:2px">${esc(payoutPref.notes)}</div>` : ""}
      ${payoutOtras.length ? `<div style="font-size:12px;color:#0369a1;margin-top:6px">Also accepts: ${esc(payoutOtras.map(describePayoutMethod).join(" · "))}</div>` : ""}
    </td></tr></table>` : ""}
    <p style="margin:0 0 20px"><a href="${publicUrl}" style="display:inline-block;background:#111;color:#fff;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:600">View statement</a>
      <a href="${publicUrl}?print=1" style="display:inline-block;margin-left:8px;border:2px solid #111;color:#111;text-decoration:none;padding:10px 18px;border-radius:8px;font-weight:600">Save as PDF</a></p>
    ${jobs.length ? `<h2 style="margin:0 0 8px;font-size:12px;text-transform:uppercase;letter-spacing:.04em;color:#374151">Jobs included (${jobs.length})</h2>
    <table width="100%" cellpadding="0" cellspacing="0" style="font-size:${perfil ? 12 : 13}px;margin:0 0 18px">${encabezadoTrabajos}${filasTrabajos}${totalTrabajos}</table>` : ""}
    ${resumenGanancia}
    <hr style="border:0;border-top:1px solid #eee;margin:0 0 14px">
    <p style="margin:0;font-size:12px;color:#374151"><b>${esc(empresa)}</b>${contacto ? `<br>${esc(contacto)}` : ""}${company?.website ? `<br>${esc(company.website)}` : ""}</p>
  </td></tr>
</table>
</td></tr></table>
</body></html>`;

  const text = [
    `Payment statement ${numero} — ${empresa}`,
    `${TIPO[st.type] || st.type} · ${st.status || ""}${st.paymentDate ? ` · ${st.paymentDate}` : ""}${st.paymentMethod ? ` · ${st.paymentMethod}` : ""}`,
    intro ? `\n${intro}\n` : "",
    note ? `\n${note}\n` : "",
    `Paid to: ${paidTo}`,
    payoutPref ? `Send the payment to: ${describePayoutMethod(payoutPref)}${payoutPref.notes ? ` (${payoutPref.notes})` : ""}` : "",
    payoutOtras.length ? `Also accepts: ${payoutOtras.map(describePayoutMethod).join(" · ")}` : "",
    `Jobs: ${periodo}`,
    "",
    ...terms(st).map((x) => `${x.sign ? x.sign + " " : ""}${x.label}: ${money(x.v)}`),
    `Net paid: ${money(st.amount)}`,
    "",
    `View statement: ${publicUrl}`,
    `Save as PDF: ${publicUrl}?print=1`,
    "",
    ...jobs.map((o) => `- ${o.workOrderNo || "—"} · ${o.workDate ? String(o.workDate).slice(0, 10) : "—"} · ${o.customerName || "—"}${o.vehicle ? ` (${o.vehicle})` : ""}${conMetodo ? ` · ${Number(o.cashInHand || 0) > 0 ? `Cash ${money(o.cashInHand)} kept by tech, deducted` : o.customerMethod || "—"}` : ""} · ${money(o.amount)}`),
    "",
    empresa, contacto, company?.website || "",
  ].filter((l) => l !== undefined && l !== "").join("\n");

  return { subject, html, text };
}

module.exports = { buildStatementEmail };
