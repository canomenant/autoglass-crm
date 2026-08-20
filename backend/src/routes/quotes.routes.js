const express = require("express");
const quotesStore = require("../store/quotes.store");
const workOrdersStore = require("../store/workorders.store");
const intakeNotificationsStore = require("../store/quoteIntakeNotifications.store");

const router = express.Router();

function ownsQuote(req, quote) {
  return req.user.role === "ADMIN" || quote.agentId === req.user.entityId;
}

router.get("/", async (req, res) => {
  let quotes = await quotesStore.list();
  if (req.user.role === "AGENT") quotes = quotes.filter((q) => q.agentId === req.user.entityId);
  res.json(quotes);
});

router.get("/:id", async (req, res) => {
  const quote = await quotesStore.get(req.params.id);
  if (!quote) return res.status(404).json({ error: "Quote not found" });
  if (!ownsQuote(req, quote)) return res.status(403).json({ error: "Access Denied" });
  res.json(quote);
});

router.post("/", async (req, res) => {
  const data = { ...req.body, createdBy: req.user.name };
  if (req.user.role === "AGENT") {
    data.agentId = req.user.entityId;
    data.agentName = req.user.name;
  }
  const quote = await quotesStore.create(data);
  res.status(201).json(quote);
});

router.put("/:id", async (req, res) => {
  const existing = await quotesStore.get(req.params.id);
  if (!existing) return res.status(404).json({ error: "Quote not found" });
  if (!ownsQuote(req, existing)) return res.status(403).json({ error: "Access Denied" });

  // Not a quote field — it's the user's answer to the "this order is already paid" prompt,
  // pulled out so it can't be mistaken for something to store.
  const { confirmPriceChange, ...body } = req.body;
  const data = { ...body, updatedBy: req.user.name };
  if (req.user.role === "AGENT") {
    delete data.agentId;
    delete data.agentName;
  }

  try {
    const quote = await quotesStore.update(req.params.id, data, {
      confirmPriceChange: confirmPriceChange === true,
      actor: req.user.name,
    });
    res.json(quote);
  } catch (err) {
    // 409 and nothing written: the client shows the old and new figure and re-sends the same
    // body with confirmPriceChange once the user has agreed to it.
    if (err.code === "PAID_WORK_ORDER_PRICE_CHANGE") {
      return res.status(409).json({ error: err.message, requiresConfirmation: true, ...err.details });
    }
    throw err;
  }
});

router.delete("/:id", async (req, res) => {
  if (req.user.role !== "ADMIN") return res.status(403).json({ error: "Access Denied" });
  const ok = await quotesStore.remove(req.params.id);
  if (!ok) return res.status(404).json({ error: "Quote not found" });
  res.status(204).end();
});

router.post("/:id/intake/send", async (req, res) => {
  const quote = await quotesStore.get(req.params.id);
  if (!quote) return res.status(404).json({ error: "Quote not found" });
  if (!ownsQuote(req, quote)) return res.status(403).json({ error: "Access Denied" });

  const updated = await quotesStore.sendIntake(req.params.id, { expiresInDays: req.body.expiresInDays });

  const link = `${req.body.baseUrl || `${req.protocol}://${req.get("host")}`}/intake/${updated.intakeToken}`;
  const methods = Array.isArray(req.body.methods) && req.body.methods.length ? req.body.methods : ["SMS"];
  const message = req.body.message || "";
  const contact = updated.customerType === "New" ? updated.newCustomer : {};

  const created = await Promise.all(
    methods.map((method) =>
      intakeNotificationsStore.create({
        quoteId: updated.id,
        method,
        recipient: method === "SMS" ? contact.phone || "" : contact.email || "",
        message,
      })
    )
  );

  res.json({ quote: updated, link, notifications: created });
});

router.get("/:id/intake/notifications", async (req, res) => {
  const quote = await quotesStore.get(req.params.id);
  if (!quote) return res.status(404).json({ error: "Quote not found" });
  if (!ownsQuote(req, quote)) return res.status(403).json({ error: "Access Denied" });
  res.json(await intakeNotificationsStore.list(req.params.id));
});

router.post("/:id/convert", async (req, res) => {
  const quote = await quotesStore.get(req.params.id);
  if (!quote) return res.status(404).json({ error: "Quote not found" });
  if (!ownsQuote(req, quote)) return res.status(403).json({ error: "Access Denied" });
  if (quote.status !== "Approved") return res.status(400).json({ error: "Only Approved quotes can be converted to a Work Order" });

  const workOrder = await workOrdersStore.createFromQuote(quote, req.user.name);
  await quotesStore.markConverted(quote.id);
  res.status(201).json(workOrder);
});

module.exports = router;
