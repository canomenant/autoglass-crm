const express = require("express");
const { actorFrom: actor } = require("../lib/actor");
const { requireRole } = require("../middleware/auth");
const store = require("../store/payments.store");
const notesStore = require("../store/notes.store");

const router = express.Router();

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
// Que clase de bonos se estan dando. Acepta los mismos filtros de fecha y tipo que la lista, para
// poder preguntar "y en este trimestre?" sin salir de la pantalla.
// ADMIN, como /dashboard justo arriba. Estas dos se habían quedado fuera de esa restricción y
// el montaje en index.js autoriza GET a AGENT: bonusSummary().byParty desglosa lo que cobra cada
// compañía y cada técnico, así que un agente veía lo que cobran todos los demás.
router.get("/bonus-summary", requireRole("ADMIN"), async (req, res) =>
  res.json({ ...(await store.bonusSummary(req.query)), types: store.BONUS_TYPES }));
router.get("/parties/:type", requireRole("ADMIN"), async (req, res) =>
  res.json({ parties: await store.partiesForType(req.params.type) }));

// Emite el link del comprobante. Nace a pedido: no se le crea token a los 791 lotes por si acaso,
// porque cada token es una credencial mas que puede filtrarse.
router.post("/:id/statement-link", async (req, res) => {
  const payment = await store.ensureStatementToken(req.params.id, actor(req));
  if (!payment) return res.status(404).json({ error: "Payment not found" });
  res.json({ token: payment.publicToken, accessLog: payment.publicAccessLog || [] });
});

// Revocar es emitir uno nuevo: la busqueda es por token exacto, asi que el anterior deja de
// resolver en el acto.
router.post("/:id/statement-link/regenerate", async (req, res) => {
  const payment = await store.regenerateStatementToken(req.params.id, actor(req));
  if (!payment) return res.status(404).json({ error: "Payment not found" });
  res.json({ token: payment.publicToken, accessLog: payment.publicAccessLog || [] });
});
// Desglosar los ajustes heredados de AppSheet: enlaza el juego de notas que suma EXACTO el total
// heredado del pago. Nota por nota está vetado por validarLote; este es el camino completo.
router.post("/:id/itemize-legacy", requireRole("ADMIN"), async (req, res) => {
  try {
    res.json(await notesStore.itemizeLegacy(req.params.id, req.body?.noteIds, actor(req)));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Cotejo contra el extracto: marca (o desmarca) que este cargo ya se encontró en el banco.
router.post("/:id/reconcile", requireRole("ADMIN"), async (req, res) => {
  const payment = await store.setReconciled(req.params.id, req.body?.reconciled === true, actor(req));
  if (!payment) return res.status(404).json({ error: "Payment not found" });
  res.json(payment);
});

router.get("/:id", async (req, res) => {
  const payment = await store.get(req.params.id);
  if (!payment) return res.status(404).json({ error: "Payment not found" });
  if (!ownsPayment(req, payment)) return res.status(403).json({ error: "Access Denied" });
  res.json(payment);
});

// Los renglones del bono. El bono del lote es su suma, asi que agregarlos o quitarlos recalcula el
// pago entero — nunca se editan por separado.
// Con la misma comprobación de propiedad que GET /:id y GET /:id/notes. Se había quedado sin
// ella, y como el montaje en index.js autoriza GET a AGENT, cualquier agente leía el desglose de
// bonos de CUALQUIER lote —de técnicos y de otros agentes— iterando ids.
router.get("/:id/bonus-items", async (req, res) => {
  const payment = await store.get(req.params.id);
  if (!payment) return res.status(404).json({ error: "Payment not found" });
  if (!ownsPayment(req, payment)) return res.status(404).json({ error: "Payment not found" });
  res.json({ items: await store.bonusItems(req.params.id) });
});

router.post("/:id/bonus-items", async (req, res) => {
  try {
    const payment = await store.addBonusItem(req.params.id, req.body || {}, actor(req));
    if (!payment) return res.status(404).json({ error: "Payment not found" });
    res.status(201).json({ payment, items: await store.bonusItems(req.params.id) });
  } catch (err) { res.status(400).json({ error: err.message }); }
});

router.delete("/:id/bonus-items/:itemId", async (req, res) => {
  const payment = await store.removeBonusItem(req.params.id, req.params.itemId, actor(req));
  if (!payment) return res.status(404).json({ error: "Bonus item not found" });
  res.json({ payment, items: await store.bonusItems(req.params.id) });
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

// Vincular obligaciones a un lote ya creado — el flujo de los lotes adhoc del import PayPal,
// cuyas work orders se capturan despues del pago. El monto del lote NO cambia: la pantalla
// muestra el descuadre contra lo listado y se cierra conforme se vincula.
// El montaje en index.js ya limita POST/DELETE a ADMIN.
// Las piezas que el tecnico puso de su bolsa y siguen sin devolversele. Se ofrecen en el panel
// del lote para marcarlas igual que las ordenes: enlazarlas CIERRA la obligacion, que es lo que
// nunca pasaba cuando el monto se tecleaba a mano en "Partes devueltas".
router.get("/:id/tech-parts", async (req, res) => {
  res.json({ techParts: await store.techPartsForPayment(req.params.id) });
});

router.post("/:id/obligations", async (req, res) => {
  try {
    const payment = await store.linkObligations(req.params.id, req.body?.payableIds, actor(req));
    if (!payment) return res.status(404).json({ error: "Payment not found" });
    res.json(payment);
  } catch (err) { res.status(400).json({ error: err.message }); }
});

router.delete("/:id/obligations/:payableId", async (req, res) => {
  const payment = await store.unlinkObligation(req.params.id, req.params.payableId, actor(req));
  if (!payment) return res.status(404).json({ error: "Obligation not found in this payment" });
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
