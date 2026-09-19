const express = require("express");
const getStripe = require("../lib/stripe");
const workordersStore = require("../store/workorders.store");
const stripeCards = require("../store/stripeCards.store");

const router = express.Router();

// Públicas (sin login): las abre el cliente desde el link de pago /pay/<token>. El token de pago
// de la orden es la credencial.

function balanceOf(workOrder) {
  return Math.round((Number(workOrder.totalSale || 0) - Number(workOrder.payment?.amount || 0)) * 100) / 100;
}

// Cliente de Stripe para esta orden: se reutiliza el del mismo cliente si ya guardó tarjeta antes.
async function ensureStripeCustomer(stripe, workOrder) {
  const existente = await stripeCards.stripeCustomerFor(workOrder.customerId);
  if (existente) {
    try {
      const c = await stripe.customers.retrieve(existente);
      if (c && !c.deleted) return c.id;
    } catch { /* borrado en Stripe: se crea otro */ }
  }
  const c = await stripe.customers.create({
    name: workOrder.customerName || undefined,
    email: workOrder.email || undefined,
    phone: workOrder.phone || undefined,
    metadata: { crmCustomerId: String(workOrder.customerId || ""), workOrderNo: workOrder.workOrderNo || "" },
  });
  return c.id;
}

// Pagar el saldo ahora (Checkout en modo pago). Guarda la tarjeta también, para poder cobrar
// después algún ajuste sin volver a pedirla (setup_future_usage).
router.post("/create-checkout-session", async (req, res) => {
  try {
    const stripe = getStripe();
    const workOrder = await workordersStore.getByPaymentToken(req.body.token);
    if (!workOrder) return res.status(404).json({ error: "Payment link not found" });
    const balance = balanceOf(workOrder);
    if (balance <= 0) return res.status(400).json({ error: "This work order has no balance due" });
    const customer = await ensureStripeCustomer(stripe, workOrder);
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      customer,
      payment_method_types: ["card"],
      payment_intent_data: { setup_future_usage: "off_session", description: `Work Order ${workOrder.workOrderNo}` },
      line_items: [
        {
          price_data: {
            currency: "usd",
            product_data: { name: `Work Order ${workOrder.workOrderNo}` },
            unit_amount: Math.round(balance * 100),
          },
          quantity: 1,
        },
      ],
      success_url: `${process.env.FRONTEND_URL}/payment-success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.FRONTEND_URL}/payment-cancelled`,
      metadata: { workOrderId: String(workOrder.id), workOrderNo: workOrder.workOrderNo || "" },
    });
    res.json({ url: session.url });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Guardar una tarjeta en archivo SIN cobrar (Checkout en modo setup): el cliente la captura en la
// página de Stripe al agendar y se cobra cuando el trabajo termina. Antonio, 19-sep-2026.
router.post("/create-setup-session", async (req, res) => {
  try {
    const stripe = getStripe();
    const workOrder = await workordersStore.getByPaymentToken(req.body.token);
    if (!workOrder) return res.status(404).json({ error: "Payment link not found" });
    const customer = await ensureStripeCustomer(stripe, workOrder);
    const session = await stripe.checkout.sessions.create({
      mode: "setup",
      customer,
      payment_method_types: ["card"],
      custom_text: {
        submit: {
          message: `By saving your card you authorize Reyes Auto Glass Group to charge it for work order ${workOrder.workOrderNo} once the job is completed. You will receive a receipt by email.`,
        },
      },
      success_url: `${process.env.FRONTEND_URL}/pay/${workOrder.paymentToken}?saved=1`,
      cancel_url: `${process.env.FRONTEND_URL}/pay/${workOrder.paymentToken}`,
      metadata: { workOrderId: String(workOrder.id), workOrderNo: workOrder.workOrderNo || "", purpose: "card_on_file" },
    });
    res.json({ url: session.url });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
