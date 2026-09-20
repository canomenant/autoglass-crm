const express = require("express");
const { requireAuth, requireRole } = require("../middleware/auth");
const leadBuyers = require("../store/leadBuyers.store");
const leadSales = require("../store/leadSales.store");
const workordersStore = require("../store/workorders.store");
const quotesStore = require("../store/quotes.store");
const getStripe = require("../lib/stripe");
const leads = require("../lib/leads");

// Venta de leads (Antonio, 19-sep-2026). Ver leadBuyers.store.js para el modelo.
// Público (sin login, el token de la oferta es la credencial): /public/:token, /public/:token/accept-terms,
// /public/:token/checkout. Lo demás es de oficina (Admin; Agent solo puede vender).

const router = express.Router();
const admin = [requireAuth, requireRole("ADMIN")];
const office = [requireAuth, requireRole("ADMIN", "AGENT")];
const frontendUrl = () => String(process.env.FRONTEND_URL || "").replace(/[/]$/, "");

// Vista para el comprador: antes de pagar solo el adelanto; después, el paquete completo (solo
// para la oferta que pagó).
function publicView(sale, offer, buyer) {
  const base = {
    workOrderNo: sale.workOrderNo,
    price: sale.price,
    status: sale.status,
    offerStatus: offer.status,
    expiresAt: sale.expiresAt,
    teaser: sale.teaser,
    buyerName: offer.buyerName,
    termsAccepted: Boolean(buyer?.termsAcceptedAt),
    terms: leadBuyers.getSettings().buyerTerms,
  };
  if (offer.status === "paid" && ["paid", "delivered"].includes(sale.status)) base.package = sale.package;
  return base;
}

// ---------- público ----------
router.get("/public/:token", async (req, res) => {
  await leadSales.expireStale();
  const hit = await leadSales.byToken(req.params.token);
  if (!hit) return res.status(404).json({ error: "Lead not found" });
  res.json(publicView(hit.sale, hit.offer, leadBuyers.getBuyer(hit.offer.buyerId)));
});

router.post("/public/:token/accept-terms", async (req, res) => {
  const hit = await leadSales.byToken(req.params.token);
  if (!hit) return res.status(404).json({ error: "Lead not found" });
  leadBuyers.acceptTerms(hit.offer.buyerId);
  res.json({ ok: true });
});

// Pagar para destapar: Stripe Checkout con el precio del lead. El webhook cierra la venta.
router.post("/public/:token/checkout", async (req, res) => {
  await leadSales.expireStale();
  const hit = await leadSales.byToken(req.params.token);
  if (!hit) return res.status(404).json({ error: "Lead not found" });
  const { sale, offer } = hit;
  if (sale.status !== "offered") return res.status(409).json({ error: sale.status === "expired" ? "This lead has expired" : "This lead is no longer available" });
  if (offer.status !== "offered") return res.status(409).json({ error: "This offer is no longer available" });
  const buyer = leadBuyers.getBuyer(offer.buyerId);
  if (!buyer?.termsAcceptedAt) return res.status(400).json({ error: "Please accept the lead purchase terms first" });
  try {
    const session = await getStripe().checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],
      customer_email: buyer.email || undefined,
      line_items: [{ price_data: { currency: "usd", product_data: { name: `Lead — ${sale.teaser.vehicle} in ${sale.teaser.area}`, description: `${sale.teaser.job} · exclusive lead · Reyes Auto Glass Group` }, unit_amount: Math.round(Number(sale.price) * 100) }, quantity: 1 }],
      success_url: `${frontendUrl()}/lead/${offer.token}?paid=1`,
      cancel_url: `${frontendUrl()}/lead/${offer.token}`,
      metadata: { purpose: "lead", leadSaleId: String(sale.id), token: offer.token, buyerId: String(offer.buyerId), workOrderNo: sale.workOrderNo },
    });
    res.json({ url: session.url });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ---------- oficina ----------
router.get("/settings", office, (_req, res) => res.json(leadBuyers.getSettings()));
router.put("/settings", admin, (req, res) => res.json(leadBuyers.updateSettings(req.body || {}, req.user?.name)));

router.get("/buyers", office, (_req, res) => res.json(leadBuyers.listBuyers()));
router.post("/buyers", admin, (req, res) => {
  try { res.status(201).json(leadBuyers.createBuyer(req.body || {})); } catch (e) { res.status(400).json({ error: e.message }); }
});
router.put("/buyers/:id", admin, (req, res) => {
  const b = leadBuyers.updateBuyer(req.params.id, req.body || {});
  if (!b) return res.status(404).json({ error: "Buyer not found" });
  res.json(b);
});
router.delete("/buyers/:id", admin, (req, res) => {
  if (!leadBuyers.removeBuyer(req.params.id)) return res.status(404).json({ error: "Buyer not found" });
  res.status(204).end();
});

// Precio sugerido y vista previa para una orden.
router.get("/suggest/:workOrderId", office, async (req, res) => {
  const wo = await workordersStore.get(req.params.workOrderId);
  if (!wo) return res.status(404).json({ error: "Work order not found" });
  const quote = wo.quoteId ? await quotesStore.get(wo.quoteId) : null;
  const pkg = leads.buildPackage(wo, quote);
  const teaser = leads.buildTeaser(wo, quote, pkg);
  const isChip = pkg.jobTypes.length > 0 && pkg.jobTypes.every((t) => /chip/i.test(t));
  const customerPrice = Number(wo.totalSale || 0) || Number(quote?.customerSuggestedPrice || 0);
  const price = leadBuyers.suggestedPrice({ customerPrice, isChipRepair: isChip });
  const sales = await leadSales.forWorkOrder(wo.id);
  res.json({ price, customerPrice, isChipRepair: isChip, teaser, package: pkg, buyers: leadBuyers.listBuyers().filter((b) => b.active), sales });
});

router.get("/sales", office, async (req, res) => {
  await leadSales.expireStale();
  res.json(await leadSales.list(req.query));
});

router.get("/sales/work-order/:workOrderId", office, async (req, res) => {
  await leadSales.expireStale();
  res.json(await leadSales.forWorkOrder(req.params.workOrderId));
});

// Vender: crea la venta con una oferta por comprador, manda los adelantos y cancela la orden
// (razón "Lead Sold") para que salga de las ventas de Reyes.
router.post("/sell", office, async (req, res) => {
  const { workOrderId, buyerIds, price } = req.body || {};
  const wo = await workordersStore.get(workOrderId);
  if (!wo) return res.status(404).json({ error: "Work order not found" });
  const buyers = (Array.isArray(buyerIds) ? buyerIds : []).map((id) => leadBuyers.getBuyer(id)).filter((b) => b && b.active);
  if (!buyers.length) return res.status(400).json({ error: "Pick at least one buyer" });
  const abiertas = (await leadSales.forWorkOrder(wo.id)).filter((s) => ["offered", "paid", "delivered"].includes(s.status));
  if (abiertas.length) return res.status(409).json({ error: `This work order already has a lead sale (${abiertas[0].status})` });
  const quote = wo.quoteId ? await quotesStore.get(wo.quoteId) : null;
  const pkg = leads.buildPackage(wo, quote);
  const teaser = leads.buildTeaser(wo, quote, pkg);
  if (!pkg.phone) return res.status(400).json({ error: "The customer has no phone number; nothing to sell" });
  const isChip = pkg.jobTypes.length > 0 && pkg.jobTypes.every((t) => /chip/i.test(t));
  const monto = Number(price) > 0 ? Math.round(Number(price) * 100) / 100 : leadBuyers.suggestedPrice({ customerPrice: Number(wo.totalSale || 0) || Number(quote?.customerSuggestedPrice || 0), isChipRepair: isChip });
  const settings = leadBuyers.getSettings();
  let sale = await leadSales.create({ workOrderId: wo.id, workOrderNo: wo.workOrderNo, quoteId: wo.quoteId, price: monto, buyers, pkg, teaser, expiresHours: settings.expiresHours, createdBy: req.user?.name });
  sale = await leads.sendOffers(sale);
  if (wo.status !== "Cancelled") {
    await workordersStore.update(wo.id, { status: "Cancelled", cancellationReason: "Lead Sold", updatedBy: req.user?.name || "System" });
  }
  res.status(201).json(sale);
});

router.post("/sales/:id/resend", office, async (req, res) => {
  const sale = await leadSales.get(req.params.id);
  if (!sale) return res.status(404).json({ error: "Lead sale not found" });
  if (sale.status !== "offered") return res.status(409).json({ error: "Only open offers can be resent" });
  res.json(await leads.sendOffers(sale));
});

// Pago fuera de Stripe (Zelle/efectivo): marcar pagado por un comprador y entregar.
router.post("/sales/:id/mark-paid", admin, async (req, res) => {
  const sale = await leadSales.get(req.params.id);
  if (!sale) return res.status(404).json({ error: "Lead sale not found" });
  const offer = sale.offers.find((o) => o.buyerId === Number(req.body?.buyerId));
  if (!offer) return res.status(400).json({ error: "That buyer was not offered this lead" });
  const paid = await leadSales.markPaid(sale.id, { buyerId: offer.buyerId, buyerName: offer.buyerName, via: req.body?.via || "manual", ref: req.body?.ref || req.user?.name });
  if (paid.status !== "paid") return res.status(409).json({ error: `Lead is ${paid.status}` });
  const wo = await workordersStore.get(sale.workOrderId);
  res.json(await leads.deliver(paid, wo));
});

router.post("/sales/:id/cancel", office, async (req, res) => {
  const sale = await leadSales.cancel(req.params.id, req.body?.reason || "", req.user?.name);
  if (!sale) return res.status(404).json({ error: "Lead sale not found" });
  // Si se cancela la venta sin comprador, la orden vuelve a estar viva.
  if (sale.status === "cancelled" && req.body?.reopenWorkOrder) {
    await workordersStore.update(sale.workOrderId, { status: "Scheduled", cancellationReason: "", updatedBy: req.user?.name || "System" });
  }
  res.json(sale);
});

module.exports = router;
