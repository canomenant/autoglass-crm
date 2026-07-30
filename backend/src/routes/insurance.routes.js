const express = require("express");
const store = require("../store/insurance.store");

const router = express.Router();

router.get("/", async (req, res) => res.json(await store.list()));

router.get("/:id", async (req, res) => {
  const company = await store.get(req.params.id);
  if (!company) return res.status(404).json({ error: "Insurance company not found" });
  res.json(company);
});

router.post("/", async (req, res) => res.status(201).json(await store.create(req.body)));

router.put("/:id", async (req, res) => {
  const company = await store.update(req.params.id, req.body);
  if (!company) return res.status(404).json({ error: "Insurance company not found" });
  res.json(company);
});

router.delete("/:id", async (req, res) => {
  if (!(await store.remove(req.params.id))) return res.status(404).json({ error: "Insurance company not found" });
  res.status(204).end();
});

module.exports = router;
