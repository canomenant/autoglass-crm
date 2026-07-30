const express = require("express");
const store = require("../store/attachments.store");

const router = express.Router();

router.get("/", async (req, res) => res.json(await store.list(req.query)));

router.post("/", async (req, res) => res.status(201).json(await store.create(req.body)));

router.delete("/:id", async (req, res) => {
  if (!(await store.remove(req.params.id))) return res.status(404).json({ error: "Attachment not found" });
  res.status(204).end();
});

module.exports = router;
