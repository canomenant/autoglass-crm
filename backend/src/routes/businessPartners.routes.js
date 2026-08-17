const express = require("express");
const store = require("../store/businessPartners.store");

const router = express.Router();

router.get("/", async (req, res) => res.json(await store.list()));

router.post("/", async (req, res) => res.status(201).json(await store.create(req.body)));

router.put("/:id", async (req, res) => {
  const item = await store.update(req.params.id, req.body);
  if (!item) return res.status(404).json({ error: "Not found" });
  res.json(item);
});

router.delete("/:id", async (req, res) => {
  if (!(await store.remove(req.params.id))) return res.status(404).json({ error: "Not found" });
  res.status(204).end();
});

module.exports = router;
