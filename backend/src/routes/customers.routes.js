const express = require("express");
const store = require("../store/customers.store");

const router = express.Router();

router.get("/", async (req, res) => res.json(await store.list()));

router.get("/:id", async (req, res) => {
  const customer = await store.get(req.params.id);
  if (!customer) return res.status(404).json({ error: "Customer not found" });
  res.json(customer);
});

router.post("/", async (req, res) => res.status(201).json(await store.create({ ...req.body, createdBy: req.user.name })));

router.put("/:id", async (req, res) => {
  const customer = await store.update(req.params.id, { ...req.body, updatedBy: req.user.name });
  if (!customer) return res.status(404).json({ error: "Customer not found" });
  res.json(customer);
});

router.delete("/:id", async (req, res) => {
  if (!(await store.remove(req.params.id))) return res.status(404).json({ error: "Customer not found" });
  res.status(204).end();
});

module.exports = router;
