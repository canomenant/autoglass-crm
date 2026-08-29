const express = require("express");
const store = require("../store/workorders.store");
const notificationsStore = require("../store/workOrderNotifications.store");
const techniciansStore = require("../store/technicians.store");
const insuranceStore = require("../store/insurance.store");
const quotesStore = require("../store/quotes.store");
const { requireAuth, requireRole } = require("../middleware/auth");

const router = express.Router();

async function withInsuranceName(workOrder) {
  if (!workOrder) return workOrder;
  const company = workOrder.insuranceCompanyId ? await insuranceStore.get(workOrder.insuranceCompanyId) : null;
  return { ...workOrder, insuranceCompanyName: company?.name || "" };
}

// El técnico de la orden puede ser el principal o uno de los adicionales: los dos la trabajaron y
// los dos tienen que poder verla y marcarla completada.
function worksIt(workOrder, technicianId) {
  if (!technicianId) return false;
  if (workOrder.technicianId === technicianId) return true;
  return (workOrder.extraTechs || []).some((t) => String(t?.technicianId || "") === String(technicianId));
}

async function ownsWorkOrder(user, workOrder) {
  if (!user) return false;
  if (user.role === "ADMIN") return true;
  if (user.role === "TECHNICIAN") return worksIt(workOrder, user.entityId);
  if (user.role === "AGENT") {
    const quote = workOrder.quoteId ? await quotesStore.get(workOrder.quoteId) : null;
    return quote ? quote.agentId === user.entityId : false;
  }
  return false;
}

// Lo que el técnico necesita para hacer el trabajo, y nada más.
//
// Es una lista blanca, no una lista negra: un campo nuevo en mapWorkOrder() no se filtra solo
// por haberse añadido. Antes esta ruta devolvía el objeto completo, y como el enlace va por SMS
// y no caduca, un mensaje reenviado entregaba:
//   - paymentToken, que ES la credencial del link de pago del cliente;
//   - laborCost / glassCost / commission, los márgenes internos;
//   - internalNotes, que son notas explícitamente internas;
//   - policyNumber / claimNumber, suficientes para suplantar al cliente ante la aseguradora;
//   - publicAccessLog, el propio registro de auditoría con las IP de accesos anteriores.
//
// GET /pay/:token ya proyectaba sólo sus cuatro campos; esto es el mismo patrón.
function projectForMobileLink(workOrder) {
  return {
    id: workOrder.id,
    workOrderNo: workOrder.workOrderNo,
    status: workOrder.status,
    customerName: workOrder.customerName,
    phone: workOrder.phone,
    address: workOrder.address,
    vehicle: workOrder.vehicle,
    jobType: workOrder.jobType,
    glassType: workOrder.glassType,
    partNumber: workOrder.partNumber,
    nagsDescription: workOrder.nagsDescription,
    appointmentDate: workOrder.appointmentDate,
    appointmentTime: workOrder.appointmentTime,
    appointmentDurationMinutes: workOrder.appointmentDurationMinutes,
    specialInstructions: workOrder.specialInstructions,
    techInstructions: workOrder.techInstructions,
    techPhotos: workOrder.techPhotos,
    insuranceCompanyName: workOrder.insuranceCompanyName || "",
  };
}

// Public: SMS-shared mobile link, no login required (relies on the unguessable token)
router.get("/mobile/:token", async (req, res) => {
  const workOrder = await store.getByToken(req.params.token);
  if (!workOrder) return res.status(404).json({ error: "Work order not found" });
  res.json(projectForMobileLink(await withInsuranceName(workOrder)));
});

// Public: the technician's mobile link writing back. The token is the credential — it identifies
// the work order and authorizes the write in one step, so there is no way to reach this with an id
// alone. Only status and techPhotos are writable, and the store records every change.
router.put("/mobile/:token", async (req, res) => {
  const workOrder = await store.updateFromMobileLink(req.params.token, req.body);
  if (!workOrder) return res.status(404).json({ error: "Work order not found" });
  res.json(projectForMobileLink(await withInsuranceName(workOrder)));
});

// Revoking a leaked link. Admin only: this is the control that makes "no expiry" safe.
router.post("/:id/mobile-link/regenerate", requireAuth, requireRole("ADMIN"), async (req, res) => {
  const workOrder = await store.regenerateMobileToken(req.params.id, req.user.name);
  if (!workOrder) return res.status(404).json({ error: "Work order not found" });
  res.json({ token: workOrder.publicToken });
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

// Las notificaciones de la campana del header: completadas sin cobrar, con el mismo alcance por
// rol que la lista. Va ANTES de /:id para que "pending-payment" no se interprete como un id.
router.get("/pending-payment", requireAuth, requireRole("ADMIN", "AGENT", "TECHNICIAN"), async (req, res) => {
  const scope =
    req.user.role === "TECHNICIAN"
      ? { technicianId: req.user.entityId }
      : req.user.role === "AGENT"
        ? { agentId: req.user.entityId }
        : {};
  res.json(await store.listPendingPayment({ limit: 10, ...scope }));
});

router.get("/", requireAuth, requireRole("ADMIN", "AGENT", "TECHNICIAN"), async (req, res) => {
  let workOrders = await store.list();
  if (req.user.role === "TECHNICIAN") {
    workOrders = workOrders.filter((w) => worksIt(w, req.user.entityId));
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

// El rol dice "puede existir una orden que le pertenezca"; la propiedad dice "ésta es". GET /:id
// justo debajo ya hacía las dos comprobaciones — ésta se había quedado sólo con la primera, así
// que cualquier técnico o agente leía, iterando ids, el histórico de notificaciones de todas las
// órdenes de la empresa: teléfonos de todos los técnicos y quién recibió qué trabajo y cuándo.
router.get("/:id/notifications", requireAuth, requireRole("ADMIN", "AGENT", "TECHNICIAN"), async (req, res) => {
  const workOrder = await store.get(req.params.id);
  if (!workOrder) return res.status(404).json({ error: "Work order not found" });
  // 404 y no 403: un 403 confirma que la orden existe, que es justo lo que busca quien enumera.
  if (!(await ownsWorkOrder(req.user, workOrder))) {
    return res.status(404).json({ error: "Work order not found" });
  }
  res.json(await notificationsStore.list(req.params.id));
});

router.get("/:id", requireAuth, requireRole("ADMIN", "AGENT", "TECHNICIAN"), async (req, res) => {
  const workOrder = await store.get(req.params.id);
  if (!workOrder) return res.status(404).json({ error: "Work order not found" });
  if (!(await ownsWorkOrder(req.user, workOrder))) return res.status(403).json({ error: "Access Denied" });
  res.json(await withInsuranceName(workOrder));
});

// requireAuth, not optionalAuth. This route used to fall through to a credential-free branch for
// the technician's mobile link, which meant the work order's id was the only thing standing between
// anyone and a status change — and an id is not a secret: it sits in the dashboard URL, in API
// responses, in browser history. The mobile link now has its own route, PUT /mobile/:token, where
// the token both identifies the order and authorizes the write.
router.put("/:id", requireAuth, async (req, res) => {
  const workOrder = await store.get(req.params.id);
  if (!workOrder) return res.status(404).json({ error: "Work order not found" });

  let data = req.body;

  if (req.user.role === "ADMIN") {
    // full access, no restriction
  } else if (req.user.role === "TECHNICIAN") {
    if (!worksIt(workOrder, req.user.entityId)) return res.status(403).json({ error: "Access Denied" });
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
