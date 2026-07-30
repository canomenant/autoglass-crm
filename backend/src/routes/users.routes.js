const express = require("express");
const store = require("../store/users.store");

const router = express.Router();

router.get("/", async (req, res) => res.json(await store.list()));

router.get("/:id", async (req, res) => {
  const user = await store.get(req.params.id);
  if (!user) return res.status(404).json({ error: "User not found" });
  res.json(user);
});

router.post("/", async (req, res) => res.status(201).json(await store.create(req.body)));

router.put("/:id", async (req, res) => {
  const user = await store.update(req.params.id, req.body);
  if (!user) return res.status(404).json({ error: "User not found" });
  res.json(user);
});

router.delete("/:id", async (req, res) => {
  if (!(await store.remove(req.params.id))) return res.status(404).json({ error: "User not found" });
  res.status(204).end();
});

module.exports = router;
