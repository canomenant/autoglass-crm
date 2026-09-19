const express = require("express");
const store = require("../store/techMessageConfig.store");

const router = express.Router();

// Qué se le manda al técnico (SMS y vista móvil). Leerla la necesita el panel de asignar técnico;
// cambiarla es de Admin (ver la protección en index.js).
router.get("/", (_req, res) => res.json(store.get()));

router.put("/", (req, res) => {
  try {
    res.json(store.update(req.body || {}, req.user?.name));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post("/reset", (req, res) => res.json(store.reset(req.user?.name)));

module.exports = router;
