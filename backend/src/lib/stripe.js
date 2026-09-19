const Stripe = require("stripe");

let client = null;

module.exports = function getStripe() {
  // .trim(): una llave pegada en Railway con Enter al final da "An error occurred with our
  // connection to Stripe" en vez de "Invalid API Key", y cuesta horas encontrarlo (19-sep-2026).
  if (!client) client = new Stripe(String(process.env.STRIPE_SECRET_KEY || "").trim());
  return client;
};
