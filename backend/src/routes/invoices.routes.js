const express = require("express");
const { actorFrom: actor } = require("../lib/actor");
const store = require("../store/invoices.store");
const workOrdersStore = require("../store/workorders.store");
const quotesStore = require("../store/quotes.store");
const { requireAuth, requireRole } = require("../middleware/auth");

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

router.put("/:id", adminOnly, async (req, res) => {
  const invoice = await store.update(req.params.id, req.body, actor(req));
  if (!invoice) return res.status(404).json({ error: "Invoice not found" });
  res.json(invoice);
});

router.post("/:id/send", adminOnly, async (req, res) => {
  const invoice = await store.markSent(req.params.id, actor(req));
  if (!invoice) return res.status(404).json({ error: "Invoice not found" });
  res.json(invoice);
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
