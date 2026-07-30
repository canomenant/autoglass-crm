const Stripe = require("stripe");

let client = null;

module.exports = function getStripe() {
  if (!client) client = new Stripe(process.env.STRIPE_SECRET_KEY);
  return client;
};
