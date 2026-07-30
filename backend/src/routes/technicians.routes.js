const express = require("express");
const store = require("../store/technicians.store");

const router = express.Router();

router.get("/", async (req, res) => res.json(await store.list()));

router.get("/:id", async (req, res) => {
  const item = await store.get(req.params.id);
  if (!item) return res.status(404).json({ error: "Technician not found" });
  res.json(item);
});

router.post("/", async (req, res) => res.status(201).json(await store.create(req.body)));

router.put("/:id", async (req, res) => {
  const item = await store.update(req.params.id, req.body);
  if (!item) return res.status(404).json({ error: "Technician not found" });
  res.json(item);
});

router.delete("/:id", async (req, res) => {
  if (!(await store.remove(req.params.id))) return res.status(404).json({ error: "Technician not found" });
  res.status(204).end();
});

module.exports = router;
