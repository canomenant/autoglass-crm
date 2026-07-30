const getStripe = require("../lib/stripe");
const workordersStore = require("../store/workorders.store");

module.exports = async function stripeWebhook(req, res) {
  let event;
  try {
    event = getStripe().webhooks.constructEvent(req.body, req.headers["stripe-signature"], process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object;
    const workOrderId = session.metadata?.workOrderId;
    const workOrder = workOrderId && (await workordersStore.get(workOrderId));

    if (workOrder) {
      await workordersStore.update(workOrder.id, {
        payment: {
          method: "Stripe",
          amount: Number(workOrder.payment?.amount || 0) + session.amount_total / 100,
          paid: true,
          authorizationId: session.payment_intent,
        },
        updatedBy: "Stripe Webhook",
      });
    }
  }

  res.json({ received: true });
};
