const express = require("express");
const jwt = require("jsonwebtoken");
const store = require("../store/workorders.store");
const notificationsStore = require("../store/workOrderNotifications.store");
const techniciansStore = require("../store/technicians.store");
const insuranceStore = require("../store/insurance.store");
const quotesStore = require("../store/quotes.store");
const { requireAuth, requireRole } = require("../middleware/auth");

const router = express.Router();

function optionalAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) {
    req.user = null;
    return next();
  }
  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
  } catch {
    req.user = null;
  }
  next();
}

async function withInsuranceName(workOrder) {
  if (!workOrder) return workOrder;
  const company = workOrder.insuranceCompanyId ? await insuranceStore.get(workOrder.insuranceCompanyId) : null;
  return { ...workOrder, insuranceCompanyName: company?.name || "" };
}

async function ownsWorkOrder(user, workOrder) {
  if (!user) return false;
  if (user.role === "ADMIN") return true;
  if (user.role === "TECHNICIAN") return workOrder.technicianId === user.entityId;
  if (user.role === "AGENT") {
    const quote = workOrder.quoteId ? await quotesStore.get(workOrder.quoteId) : null;
    return quote ? quote.agentId === user.entityId : false;
  }
  return false;
}

// Public: SMS-shared mobile link, no login required (relies on the unguessable token)
router.get("/mobile/:token", async (req, res) => {
  const workOrder = await store.getByToken(req.params.token);
  if (!workOrder) return res.status(404).json({ error: "Work order not found" });
  res.json(await withInsuranceName(workOrder));
});

// Public: customer payment link, no login required (relies on the unguessable token)
router.get("/pay/:token", async (req, res) => {
  const workOrder = await store.getByPaymentToken(req.params.token);
  if (!workOrder) return res.status(404).json({ error: "Payment link not found" });
  res.json({
    workOrderNo: workOrder.workOrderNo,
    customerName: workOrder.customerName,
    totalSale: workOrder.totalSale,
    payment: { amount: workOrder.payment.amount, paid: workOrder.payment.paid },
  });
});

router.post("/:id/payment-link", requireAuth, requireRole("ADMIN", "AGENT"), async (req, res) => {
  const workOrder = await store.ensurePaymentToken(req.params.id);
  if (!workOrder) return res.status(404).json({ error: "Work order not found" });
  res.json({ token: workOrder.paymentToken });
});

router.get("/", requireAuth, requireRole("ADMIN", "AGENT", "TECHNICIAN"), async (req, res) => {
  let workOrders = await store.list();
  if (req.user.role === "TECHNICIAN") {
    workOrders = workOrders.filter((w) => w.technicianId === req.user.entityId);
  } else if (req.user.role === "AGENT") {
    const quotes = await quotesStore.list();
    const ownedQuoteIds = new Set(quotes.filter((q) => q.agentId === req.user.entityId).map((q) => q.id));
    workOrders = workOrders.filter((w) => ownedQuoteIds.has(w.quoteId));
  }

  // Backward-compatible: only paginate/shape the response when the caller opts in via
  // limit/offset. Every other consumer (dashboard, reports, header search, quickView) calls
  // this with no params and expects the full plain array, unchanged.
  const isPaginated = req.query.limit !== undefined || req.query.offset !== undefined;
  if (!isPaginated) {
    const notifMap = await notificationsStore.latestByWorkOrderIds(workOrders.map((w) => w.id));
    return res.json(workOrders.map((w) => ({ ...w, lastNotification: notifMap[w.id] || null })));
  }

  const { status, type, search, sortBy, sortDir, limit, offset } = req.query;
  const counts = store.summarize(workOrders);
  const { data, total } = store.query({ status, type, search, sortBy, sortDir, limit, offset, scope: workOrders });
  const notifMap = await notificationsStore.latestByWorkOrderIds(data.map((w) => w.id));
  res.json({
    data: data.map((w) => ({ ...w, lastNotification: notifMap[w.id] || null })),
    total,
    counts,
  });
});

router.get("/:id/notifications", requireAuth, requireRole("ADMIN", "AGENT", "TECHNICIAN"), async (req, res) => {
  res.json(await notificationsStore.list(req.params.id));
});

router.get("/:id", requireAuth, requireRole("ADMIN", "AGENT", "TECHNICIAN"), async (req, res) => {
  const workOrder = await store.get(req.params.id);
  if (!workOrder) return res.status(404).json({ error: "Work order not found" });
  if (!(await ownsWorkOrder(req.user, workOrder))) return res.status(403).json({ error: "Access Denied" });
  res.json(await withInsuranceName(workOrder));
});

router.put("/:id", optionalAuth, async (req, res) => {
  const workOrder = await store.get(req.params.id);
  if (!workOrder) return res.status(404).json({ error: "Work order not found" });

  let data = req.body;

  if (!req.user) {
    // Public mobile link: same restricted fields as a logged-in technician
    data = { status: data.status, techPhotos: data.techPhotos };
  } else if (req.user.role === "ADMIN") {
    // full access, no restriction
  } else if (req.user.role === "TECHNICIAN") {
    if (workOrder.technicianId !== req.user.entityId) return res.status(403).json({ error: "Access Denied" });
    data = { status: data.status, techPhotos: data.techPhotos, specialInstructions: data.specialInstructions };
  } else if (req.user.role === "AGENT") {
    if (!(await ownsWorkOrder(req.user, workOrder))) return res.status(403).json({ error: "Access Denied" });
    // full access to the work orders they own, same as editing the underlying quote
  } else {
    return res.status(403).json({ error: "Access Denied" });
  }

  if (req.user) data.updatedBy = req.user.name;

  const updated = await store.update(req.params.id, data);
  res.json(updated);
});

router.post("/:id/assign-tech", requireAuth, requireRole("ADMIN"), async (req, res) => {
  const technician = await techniciansStore.get(req.body.technicianId);
  if (!technician) return res.status(404).json({ error: "Technician not found" });
  const workOrder = await store.assignTech(req.params.id, technician.id, technician.name);
  if (!workOrder) return res.status(404).json({ error: "Work order not found" });
  res.json(workOrder);
});

router.post("/:id/notify", requireAuth, requireRole("ADMIN"), async (req, res) => {
  const workOrder = await store.get(req.params.id);
  if (!workOrder) return res.status(404).json({ error: "Work order not found" });
  if (!workOrder.technicianId) return res.status(400).json({ error: "Assign a technician first" });

  const technician = await techniciansStore.get(workOrder.technicianId);
  const methods = Array.isArray(req.body.methods) && req.body.methods.length ? req.body.methods : ["SMS"];
  const message = req.body.message || "";

  const created = await Promise.all(
    methods.map((method) =>
      notificationsStore.create({
        workOrderId: workOrder.id,
        technicianId: workOrder.technicianId,
        method,
        recipient: method === "SMS" ? technician?.phone || "" : `${req.protocol}://${req.get("host")}`,
        message,
      })
    )
  );

  res.status(201).json(created);
});

router.delete("/:id", requireAuth, requireRole("ADMIN"), async (req, res) => {
  if (!(await store.remove(req.params.id))) return res.status(404).json({ error: "Work order not found" });
  res.status(204).end();
});

module.exports = router;
