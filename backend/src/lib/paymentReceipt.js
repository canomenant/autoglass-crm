// Recibo automático al cliente cuando una orden queda pagada (Antonio, 19-sep-2026): por correo,
// con la factura marcada PAID y la nota de agradecimiento (misma plantilla que "Email — send from
// CRM"). Se dispara desde: el webhook de Stripe (pago por link), el cobro a la tarjeta en archivo
// y el guardado manual del pago en la orden (efectivo, Zelle, etc.). El SMS llegará con Twilio.
//
// Nunca lanza: un recibo que falla no debe tumbar el registro del pago. Deja bitácora en la
// factura (deliveries) y devuelve qué pasó, para que la pantalla lo diga.

const mailer = require("./mailer");
const sms = require("./sms");
const customerMessages = require("../store/customerMessages.store");
const companyProfileStore = require("../store/companyProfile.store");
const invoicesStore = require("../store/invoices.store");
const quotesStore = require("../store/quotes.store");
const { buildInvoiceEmail } = require("./invoiceEmail");

function frontendUrl() {
  return String(process.env.FRONTEND_URL || "").replace(/[/]$/, "");
}

// Recibo por SMS (Twilio) con el link de la factura. No lanza.
async function receiptSms(workOrder, invoice, { trigger, actor }) {
  if (!sms.isConfigured() || !sms.normalizeUS(workOrder.phone)) return { sent: false, reason: "no_phone_or_sms" };
  const url = `${frontendUrl()}/invoice/view/${invoice.publicToken}`;
  const nombre = String(workOrder.customerName || "").trim().split(/\s+/)[0] || "";
  const body = `Reyes Auto Glass Group: thank you ${nombre}! We received your payment of $${Number(invoice.amountPaid).toFixed(2)} for work order ${workOrder.workOrderNo}. Your receipt: ${url}`;
  try {
    const r = await sms.sendSms({ to: workOrder.phone, body });
    customerMessages.create({ workOrderId: workOrder.id, workOrderNo: workOrder.workOrderNo, kind: `receipt:${trigger}`, to: r.to, body, status: "sent", providerId: r.sid, sentBy: actor });
    return { sent: true, to: r.to };
  } catch (err) {
    customerMessages.create({ workOrderId: workOrder.id, workOrderNo: workOrder.workOrderNo, kind: `receipt:${trigger}`, to: workOrder.phone, body, status: "failed", error: err.message, sentBy: actor });
    return { sent: false, reason: "error", error: err.message };
  }
}

async function sendPaymentReceipt(workOrder, { trigger = "manual", actor = "System" } = {}) {
  const company = companyProfileStore.get();
  if (company.autoReceiptEmail === false) return { sent: false, reason: "disabled" };
  if (!(Number(workOrder.totalSale) > 0)) return { sent: false, reason: "no_sale" };
  const to = String(workOrder.email || "").trim();
  const emailOk = mailer.isConfigured() && mailer.EMAIL_RE.test(to);
  const smsOk = sms.isConfigured() && Boolean(sms.normalizeUS(workOrder.phone));
  if (!emailOk && !smsOk) return { sent: false, reason: mailer.isConfigured() ? "no_customer_contact" : "email_not_configured" };

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
    let email = { sent: false };
    if (emailOk) {
      const { subject, html, text } = buildInvoiceEmail({ invoice: fresh, company, publicUrl, frontendUrl: frontendUrl(), receipt: true });
      try {
        const r = await mailer.sendEmail({ to, subject, html, text });
        invoicesStore.logDelivery(fresh.id, { channel: "email_crm", to, subject, status: "sent", providerId: r.id, user: actor, trigger: `receipt:${trigger}` });
        await invoicesStore.markSent(fresh.id, actor, "email_crm");
        email = { sent: true, to };
      } catch (err) {
        invoicesStore.logDelivery(fresh.id, { channel: "email_crm", to, subject, status: "failed", error: err.message, user: actor, trigger: `receipt:${trigger}` });
        email = { sent: false, error: err.message };
      }
    }
    const text = smsOk ? await receiptSms(workOrder, fresh, { trigger, actor }) : { sent: false };
    if (text.sent) await invoicesStore.markSent(fresh.id, actor, "sms_crm");
    return { sent: email.sent || text.sent, to: email.sent ? to : undefined, sms: text, email, invoiceNumber: fresh.invoiceNumber };
  } catch (err) {
    console.error("[receipt] no se pudo mandar el recibo de", workOrder.workOrderNo, err.message);
    return { sent: false, reason: "error", error: err.message };
  }
}

module.exports = { sendPaymentReceipt };
