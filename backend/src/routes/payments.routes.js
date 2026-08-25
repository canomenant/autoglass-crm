const express = require("express");
const store = require("../store/payments.store");
const notesStore = require("../store/notes.store");

const router = express.Router();

function actor(req) {
  return req.body?.performedBy || req.query?.performedBy || "System";
}

router.get("/", async (req, res) => {
  let payments = await store.list(req.query);
  if (req.user.role === "AGENT") {
    payments = payments.filter((p) => p.type === "AGENT" && p.agentId === req.user.entityId);
  }
  res.json(payments);
});

router.get("/dashboard", async (req, res) => {
  if (req.user.role !== "ADMIN") return res.status(403).json({ error: "Access Denied" });
  const [paymentsDashboard, creditDashboard, debitDashboard, netFinancialAdjustments] = await Promise.all([
    store.dashboard(), notesStore.dashboard("CREDIT"), notesStore.dashboard("DEBIT"), notesStore.netFinancialAdjustments(),
  ]);
  res.json({
    ...paymentsDashboard,
    activeCreditNotes: creditDashboard.active,
    activeDebitNotes: debitDashboard.active,
    creditsAppliedThisMonth: creditDashboard.appliedThisMonth,
    debitsAppliedThisMonth: debitDashboard.appliedThisMonth,
    outstandingCredits: creditDashboard.outstanding,
    outstandingDebits: debitDashboard.outstanding,
    netFinancialAdjustments,
  });
});

function ownsPayment(req, payment) {
  return req.user.role === "ADMIN" || (payment.type === "AGENT" && payment.agentId === req.user.entityId);
}

// Las partes que pueden aparecer en el filtro, segun el tipo de lote elegido.
router.get("/parties/:type", async (req, res) => res.json({ parties: await store.partiesForType(req.params.type) }));

router.get("/:id", async (req, res) => {
  const payment = await store.get(req.params.id);
  if (!payment) return res.status(404).json({ error: "Payment not found" });
  if (!ownsPayment(req, payment)) return res.status(403).json({ error: "Access Denied" });
  res.json(payment);
});

router.get("/:id/notes", async (req, res) => {
  const payment = await store.get(req.params.id);
  if (!payment) return res.status(404).json({ error: "Payment not found" });
  if (!ownsPayment(req, payment)) return res.status(403).json({ error: "Access Denied" });
  res.json(await notesStore.listByPayment(req.params.id));
});

router.post("/", async (req, res) => {
  const payment = await store.create(req.body, actor(req));
  res.status(201).json(payment);
});

router.put("/:id", async (req, res) => {
  const payment = await store.update(req.params.id, req.body, actor(req));
  if (!payment) return res.status(404).json({ error: "Payment not found" });
  res.json(payment);
});

router.post("/:id/mark-ready", async (req, res) => {
  const payment = await store.markReady(req.params.id, actor(req));
  if (!payment) return res.status(404).json({ error: "Payment not found" });
  res.json(payment);
});

router.post("/:id/approve", async (req, res) => {
  const payment = await store.approve(req.params.id, actor(req));
  if (!payment) return res.status(404).json({ error: "Payment not found" });
  res.json(payment);
});

router.post("/:id/pay", async (req, res) => {
  const payment = await store.markPaid(req.params.id, actor(req), req.body);
  if (!payment) return res.status(404).json({ error: "Payment not found" });
  res.json(payment);
});

router.post("/:id/cancel", async (req, res) => {
  const payment = await store.cancel(req.params.id, actor(req), req.body?.reason);
  if (!payment) return res.status(404).json({ error: "Payment not found" });
  res.json(payment);
});

router.delete("/:id", async (req, res) => {
  const ok = await store.remove(req.params.id);
  if (!ok) return res.status(404).json({ error: "Payment not found" });
  res.status(204).end();
});

module.exports = router;
