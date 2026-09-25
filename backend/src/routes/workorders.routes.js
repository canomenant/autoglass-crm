const express = require("express");
const store = require("../store/workorders.store");
const notificationsStore = require("../store/workOrderNotifications.store");
const techniciansStore = require("../store/technicians.store");
const insuranceStore = require("../store/insurance.store");
const quotesStore = require("../store/quotes.store");
const techMessageConfig = require("../store/techMessageConfig.store");
const { valueOf } = require("../lib/techMessageFields");
const { requireAuth, requireRole } = require("../middleware/auth");
const stripeCards = require("../store/stripeCards.store");
const getStripe = require("../lib/stripe");
const { sendPaymentReceipt } = require("../lib/paymentReceipt");
const sms = require("../lib/sms");
const customerMessages = require("../store/customerMessages.store");

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
  // Los agentes se cubren entre sí: cuando uno no está, otro atiende a su cliente. Por eso un
  // agente puede ver y editar cualquier orden, no sólo las de sus cotizaciones (Antonio,
  // 20-sep-2026). Lo que sigue siendo suyo y de nadie más son sus comisiones (payments).
  if (user.role === "AGENT") return true;
  return false;
}

// Si la orden salió de una cotización del agente que pregunta. Sólo informa (tarjeta "Tu
// comisión", filtro "Mis órdenes"); ya no decide el acceso.
async function isMineFor(user, workOrder) {
  if (user.role !== "AGENT") return undefined;
  const quote = workOrder.quoteId ? await quotesStore.get(workOrder.quoteId) : null;
  return quote ? quote.agentId === user.entityId : false;
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
//
// Desde el 18-sep-2026 el detalle lo decide Settings → "Technician Message" (columna Mobile): solo
// viajan los campos prendidos ahí, en su orden y con su etiqueta (`mobileFields`). Lo esencial para
// que la pantalla funcione —estado, teléfono y dirección para los botones, fotos— va siempre.
// Póliza y claim siguen fuera: "Insurance" en el móvil es solo el nombre de la aseguradora.
async function projectForMobileLink(workOrder) {
  const quote = workOrder.quoteId ? await quotesStore.get(workOrder.quoteId).catch(() => null) : null;
  const config = techMessageConfig.get();
  const mobileFields = config.fields
    .filter((f) => f.mobile)
    .map((f) => ({ key: f.key, label: f.label, value: valueOf(f.key, workOrder, quote, config) }))
    .filter((f) => f.value || !config.fields.find((x) => x.key === f.key)?.skipEmpty);
  return {
    id: workOrder.id,
    workOrderNo: workOrder.workOrderNo,
    status: workOrder.status,
    customerName: workOrder.customerName,
    phone: workOrder.phone,
    address: workOrder.address,
    techPhotos: workOrder.techPhotos,
    mobileFields,
  };
}

// Public: SMS-shared mobile link, no login required (relies on the unguessable token)
router.get("/mobile/:token", async (req, res) => {
  const workOrder = await store.getByToken(req.params.token);
  if (!workOrder) return res.status(404).json({ error: "Work order not found" });
  res.json(await projectForMobileLink(await withInsuranceName(workOrder)));
});

// Public: the technician's mobile link writing back. The token is the credential — it identifies
// the work order and authorizes the write in one step, so there is no way to reach this with an id
// alone. Only status and techPhotos are writable, and the store records every change.
router.put("/mobile/:token", async (req, res) => {
  const workOrder = await store.updateFromMobileLink(req.params.token, req.body);
  if (!workOrder) return res.status(404).json({ error: "Work order not found" });
  res.json(await projectForMobileLink(await withInsuranceName(workOrder)));
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
  const card = await stripeCards.forWorkOrder(workOrder.id, workOrder.customerId);
  res.json({
    workOrderNo: workOrder.workOrderNo,
    customerName: workOrder.customerName,
    totalSale: workOrder.totalSale,
    payment: { amount: workOrder.payment.amount, paid: workOrder.payment.paid },
    cardOnFile: stripeCards.publicView(card),
  });
});

// Tarjeta en archivo de la orden (o del mismo cliente en otra orden). Solo marca/últimos 4.
router.get("/:id/card-on-file", requireAuth, requireRole("ADMIN", "AGENT"), async (req, res) => {
  const workOrder = await store.get(req.params.id);
  if (!workOrder) return res.status(404).json({ error: "Work order not found" });
  const card = await stripeCards.forWorkOrder(workOrder.id, workOrder.customerId);
  res.json({ card: stripeCards.publicView(card) });
});

// Quitar la tarjeta en archivo (se revoca aquí y se desliga en Stripe).
router.delete("/:id/card-on-file", requireAuth, requireRole("ADMIN"), async (req, res) => {
  const workOrder = await store.get(req.params.id);
  if (!workOrder) return res.status(404).json({ error: "Work order not found" });
  const card = await stripeCards.forWorkOrder(workOrder.id, workOrder.customerId);
  if (!card) return res.status(404).json({ error: "No card on file" });
  await stripeCards.revoke(card.id, req.user?.name);
  try { await getStripe().paymentMethods.detach(card.paymentMethodId); } catch (e) { console.error("[stripe] detach:", e.message); }
  res.json({ ok: true });
});

// Cobrar a la tarjeta en archivo (sin que el cliente haga nada): el saldo, o el monto que se pida.
// Antonio, 19-sep-2026. Éxito → pago Stripe en la orden + recibo por correo.
router.post("/:id/charge-card", requireAuth, requireRole("ADMIN", "AGENT"), async (req, res) => {
  const workOrder = await store.get(req.params.id);
  if (!workOrder) return res.status(404).json({ error: "Work order not found" });
  if (req.user.role === "AGENT" && !(await ownsWorkOrder(req.user, workOrder))) return res.status(403).json({ error: "Access Denied" });
  const card = await stripeCards.forWorkOrder(workOrder.id, workOrder.customerId);
  if (!card) return res.status(400).json({ error: "This order has no card on file" });
  const balance = Math.round((Number(workOrder.totalSale || 0) - Number(workOrder.payment?.amount || 0)) * 100) / 100;
  const amount = req.body?.amount !== undefined && req.body.amount !== "" ? Math.round(Number(req.body.amount) * 100) / 100 : balance;
  if (!(amount > 0)) return res.status(400).json({ error: "Amount must be greater than zero" });
  if (amount > balance + 0.005) return res.status(400).json({ error: `Amount exceeds the balance due (${balance.toFixed(2)})` });
  let pi;
  try {
    pi = await getStripe().paymentIntents.create({
      amount: Math.round(amount * 100),
      currency: "usd",
      customer: card.stripeCustomerId,
      payment_method: card.paymentMethodId,
      off_session: true,
      confirm: true,
      description: `Work Order ${workOrder.workOrderNo} — ${workOrder.customerName || ""}`.trim(),
      metadata: { workOrderId: String(workOrder.id), workOrderNo: workOrder.workOrderNo || "", chargedBy: req.user?.name || "" },
      receipt_email: /@/.test(workOrder.email || "") ? workOrder.email : undefined,
    });
  } catch (err) {
    // Rechazada, vencida, o el banco exige autenticación: hay que mandarle el link para que pague él.
    const code = err.code || err.decline_code || err.type || "";
    const msg = err.raw?.message || err.message;
    return res.status(402).json({ error: msg, code, needsCustomer: code === "authentication_required" });
  }
  if (pi.status !== "succeeded") return res.status(402).json({ error: `Payment not completed (status: ${pi.status})`, code: pi.status });
  const updated = await store.update(workOrder.id, {
    payment: {
      method: "Stripe",
      amount: Math.round((Number(workOrder.payment?.amount || 0) + amount) * 100) / 100,
      paid: Number(workOrder.payment?.amount || 0) + amount >= Number(workOrder.totalSale || 0) - 0.005,
      authorizationId: pi.id,
    },
    updatedBy: req.user?.name || "System",
  });
  const receipt = await sendPaymentReceipt(updated, { trigger: "card_on_file", actor: req.user?.name || "System" });
  res.json({ workOrder: updated, charged: amount, paymentIntent: pi.id, card: stripeCards.publicView(card), receipt });
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
    // ?scope=all: el agente ve las órdenes de TODOS los agentes, completas (pedido de Antonio,
    // 20-sep-2026). Sin scope, sólo las suyas, que es como abre la lista.
    if (req.query.scope === "all") {
      workOrders = workOrders.map((w) => ({ ...w, isMine: ownedQuoteIds.has(w.quoteId) }));
    } else {
      workOrders = workOrders.filter((w) => ownedQuoteIds.has(w.quoteId)).map((w) => ({ ...w, isMine: true }));
    }
  }

  // Backward-compatible: only paginate/shape the response when the caller opts in via
  // limit/offset. Every other consumer (dashboard, reports, header search, quickView) calls
  // this with no params and expects the full plain array, unchanged.
  const isPaginated = req.query.limit !== undefined || req.query.offset !== undefined;
  if (!isPaginated) {
    const notifMap = await notificationsStore.latestByWorkOrderIds(workOrders.map((w) => w.id));
    return res.json(workOrders.map((w) => ({ ...w, lastNotification: notifMap[w.id] || null })));
  }

  const { status, type, search, sortBy, sortDir, limit, offset, dateFrom, dateTo } = req.query;
  const counts = store.summarize(workOrders);
  const { data, total } = store.query({ status, type, search, sortBy, sortDir, limit, offset, dateFrom, dateTo, scope: workOrders });
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

// La comisión del agente según su plan: lo aplicado, o lo estimado si la orden aún no se paga.
router.get("/:id/commission", requireAuth, requireRole("ADMIN", "AGENT"), async (req, res) => {
  const workOrder = await store.get(req.params.id);
  if (!workOrder) return res.status(404).json({ error: "Work order not found" });
  if (!(await ownsWorkOrder(req.user, workOrder))) return res.status(403).json({ error: "Access Denied" });
  res.json(await store.commissionInfo(req.params.id));
});

router.get("/:id", requireAuth, requireRole("ADMIN", "AGENT", "TECHNICIAN"), async (req, res) => {
  const workOrder = await store.get(req.params.id);
  if (!workOrder) return res.status(404).json({ error: "Work order not found" });
  if (!(await ownsWorkOrder(req.user, workOrder))) return res.status(403).json({ error: "Access Denied" });
  const isMine = await isMineFor(req.user, workOrder);
  res.json({ ...(await withInsuranceName(workOrder)), ...(isMine === undefined ? {} : { isMine }) });
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
  // Recibo automático por correo cuando el pago se registra a mano (efectivo, Zelle, tarjeta en
  // campo…) y la orden queda pagada. Se manda una vez: cuando pasa de no pagada a pagada.
  let receipt = null;
  if (data.payment && !workOrder.payment?.paid && updated?.payment?.paid) {
    receipt = await sendPaymentReceipt(updated, { trigger: "manual", actor: req.user?.name || "System" });
  }
  res.json(receipt ? { ...updated, receipt } : updated);
});

// Dar por perdido / reabrir el cobro de un trabajo entregado. Solo ADMIN: es una decisión
// contable, no una corrección de captura.
router.post("/:id/uncollectible", requireAuth, requireRole("ADMIN"), async (req, res) => {
  const workOrder = await store.markUncollectible(req.params.id, {
    reason: req.body.reason,
    note: req.body.note || "",
    clearRecordedPayment: req.body.clearRecordedPayment === true,
    actor: req.user?.name || "System",
  });
  if (!workOrder) return res.status(404).json({ error: "Work order not found" });
  res.json(workOrder);
});

router.delete("/:id/uncollectible", requireAuth, requireRole("ADMIN"), async (req, res) => {
  const workOrder = await store.clearUncollectible(req.params.id, req.user?.name || "System");
  if (!workOrder) return res.status(404).json({ error: "Work order not found" });
  res.json(workOrder);
});

router.post("/:id/assign-tech", requireAuth, requireRole("ADMIN"), async (req, res) => {
  // technicianId vacío = QUITAR al técnico. Una orden cancelada, o asignada por error, se queda
  // con la persona puesta y con su obligación de pago abierta; no había forma de dejarla en blanco
  // ni desde aquí ni desde la pantalla (Antonio, Wo-4286, 9-sep-2026). El sync de obligaciones ya
  // sabía qué hacer -sin técnico, la obligación auto pendiente se borra-, sólo faltaba poder pedirlo.
  const quitar = req.body.technicianId === null || req.body.technicianId === "" || req.body.technicianId === undefined;
  const technician = quitar ? null : await techniciansStore.get(req.body.technicianId);
  if (!quitar && !technician) return res.status(404).json({ error: "Technician not found" });
  const workOrder = await store.assignTech(req.params.id, technician?.id ?? null, technician?.name ?? "");
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

  // Con Twilio conectado el SMS al técnico sale de verdad desde aquí; sin Twilio solo se registra
  // (el agente lo manda desde su teléfono, como siempre). El resultado queda en la notificación.
  const created = [];
  for (const method of methods) {
    let status = "Sent", error = null, providerId = null;
    if (method === "SMS" && sms.isConfigured() && message) {
      try {
        const r = await sms.sendSms({ to: technician?.phone, body: message });
        providerId = r.sid;
      } catch (e) {
        status = "Failed"; error = e.message;
      }
    } else if (method === "SMS" && !sms.isConfigured()) {
      status = "Logged";
    }
    created.push(notificationsStore.create({
      workOrderId: workOrder.id,
      technicianId: workOrder.technicianId,
      method,
      recipient: method === "SMS" ? technician?.phone || "" : `${req.protocol}://${req.get("host")}`,
      message,
      status, error, providerId,
    }));
  }

  res.status(201).json(created);
});

// Mandar un SMS al CLIENTE de la orden desde el CRM (Twilio): link de pago, petición de tarjeta o
// texto libre. body: { text, kind, to? }. Queda en la bitácora de mensajes al cliente.
router.post("/:id/sms", requireAuth, requireRole("ADMIN", "AGENT"), async (req, res) => {
  const workOrder = await store.get(req.params.id);
  if (!workOrder) return res.status(404).json({ error: "Work order not found" });
  if (req.user.role === "AGENT" && !(await ownsWorkOrder(req.user, workOrder))) return res.status(403).json({ error: "Access Denied" });
  const to = String(req.body?.to || workOrder.phone || "").trim();
  const text = String(req.body?.text || "").trim();
  const kind = String(req.body?.kind || "custom");
  if (!text) return res.status(400).json({ error: "Empty message" });
  try {
    const r = await sms.sendSms({ to, body: text });
    const m = customerMessages.create({ workOrderId: workOrder.id, workOrderNo: workOrder.workOrderNo, channel: "sms", kind, to: r.to, body: text, status: "sent", providerId: r.sid, sentBy: req.user?.name });
    res.json({ ok: true, message: m });
  } catch (err) {
    customerMessages.create({ workOrderId: workOrder.id, workOrderNo: workOrder.workOrderNo, channel: "sms", kind, to, body: text, status: "failed", error: err.message, sentBy: req.user?.name });
    res.status(400).json({ error: err.message });
  }
});

router.get("/:id/messages", requireAuth, requireRole("ADMIN", "AGENT"), async (req, res) => {
  res.json(customerMessages.forWorkOrder(req.params.id));
});

router.delete("/:id", requireAuth, requireRole("ADMIN"), async (req, res) => {
  if (!(await store.remove(req.params.id))) return res.status(404).json({ error: "Work order not found" });
  res.status(204).end();
});

module.exports = router;
