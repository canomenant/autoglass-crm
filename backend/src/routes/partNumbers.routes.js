const express = require("express");
const store = require("../store/partNumbers.store");

const router = express.Router();

router.get("/", async (req, res) => res.json(await store.list()));

router.post("/", async (req, res) => {
  const { created, duplicate } = await store.create(req.body, req.user?.name);
  // 409 rather than an error string: the quote form shows the entry that already exists and
  // offers to select it, which is the outcome the user wanted anyway.
  if (!created) {
    return res.status(409).json({
      error: "That part number is already in the catalog.",
      duplicate: true,
      existing: duplicate,
    });
  }
  res.status(201).json(created);
});

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
