const express = require("express");
const store = require("../store/payable.store");
const paymentsStore = require("../store/payments.store");

const router = express.Router();

// Saldos de los tres tipos, para la portada.
router.get("/summary", async (req, res) => res.json(await store.summary()));

// Partes con saldo pendiente de un tipo, de mayor a menor.
router.get("/:kind/parties", async (req, res) => {
  if (!store.normalizeKind(req.params.kind)) return res.status(400).json({ error: "Unknown kind" });
  res.json({ parties: await store.balancesByParty(req.params.kind) });
});

// Obligaciones pendientes de una parte.
router.get("/:kind/parties/:party/pending", async (req, res) => {
  if (!store.normalizeKind(req.params.kind)) return res.status(400).json({ error: "Unknown kind" });
  res.json({ obligations: await store.pendingForParty(req.params.kind, req.params.party) });
});

// Contenido de un lote, leido de las obligaciones.
router.get("/payout/:id", async (req, res) => res.json({ obligations: await store.forPayout(Number(req.params.id)) }));

// Crear el lote. El store rechaza cualquier obligacion que ya tenga lote, nombrando cual y donde,
// y es el unico lugar que marca pagado — la ruta no toca payable directamente.
router.post("/:kind/payouts", async (req, res) => {
  const kind = store.normalizeKind(req.params.kind);
  if (!kind) return res.status(400).json({ error: "Unknown kind" });
  try {
    const payout = await paymentsStore.create(
      { ...req.body, type: store.KIND_TO_PAYOUT_TYPE[kind] },
      req.user?.name
    );
    res.status(201).json(payout);
  } catch (err) {
    // Un choque de obligaciones ya reclamadas es una condicion esperada, no una falla del servidor.
    const claimed = /already in a payment/i.test(err.message);
    res.status(claimed ? 409 : 400).json({ error: err.message, alreadyClaimed: claimed });
  }
});

module.exports = router;
