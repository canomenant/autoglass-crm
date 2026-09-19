// Correo de la factura al cliente: asunto, HTML (logo, resumen, botón "View invoice") y texto plano.
// Mismo criterio que la factura pública: nunca el costo de la parte, solo lo cobrado.

function money(n) {
  return `$${Number(n || 0).toFixed(2)}`;
}

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function buildInvoiceEmail({ invoice, company, publicUrl, frontendUrl, receipt = false }) {
  const nombre = String(invoice.customerName || "").trim().split(/\s+/)[0] || "";
  const vehiculo = [invoice.vehicle?.year, invoice.vehicle?.make, invoice.vehicle?.model].filter(Boolean).join(" ");
  const pagada = invoice.status !== "Void" && Number(invoice.total) > 0 && Number(invoice.balance) <= 0.005;
  const empresa = company?.name || "Reyes Auto Glass Group";
  const subject = receipt
    ? `Receipt — ${money(invoice.amountPaid)} received — Invoice ${invoice.invoiceNumber} — ${empresa}`
    : `Invoice ${invoice.invoiceNumber} — ${empresa}${pagada ? " (paid)" : ""}`;
  const logo = `${frontendUrl}/logo-print.png`;
  const contacto = [company?.phone, company?.email].filter(Boolean).join(" · ");
  const garantia = company?.warrantyUrl || `${frontendUrl}/warranty`;

  const filas = (invoice.items || []).map((it) =>
    `<tr><td style="padding:6px 0;border-bottom:1px solid #eee">${esc(it.description)}</td><td style="padding:6px 0;border-bottom:1px solid #eee;text-align:right;white-space:nowrap">${money(Number(it.quantity || 0) * Number(it.unitPrice || 0))}</td></tr>`
  ).join("");

  const html = `<!doctype html><html><body style="margin:0;background:#f3f4f6;font-family:Segoe UI,Arial,sans-serif;color:#111">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:24px 12px"><tr><td align="center">
<table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;background:#fff;border-radius:12px;padding:28px">
  <tr><td>
    <img src="${logo}" alt="${esc(empresa)}" width="150" style="display:block;width:150px;height:auto;margin-bottom:12px">
    <p style="margin:0 0 16px;font-size:15px">Hi ${esc(nombre)},</p>
    <p style="margin:0 0 16px;font-size:15px">${receipt ? `We received your payment of <b>${money(invoice.amountPaid)}</b>. Here is your ${pagada ? "paid " : ""}invoice` : pagada ? "Thank you for your payment. Here is your paid invoice" : "Here is your invoice"} <b>${esc(invoice.invoiceNumber)}</b>${vehiculo ? ` for your <b>${esc(vehiculo)}</b>` : ""}.</p>
    <table width="100%" cellpadding="0" cellspacing="0" style="font-size:14px;margin:8px 0 16px">
      ${filas}
      <tr><td style="padding:10px 0 4px;font-weight:700">Total</td><td style="padding:10px 0 4px;text-align:right;font-weight:700">${money(invoice.total)}</td></tr>
      <tr><td style="padding:2px 0;color:#555">Amount paid</td><td style="padding:2px 0;text-align:right;color:#555">${money(invoice.amountPaid)}</td></tr>
      <tr><td style="padding:2px 0;font-weight:700;color:${Number(invoice.balance) > 0.005 ? "#b91c1c" : "#15803d"}">Balance</td><td style="padding:2px 0;text-align:right;font-weight:700;color:${Number(invoice.balance) > 0.005 ? "#b91c1c" : "#15803d"}">${money(invoice.balance)}</td></tr>
    </table>
    ${invoice.taxIncluded ? `<p style="margin:0 0 16px;font-size:12px;color:#666">Price includes applicable sales tax.</p>` : ""}
    <p style="margin:0 0 20px"><a href="${publicUrl}" style="display:inline-block;background:#111;color:#fff;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:600">View invoice</a></p>
    <p style="margin:0 0 6px;font-size:12px;color:#666">You can print it or save it as PDF from that page.</p>
    ${company?.emailNote ? `<div style="margin:18px 0;padding:14px 16px;background:#f8fafc;border-left:4px solid #2976b2;border-radius:6px;font-size:14px;line-height:1.5;white-space:pre-wrap">${esc(company.emailNote)}</div>` : ""}
    ${company?.reviewUrl ? `<p style="margin:0 0 20px"><a href="${esc(company.reviewUrl)}" style="display:inline-block;border:2px solid #2976b2;color:#2976b2;text-decoration:none;padding:10px 18px;border-radius:8px;font-weight:600">⭐ Leave us a Google review</a></p>` : ""}
    <p style="margin:0 0 20px;font-size:12px;color:#666">Warranty: <a href="${garantia}" style="color:#1d4ed8">${esc(company?.warrantyTitle || "see warranty terms")}</a></p>
    <hr style="border:0;border-top:1px solid #eee;margin:0 0 14px">
    <p style="margin:0;font-size:12px;color:#666"><b>${esc(empresa)}</b>${contacto ? `<br>${esc(contacto)}` : ""}${company?.website ? `<br>${esc(company.website)}` : ""}</p>
  </td></tr>
</table>
</td></tr></table>
</body></html>`;

  const text = [
    `Hi ${nombre},`,
    "",
    `${pagada ? "Thank you for your payment. Here is your paid invoice" : "Here is your invoice"} ${invoice.invoiceNumber}${vehiculo ? ` for your ${vehiculo}` : ""}.`,
    ...(invoice.items || []).map((it) => `- ${it.description}: ${money(Number(it.quantity || 0) * Number(it.unitPrice || 0))}`),
    `Total: ${money(invoice.total)} · Paid: ${money(invoice.amountPaid)} · Balance: ${money(invoice.balance)}`,
    invoice.taxIncluded ? "Price includes applicable sales tax." : "",
    "",
    `View invoice: ${publicUrl}`,
    `Warranty: ${garantia}`,
    "",
    company?.emailNote || "",
    company?.reviewUrl ? `Leave us a Google review: ${company.reviewUrl}` : "",
    "",
    empresa, contacto, company?.website || "",
  ].filter((l) => l !== undefined).join("\n");

  return { subject, html, text };
}

module.exports = { buildInvoiceEmail };
