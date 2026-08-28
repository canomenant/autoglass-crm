const express = require("express");
const store = require("../store/notes.store");

const router = express.Router();
const TYPE = "DEBIT";

function actor(req) {
  return req.body?.performedBy || req.query?.performedBy || "System";
}

router.get("/", async (req, res) => res.json(await store.list(TYPE, req.query)));

router.get("/dashboard", async (req, res) => res.json(await store.dashboard(TYPE)));

router.get("/:id", async (req, res) => {
  const note = await store.get(req.params.id);
  if (!note || note.noteType !== TYPE) return res.status(404).json({ error: "Debit note not found" });
  res.json(note);
});

router.post("/", async (req, res) => {
  const note = await store.create(TYPE, req.body, actor(req));
  res.status(201).json(note);
});

router.put("/:id", async (req, res) => {
  const note = await store.update(req.params.id, req.body, actor(req));
  if (!note) return res.status(404).json({ error: "Debit note not found" });
  res.json(note);
});

router.post("/:id/apply", async (req, res) => {
  const note = await store.apply(req.params.id, actor(req));
  if (!note) return res.status(404).json({ error: "Debit note not found" });
  res.json(note);
});

router.post("/:id/void", async (req, res) => {
  const note = await store.void(req.params.id, actor(req), req.body?.reason);
  if (!note) return res.status(404).json({ error: "Debit note not found" });
  res.json(note);
});

// Revivir una anulada: vuelve a Active y el lote recupera el ajuste (cambiarEstado recalcula).
router.post("/:id/reactivate", async (req, res) => {
  const note = await store.reactivate(req.params.id, actor(req));
  if (!note) return res.status(404).json({ error: "Debit note not found" });
  res.json(note);
});

router.delete("/:id", async (req, res) => {
  const ok = await store.remove(req.params.id);
  if (!ok) return res.status(404).json({ error: "Debit note not found" });
  res.status(204).end();
});

module.exports = router;
