const express = require("express");
const { actorFrom: actor } = require("../lib/actor");
const store = require("../store/invoices.store");
const workOrdersStore = require("../store/workorders.store");
const quotesStore = require("../store/quotes.store");
const { requireAuth, requireRole } = require("../middleware/auth");
const mailer = require("../lib/mailer");
const sms = require("../lib/sms");
const companyProfileStore = require("../store/companyProfile.store");
const { buildInvoiceEmail } = require("../lib/invoiceEmail");

const router = express.Router();
const adminOnly = [requireAuth, requireRole("ADMIN")];

// Public: customer-facing invoice link, no login required (relies on the unguessable token).
router.get("/public/:token", async (req, res) => {
  await store.markViewed(req.params.token);
  const invoice = await store.getPublicByToken(req.params.token);
  if (!invoice) return res.status(404).json({ error: "Invoice not found" });
  res.json(invoice);
});

router.get("/", adminOnly, async (req, res) => res.json(await store.list(req.query)));

router.get("/:id", adminOnly, async (req, res) => {
  const invoice = await store.get(req.params.id);
  if (!invoice) return res.status(404).json({ error: "Invoice not found" });
  res.json(invoice);
});

router.post("/from-workorder/:workOrderId", adminOnly, async (req, res) => {
  const workOrder = await workOrdersStore.get(req.params.workOrderId);
  if (!workOrder) return res.status(404).json({ error: "Work order not found" });
  const quote = workOrder.quoteId ? await quotesStore.get(workOrder.quoteId) : null;
  const invoice = await store.createFromWorkOrder(workOrder, quote, actor(req));
  res.status(201).json(invoice);
});

// Rearmar un borrador desde su orden (renglones, impuesto, descuento y pagos).
router.post("/:id/rebuild", adminOnly, async (req, res) => {
  try {
    const invoice = await store.get(req.params.id);
    if (!invoice) return res.status(404).json({ error: "Invoice not found" });
    const workOrder = await workOrdersStore.get(invoice.workOrderId);
    if (!workOrder) return res.status(404).json({ error: "Work order not found" });
    const quote = workOrder.quoteId ? await quotesStore.get(workOrder.quoteId) : null;
    res.json(await store.rebuildFromWorkOrder(req.params.id, workOrder, quote, actor(req), req.body?.mode));
  } catch (err) { res.status(400).json({ error: err.message }); }
});

router.put("/:id", adminOnly, async (req, res) => {
  const invoice = await store.update(req.params.id, req.body, actor(req));
  if (!invoice) return res.status(404).json({ error: "Invoice not found" });
  res.json(invoice);
});

router.post("/:id/send", adminOnly, async (req, res) => {
  const invoice = await store.markSent(req.params.id, actor(req), req.body?.channel);
  if (!invoice) return res.status(404).json({ error: "Invoice not found" });
  res.json(invoice);
});

// Mandar la factura por correo desde el CRM (Resend). body.to opcional: si no, el correo del cliente.
router.post("/:id/email", adminOnly, async (req, res) => {
  const invoice = await store.get(req.params.id);
  if (!invoice) return res.status(404).json({ error: "Invoice not found" });
  if (invoice.status === "Void") return res.status(400).json({ error: "Void invoices cannot be sent" });
  const to = String(req.body?.to || invoice.customerEmail || "").trim();
  if (!mailer.EMAIL_RE.test(to)) return res.status(400).json({ error: "The customer has no valid email address" });
  const frontendUrl = String(process.env.FRONTEND_URL || "").replace(/[/]$/, "");
  const publicUrl = `${frontendUrl}/invoice/view/${invoice.publicToken}`;
  const { subject, html, text } = buildInvoiceEmail({ invoice, company: companyProfileStore.get(), publicUrl, frontendUrl });
  try {
    const r = await mailer.sendEmail({ to, subject, html, text });
    store.logDelivery(invoice.id, { channel: "email_crm", to, subject, status: "sent", providerId: r.id, user: actor(req) });
    // Si la factura no tenía correo, se guarda el que se usó. Si ya tenía uno NO se pisa: mandar una
    // copia a otra dirección (una prueba, el correo de Antonio) no debe cambiar el correo del cliente.
    if (!invoice.customerEmail) store.update(invoice.id, { customerEmail: to }, actor(req));
    res.json(await store.markSent(invoice.id, actor(req), "email_crm"));
  } catch (err) {
    store.logDelivery(invoice.id, { channel: "email_crm", to, subject, status: "failed", error: err.message, user: actor(req) });
    res.status(400).json({ error: err.message });
  }
});

// Mandar la factura por SMS desde el CRM (Twilio). body.to opcional: si no, el teléfono del cliente.
router.post("/:id/sms", adminOnly, async (req, res) => {
  const invoice = await store.get(req.params.id);
  if (!invoice) return res.status(404).json({ error: "Invoice not found" });
  if (invoice.status === "Void") return res.status(400).json({ error: "Void invoices cannot be sent" });
  const to = String(req.body?.to || invoice.customerPhone || "").trim();
  const frontendUrl = String(process.env.FRONTEND_URL || "").replace(/[/]$/, "");
  const url = `${frontendUrl}/invoice/view/${invoice.publicToken}`;
  const nombre = String(invoice.customerName || "").trim().split(/\s+/)[0] || "";
  const pagada = Number(invoice.total) > 0 && Number(invoice.balance) <= 0.005;
  const text = pagada
    ? `Reyes Auto Glass Group: thank you ${nombre}! Here is your paid invoice ${invoice.invoiceNumber} ($${Number(invoice.total).toFixed(2)}): ${url}`
    : `Reyes Auto Glass Group: hi ${nombre}, here is your invoice ${invoice.invoiceNumber} for $${Number(invoice.total).toFixed(2)}: ${url} Thank you!`;
  try {
    const r = await sms.sendSms({ to, body: text });
    store.logDelivery(invoice.id, { channel: "sms_crm", to: r.to, status: "sent", providerId: r.sid, user: actor(req) });
    res.json(await store.markSent(invoice.id, actor(req), "sms_crm"));
  } catch (err) {
    store.logDelivery(invoice.id, { channel: "sms_crm", to, status: "failed", error: err.message, user: actor(req) });
    res.status(400).json({ error: err.message });
  }
});

router.post("/:id/payments", adminOnly, async (req, res) => {
  const invoice = await store.addPayment(req.params.id, req.body, actor(req));
  if (!invoice) return res.status(404).json({ error: "Invoice not found" });
  res.json(invoice);
});

router.post("/:id/void", adminOnly, async (req, res) => {
  const invoice = await store.void(req.params.id, actor(req), req.body?.reason);
  if (!invoice) return res.status(404).json({ error: "Invoice not found" });
  res.json(invoice);
});

router.delete("/:id", adminOnly, async (req, res) => {
  const ok = await store.remove(req.params.id);
  if (!ok) return res.status(404).json({ error: "Invoice not found" });
  res.status(204).end();
});

module.exports = router;
