const express = require("express");
const store = require("../store/partnerPayments.store");
const businessPartnersStore = require("../store/businessPartners.store");

const router = express.Router();

router.get("/", async (req, res) => {
  const { partnerId, dateFrom, dateTo } = req.query;
  res.json(await store.list({ partnerId, dateFrom, dateTo }));
});

router.post("/", async (req, res) => {
  try {
    const partner = businessPartnersStore.get(req.body?.partnerId);
    if (!partner) return res.status(404).json({ error: "Partner not found" });
    const created = await store.create({ ...req.body, partnerName: partner.name }, req.user?.name);
    res.status(201).json(created);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete("/:id", async (req, res) => {
  if (!(await store.remove(req.params.id))) return res.status(404).json({ error: "Not found" });
  res.status(204).end();
});

module.exports = router;
