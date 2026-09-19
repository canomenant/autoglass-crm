const express = require("express");
const store = require("../store/companyProfile.store");

const router = express.Router();

// Datos de la empresa para los papeles que salen al cliente. Leer es de cualquier usuario;
// cambiar es de Admin (ver la protección en index.js). La lectura sin login está aparte, en
// index.js (/api/public/company-profile), porque la factura pública no trae token.
router.get("/", (_req, res) => res.json(store.get()));

router.put("/", (req, res) => {
  try {
    res.json(store.update(req.body || {}, req.user?.name));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
