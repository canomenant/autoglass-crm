const express = require("express");
const store = require("../store/distributors.store");

const router = express.Router();

router.get("/", async (req, res) => res.json(await store.list()));

router.get("/:id", async (req, res) => {
  const distributor = await store.get(req.params.id);
  if (!distributor) return res.status(404).json({ error: "Distributor not found" });
  res.json(distributor);
});

router.post("/", async (req, res) => res.status(201).json(await store.create(req.body)));

router.put("/:id", async (req, res) => {
  const distributor = await store.update(req.params.id, req.body);
  if (!distributor) return res.status(404).json({ error: "Distributor not found" });
  res.json(distributor);
});

router.delete("/:id", async (req, res) => {
  if (!(await store.remove(req.params.id))) return res.status(404).json({ error: "Distributor not found" });
  res.status(204).end();
});

module.exports = router;
