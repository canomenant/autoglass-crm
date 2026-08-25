const express = require("express");
const store = require("../store/payments.store");

// Ruta PUBLICA: el tecnico o el agente abre su comprobante sin cuenta. Va montada fuera de
// requireAuth a proposito, y el token es lo unico que autoriza — por eso statementByToken()
// devuelve solo los campos del comprobante y registra cada apertura.
const router = express.Router();

router.get("/:token", async (req, res) => {
  const ip = req.headers["x-forwarded-for"] || req.socket?.remoteAddress || null;
  const statement = await store.statementByToken(req.params.token, { ip: String(ip || "").split(",")[0].trim() });
  // Mismo 404 para un token inexistente y para uno revocado: distinguirlos le confirmaria a
  // quien prueba tokens que acerto con uno que existio.
  if (!statement) return res.status(404).json({ error: "Statement not found" });
  res.json(statement);
});

module.exports = router;
