// Recibo automático al cliente cuando una orden queda pagada (Antonio, 19-sep-2026): por correo,
// con la factura marcada PAID y la nota de agradecimiento (misma plantilla que "Email — send from
// CRM"). Se dispara desde: el webhook de Stripe (pago por link), el cobro a la tarjeta en archivo
// y el guardado manual del pago en la orden (efectivo, Zelle, etc.). El SMS llegará con Twilio.
//
// Nunca lanza: un recibo que falla no debe tumbar el registro del pago. Deja bitácora en la
// factura (deliveries) y devuelve qué pasó, para que la pantalla lo diga.

const mailer = require("./mailer");
const companyProfileStore = require("../store/companyProfile.store");
const invoicesStore = require("../store/invoices.store");
const quotesStore = require("../store/quotes.store");
const { buildInvoiceEmail } = require("./invoiceEmail");

function frontendUrl() {
  return String(process.env.FRONTEND_URL || "").replace(/[/]$/, "");
}

async function sendPaymentReceipt(workOrder, { trigger = "manual", actor = "System" } = {}) {
  const company = companyProfileStore.get();
  if (company.autoReceiptEmail === false) return { sent: false, reason: "disabled" };
  if (!mailer.isConfigured()) return { sent: false, reason: "email_not_configured" };
  const to = String(workOrder.email || "").trim();
  if (!mailer.EMAIL_RE.test(to)) return { sent: false, reason: "no_customer_email" };
  if (!(Number(workOrder.totalSale) > 0)) return { sent: false, reason: "no_sale" };

  try {
    const quote = workOrder.quoteId ? await quotesStore.get(workOrder.quoteId) : null;
    // Una factura por orden: si ya existe se reutiliza; si no, se crea aquí (queda como Draft,
    // pero el sello PAID en la factura pública va por lo cobrado, no por el estado).
    const invoice = await invoicesStore.createFromWorkOrder(workOrder, quote, actor);
    // La factura debe reflejar el pago recién registrado: si es borrador se rearma con los pagos
    // de la orden; si ya fue enviada, se le agrega el pago que falte.
    let fresh = invoice;
    if (invoice.status === "Draft") {
      fresh = await invoicesStore.rebuildFromWorkOrder(invoice.id, workOrder, quote, actor, invoice.detail);
    }
    const publicUrl = `${frontendUrl()}/invoice/view/${fresh.publicToken}`;
    const { subject, html, text } = buildInvoiceEmail({ invoice: fresh, company, publicUrl, frontendUrl: frontendUrl(), receipt: true });
    const r = await mailer.sendEmail({ to, subject, html, text });
    invoicesStore.logDelivery(fresh.id, { channel: "email_crm", to, subject, status: "sent", providerId: r.id, user: actor, trigger: `receipt:${trigger}` });
    await invoicesStore.markSent(fresh.id, actor, "email_crm");
    return { sent: true, to, invoiceNumber: fresh.invoiceNumber };
  } catch (err) {
    console.error("[receipt] no se pudo mandar el recibo de", workOrder.workOrderNo, err.message);
    return { sent: false, reason: "error", error: err.message };
  }
}

module.exports = { sendPaymentReceipt };
