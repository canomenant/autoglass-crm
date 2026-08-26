const express = require("express");
const store = require("../store/payments.store");

// Ruta PUBLICA: el tecnico o el agente abre su comprobante sin cuenta. Va montada fuera de
// requireAuth a proposito, y el token es lo unico que autoriza — por eso statementByToken()
// devuelve solo los campos del comprobante y registra cada apertura.
const router = express.Router();

router.get("/:token", async (req, res) => {
  // req.ip, no la cabecera cruda. X-Forwarded-For la escribe el cliente, así que leerla a mano
  // dejaba que quien abriera un comprobante grabara en el registro de acceso la IP que quisiera
  // —incluida la de un compañero—. Con `app.set("trust proxy", 1)` en index.js, Express toma el
  // último salto no confiable en vez de creerse la cadena entera.
  const statement = await store.statementByToken(req.params.token, { ip: req.ip || null });
  // Mismo 404 para un token inexistente y para uno revocado: distinguirlos le confirmaria a
  // quien prueba tokens que acerto con uno que existio.
  if (!statement) return res.status(404).json({ error: "Statement not found" });
  res.json(statement);
});

module.exports = router;
