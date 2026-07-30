const express = require("express");
const getStripe = require("../lib/stripe");
const workordersStore = require("../store/workorders.store");

const router = express.Router();

router.post("/create-checkout-session", async (req, res) => {
  const stripe = getStripe();
  const workOrder = await workordersStore.getByPaymentToken(req.body.token);
  if (!workOrder) return res.status(404).json({ error: "Payment link not found" });

  const balance = Number(workOrder.totalSale || 0) - Number(workOrder.payment?.amount || 0);
  if (balance <= 0) return res.status(400).json({ error: "This work order has no balance due" });

  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    payment_method_types: ["card"],
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
    metadata: { workOrderId: String(workOrder.id) },
  });

  res.json({ url: session.url });
});

module.exports = router;
