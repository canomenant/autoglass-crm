const getStripe = require("../lib/stripe");
const workordersStore = require("../store/workorders.store");
const stripeCards = require("../store/stripeCards.store");
const { sendPaymentReceipt } = require("../lib/paymentReceipt");

// Avisos de Stripe (POST /api/checkout/webhook, cuerpo crudo para verificar la firma).
//  - checkout.session.completed en modo "payment": el cliente pagó por el link → se registra el
//    pago en la orden y se le manda el recibo. Si además guardó tarjeta (setup_future_usage) se
//    registra en stripe_cards para cobros posteriores.
//  - checkout.session.completed en modo "setup": el cliente guardó tarjeta en archivo (sin
//    cobrar) → se registra la referencia (nunca el número) en stripe_cards.
module.exports = async function stripeWebhook(req, res) {
  let event;
  try {
    event = getStripe().webhooks.constructEvent(req.body, req.headers["stripe-signature"], String(process.env.STRIPE_WEBHOOK_SECRET || "").trim());
  } catch (err) {
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {
    if (event.type === "checkout.session.completed" && event.data.object.metadata?.purpose === "lead") {
      // Un comprador pagó un lead: se lo queda (los demás pierden), se le entrega el paquete y
      // se avisa al cliente. Si otro pagó primero, markPaid no cambia nada (queda para reembolso manual).
      const session = event.data.object;
      const leadSales = require("../store/leadSales.store");
      const leads = require("../lib/leads");
      const sale = await leadSales.get(Number(session.metadata.leadSaleId));
      if (!sale) return res.json({ received: true, ignored: "no lead sale" });
      const offer = sale.offers.find((o) => o.token === session.metadata.token);
      const paid = await leadSales.markPaid(sale.id, { buyerId: offer?.buyerId, buyerName: offer?.buyerName, via: "stripe", ref: session.payment_intent });
      if (paid.status === "paid" && paid.buyerId === offer?.buyerId) {
        const wo = await workordersStore.get(sale.workOrderId);
        await leads.deliver(paid, wo);
      } else {
        console.error("[leads] pago de un lead ya vendido:", sale.id, "comprador", offer?.buyerId, "pi", session.payment_intent);
      }
      return res.json({ received: true });
    }

    if (event.type === "checkout.session.completed") {
      const session = event.data.object;
      const workOrderId = session.metadata?.workOrderId;
      const workOrder = workOrderId && (await workordersStore.get(workOrderId));
      if (!workOrder) return res.json({ received: true, ignored: "no work order" });
      const stripe = getStripe();

      if (session.mode === "setup") {
        await guardarTarjeta(stripe, workOrder, session.setup_intent, session.customer, event.livemode);
      } else if (session.mode === "payment") {
        const amount = session.amount_total / 100;
        const updated = await workordersStore.update(workOrder.id, {
          payment: {
            method: "Stripe",
            amount: Number(workOrder.payment?.amount || 0) + amount,
            paid: true,
            authorizationId: session.payment_intent,
          },
          updatedBy: "Stripe Webhook",
        });
        // Tarjeta usada en el pago: guardarla para cobros posteriores (setup_future_usage).
        try {
          const pi = await stripe.paymentIntents.retrieve(session.payment_intent, { expand: ["payment_method"] });
          if (pi.payment_method && typeof pi.payment_method === "object" && pi.customer) {
            await registrar(workOrder, pi.payment_method, pi.customer, event.livemode);
          }
        } catch (e) {
          console.error("[stripe] no se pudo guardar la tarjeta del pago:", e.message);
        }
        await sendPaymentReceipt(updated || workOrder, { trigger: "stripe_link", actor: "Stripe Webhook" });
      }
    }
  } catch (err) {
    // Se responde 200 igual: Stripe reintentaría el evento y el pago ya quedó (o el error es nuestro).
    console.error("[stripe webhook]", event.type, err.message);
  }
  res.json({ received: true });
};

async function guardarTarjeta(stripe, workOrder, setupIntentId, customerId, livemode) {
  if (!setupIntentId) return;
  const si = await stripe.setupIntents.retrieve(setupIntentId, { expand: ["payment_method"] });
  if (si.payment_method && typeof si.payment_method === "object") {
    await registrar(workOrder, si.payment_method, customerId || si.customer, livemode);
  }
}

async function registrar(workOrder, pm, customerId, livemode) {
  const card = pm.card || {};
  await stripeCards.save({
    workOrderId: workOrder.id,
    customerId: workOrder.customerId,
    stripeCustomerId: typeof customerId === "object" ? customerId.id : customerId,
    paymentMethodId: pm.id,
    brand: card.brand || pm.type || "",
    last4: card.last4 || "",
    expMonth: card.exp_month || null,
    expYear: card.exp_year || null,
    fingerprint: card.fingerprint || null,
    livemode: Boolean(livemode),
  });
}
