const express = require("express");
const store = require("../store/tableViews.store");

const router = express.Router();

function actor(req) {
  return req.body?.performedBy || req.query?.performedBy || "System";
}

router.get("/", async (req, res) => {
  if (!req.query.module) return res.status(400).json({ error: "module is required" });
  res.json(await store.list(req.query.module, actor(req)));
});

router.post("/", async (req, res) => {
  const view = await store.create(req.body, actor(req));
  res.status(201).json(view);
});

router.put("/:id", async (req, res) => {
  const view = await store.update(req.params.id, req.body);
  if (!view) return res.status(404).json({ error: "View not found" });
  res.json(view);
});

router.post("/:id/set-default", async (req, res) => {
  const view = await store.setDefault(req.params.id, actor(req));
  if (!view) return res.status(404).json({ error: "View not found" });
  res.json(view);
});

router.delete("/:id", async (req, res) => {
  const ok = await store.remove(req.params.id);
  if (!ok) return res.status(404).json({ error: "View not found" });
  res.status(204).end();
});

module.exports = router;
