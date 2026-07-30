const express = require("express");
const store = require("../store/expenses.store");

const router = express.Router();

router.get("/", async (req, res) => res.json(await store.list()));

router.get("/:id", async (req, res) => {
  const expense = await store.get(req.params.id);
  if (!expense) return res.status(404).json({ error: "Expense not found" });
  res.json(expense);
});

router.post("/", async (req, res) => res.status(201).json(await store.create(req.body)));

router.put("/:id", async (req, res) => {
  const expense = await store.update(req.params.id, req.body);
  if (!expense) return res.status(404).json({ error: "Expense not found" });
  res.json(expense);
});

router.delete("/:id", async (req, res) => {
  if (!(await store.remove(req.params.id))) return res.status(404).json({ error: "Expense not found" });
  res.status(204).end();
});

module.exports = router;
