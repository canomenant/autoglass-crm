const express = require("express");
const { actorFrom: actor } = require("../lib/actor");
const { requireRole } = require("../middleware/auth");
const store = require("../store/payments.store");
const notesStore = require("../store/notes.store");
const mailer = require("../lib/mailer");
const companyProfile = require("../store/companyProfile.store");
const { buildStatementEmail } = require("../lib/statementEmail");

const router = express.Router();

// Lo que un agente ve de su propio lote. El registro completo trae la bitácora (quién lo creó y
// cuándo lo aprobó), las notas internas de captura ("creado con la lista de Antonio…"), el cotejo
// bancario y quién lo concilió: nada de eso es del agente, es de la oficina. Lista blanca, no
// negra: un campo nuevo en mapPayment no sale solo por haberse añadido.
function forAgent(p) {
  return {
    id: p.id,
    paymentNumber: p.paymentNumber,
    type: p.type,
    status: p.status,
    agentId: p.agentId,
    paidTo: p.paidTo,
    parties: p.parties,
    paymentDate: p.paymentDate,
    paymentMethod: p.paymentMethod,
    amount: p.amount,
    grossAmount: p.grossAmount,
    commissionAmount: p.commissionAmount,
    commissionType: p.commissionType,
    commissionRate: p.commissionRate,
    bonus: p.bonus,
    bonusReason: p.bonusReason,
    deductions: p.deductions,
    creditNotesTotal: p.creditNotesTotal,
    debitNotesTotal: p.debitNotesTotal,
    obligationsCount: p.obligationsCount,
    obligationsTotal: p.obligationsTotal,
    workOrderIds: p.workOrderIds,
    transactions: (p.transactions || []).map((t) => ({ id: t.id, date: t.date, paymentMethod: t.paymentMethod, amount: t.amount })),
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
  };
}

router.get("/", async (req, res) => {
  let payments = await store.list(req.query);
  if (req.user.role === "AGENT") {
    payments = payments.filter((p) => p.type === "AGENT" && p.agentId === req.user.entityId).map(forAgent);
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

// Mandar el comprobante por correo desde el lote (Antonio, 20-sep-2026: "al socio, el PDF de lo
// que ocupamos pagar al tech / agente / distribuidor"). Emite el link si aún no existe y manda el
// resumen completo con el link y el botón de guardar PDF. Solo admin (el montaje limita POST).
router.post("/:id/statement-email", async (req, res) => {
  const to = String(req.body?.to || "").trim();
  if (!mailer.EMAIL_RE.test(to)) return res.status(400).json({ error: "A valid email address is required" });
  if (!mailer.isConfigured()) return res.status(503).json({ error: "Email is not configured (RESEND_API_KEY / EMAIL_FROM)" });

  const payment = await store.ensureStatementToken(req.params.id, actor(req));
  if (!payment) return res.status(404).json({ error: "Payment not found" });
  // La copia del dueño y no la del técnico: el correo tiene que verse como el comprobante que
  // abre el socio, con venta, costos y ganancia (Antonio, 23-sep-2026).
  const statement = await store.ownerStatementById(req.params.id);
  const frontendUrl = String(process.env.FRONTEND_URL || "").replace(/[/]$/, "");
  // Al socio se le manda la COPIA DEL DUEÑO: la del técnico no lleva costos ni ganancia
  // (Antonio, 21-sep-2026). Son dos links distintos a propósito.
  const owner = await store.ensureOwnerToken(req.params.id, actor(req));
  const publicUrl = `${frontendUrl}/statement/owner/${owner.ownerToken}`;
  const { subject, html, text } = buildStatementEmail({
    statement, company: companyProfile.get(), publicUrl, frontendUrl,
    note: String(req.body?.note || "").slice(0, 2000),
  });
  try {
    const r = await mailer.sendEmail({ to, subject, html, text });
    res.json({ id: r.id, to, subject });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// El link de la copia del DUEÑO: el comprobante con costos y ganancia que va al socio. Aparte del
// del técnico a propósito — ese lo abre él y no puede llevar márgenes.
router.post("/:id/owner-statement-link", async (req, res) => {
  const r = await store.ensureOwnerToken(req.params.id, actor(req));
  if (!r) return res.status(404).json({ error: "Payment not found" });
  res.json(r);
});

router.post("/:id/owner-statement-link/regenerate", async (req, res) => {
  const r = await store.regenerateOwnerToken(req.params.id, actor(req));
  if (!r) return res.status(404).json({ error: "Payment not found" });
  res.json(r);
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
  if (req.user.role === "AGENT") return res.json(forAgent(payment));
  // A dónde mandarle el dinero, desde la ficha del técnico o del agente: quien arma el pago lo
  // necesita a la vista y antes lo tenía que preguntar (Antonio, 21-sep-2026).
  res.json({ ...payment, payoutMethods: await store.payoutDestinationFor(payment) });
});

// El comprobante del lote —el mismo papel que sale por el link público— para quien tiene
// cuenta y es dueño del pago. Es lo que el agente abre como detalle de su comisión: qué trabajos
// lo componen y de qué se compone el bono, sin la pantalla de captura de la oficina.
router.get("/:id/statement", async (req, res) => {
  const payment = await store.get(req.params.id);
  if (!payment) return res.status(404).json({ error: "Payment not found" });
  if (!ownsPayment(req, payment)) return res.status(404).json({ error: "Payment not found" });
  res.json(await store.statementById(req.params.id));
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

// Los movimientos del banco que pagan el lote: uno o varios (Dist-0348 salió en dos cargos).
router.post("/:id/transactions", requireRole("ADMIN"), async (req, res) => {
  try {
    const payment = await store.addTransaction(req.params.id, req.body || {}, actor(req));
    if (!payment) return res.status(404).json({ error: "Payment not found" });
    res.status(201).json(payment);
  } catch (err) { res.status(400).json({ error: err.message }); }
});

router.delete("/:id/transactions/:txId", requireRole("ADMIN"), async (req, res) => {
  const payment = await store.removeTransaction(req.params.id, req.params.txId, actor(req));
  if (!payment) return res.status(404).json({ error: "Transaction not found" });
  res.json(payment);
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
  // Misma comprobación de propiedad que bonus-items: el montaje autoriza GET a AGENT y sin esto
  // cualquier agente leía las piezas pendientes de los lotes de técnicos iterando ids.
  const payment = await store.get(req.params.id);
  if (!payment) return res.status(404).json({ error: "Payment not found" });
  if (!ownsPayment(req, payment)) return res.status(404).json({ error: "Payment not found" });
  // ?all=1 abre la lista a las pendientes de cualquier orden: quien instalo no siempre es
  // quien pago la pieza, y eso no lo dice ningun campo.
  res.json({ techParts: await store.techPartsForPayment(req.params.id, req.query.all === "1") });
});

router.post("/:id/obligations", async (req, res) => {
  try {
    const payment = await store.linkObligations(req.params.id, req.body?.payableIds, actor(req));
    if (!payment) return res.status(404).json({ error: "Payment not found" });
    res.json(payment);
  } catch (err) { res.status(400).json({ error: err.message }); }
});

// Corregir el monto de una obligación ya enlazada (labor, comisión o pieza). Solo admin: mueve dinero.
router.put("/:id/obligations/:payableId/amount", requireRole("ADMIN"), async (req, res) => {
  try {
    const payment = await store.setObligationAmount(req.params.id, req.params.payableId, req.body?.amount, actor(req));
    if (!payment) return res.status(404).json({ error: "Obligation not found in this payment" });
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
