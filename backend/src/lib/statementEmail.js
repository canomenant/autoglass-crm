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
  const filasTerminos = terms(st).map((x) =>
    `<tr><td style="padding:4px 0;color:#555"><span style="display:inline-block;width:12px">${x.sign}</span>${esc(x.label)}</td><td style="padding:4px 0;text-align:right;white-space:nowrap">${money(x.v)}</td></tr>`
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
  const filasTrabajos = jobs.map((o) =>
    `<tr>
      <td style="padding:5px 6px 5px 0;border-bottom:1px solid #eee;white-space:nowrap;font-weight:600">${esc(o.workOrderNo || "—")}</td>
      <td style="padding:5px 6px;border-bottom:1px solid #eee;white-space:nowrap;color:#555">${esc(o.workDate ? String(o.workDate).slice(0, 10) : "—")}</td>
      <td style="padding:5px 6px;border-bottom:1px solid #eee">${esc(o.customerName || "—")}${o.vehicle ? `<br><span style="font-size:11px;color:#888">${esc(o.vehicle)}</span>` : ""}</td>
      ${conMetodo ? `<td style="padding:5px 6px;border-bottom:1px solid #eee;font-size:12px">${pagoCliente(o)}</td>` : ""}
      <td style="padding:5px 0 5px 6px;border-bottom:1px solid #eee;text-align:right;white-space:nowrap">${money(o.amount)}</td>
    </tr>`
  ).join("");
  const encabezadoTrabajos = `<tr style="font-size:11px;text-transform:uppercase;color:#888;text-align:left">
      <th style="padding:0 6px 6px 0;font-weight:600">Work order</th><th style="padding:0 6px 6px;font-weight:600">Work date</th><th style="padding:0 6px 6px;font-weight:600">Customer</th>${conMetodo ? '<th style="padding:0 6px 6px;font-weight:600">How the customer paid</th>' : ""}<th style="padding:0 0 6px 6px;font-weight:600;text-align:right">Amount</th>
    </tr>`;

  const html = `<!doctype html><html><body style="margin:0;background:#f3f4f6;font-family:Segoe UI,Arial,sans-serif;color:#111">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:24px 12px"><tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;background:#fff;border-radius:12px;padding:28px">
  <tr><td>
    <img src="${logo}" alt="${esc(empresa)}" width="150" style="display:block;width:150px;height:auto;margin-bottom:12px">
    <h1 style="margin:0 0 4px;font-size:18px">Payment statement ${esc(numero)}</h1>
    <p style="margin:0 0 14px;font-size:13px;color:#555">${esc(TIPO[st.type] || st.type)} · ${esc(st.status || "")}${st.paymentDate ? ` · ${esc(st.paymentDate)}` : ""}${st.paymentMethod ? ` · ${esc(st.paymentMethod)}` : ""}</p>
    ${intro ? `<div style="margin:0 0 16px;font-size:15px;line-height:1.55;white-space:pre-wrap">${esc(intro)}</div>` : ""}
    ${note ? `<div style="margin:0 0 16px;padding:12px 14px;background:#f8fafc;border-left:4px solid #2976b2;border-radius:6px;font-size:14px;line-height:1.5;white-space:pre-wrap">${esc(note)}</div>` : ""}
    <table width="100%" cellpadding="0" cellspacing="0" style="font-size:14px;margin:0 0 14px">
      <tr><td style="padding:2px 0;color:#555">Paid to</td><td style="padding:2px 0;text-align:right;font-weight:700">${esc(paidTo)}</td></tr>
      <tr><td style="padding:2px 0;color:#555">Jobs</td><td style="padding:2px 0;text-align:right">${esc(periodo)}</td></tr>
    </table>
    <table width="100%" cellpadding="0" cellspacing="0" style="font-size:14px;margin:0 0 18px">
      ${filasTerminos}
      <tr><td style="padding:8px 0 0;border-top:2px solid #111;font-weight:700;font-size:16px">Net paid</td><td style="padding:8px 0 0;border-top:2px solid #111;text-align:right;font-weight:700;font-size:16px">${money(st.amount)}</td></tr>
    </table>
    <p style="margin:0 0 20px"><a href="${publicUrl}" style="display:inline-block;background:#111;color:#fff;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:600">View statement</a>
      <a href="${publicUrl}?print=1" style="display:inline-block;margin-left:8px;border:2px solid #111;color:#111;text-decoration:none;padding:10px 18px;border-radius:8px;font-weight:600">Save as PDF</a></p>
    ${jobs.length ? `<h2 style="margin:0 0 8px;font-size:12px;text-transform:uppercase;letter-spacing:.04em;color:#666">Jobs included (${jobs.length})</h2>
    <table width="100%" cellpadding="0" cellspacing="0" style="font-size:13px;margin:0 0 18px">${encabezadoTrabajos}${filasTrabajos}</table>` : ""}
    <hr style="border:0;border-top:1px solid #eee;margin:0 0 14px">
    <p style="margin:0;font-size:12px;color:#666"><b>${esc(empresa)}</b>${contacto ? `<br>${esc(contacto)}` : ""}${company?.website ? `<br>${esc(company.website)}` : ""}</p>
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
