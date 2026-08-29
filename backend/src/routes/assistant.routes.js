const express = require("express");
const { chat } = require("../lib/assistant");

const router = express.Router();

// POST /api/assistant/chat  { messages: [{ role: "user"|"assistant", content: "..." }] }
// El historial viene del cliente porque la conversación vive en su pantalla; aquí solo se
// valida forma y tamaño para que nadie convierta el endpoint en un pozo de tokens.
router.post("/chat", async (req, res) => {
  const { messages } = req.body || {};

  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: "messages debe ser una lista no vacía." });
  }
  if (messages.length > 40) {
    return res.status(400).json({ error: "La conversación es demasiado larga: empieza un chat nuevo." });
  }
  for (const m of messages) {
    if (!m || (m.role !== "user" && m.role !== "assistant") || typeof m.content !== "string") {
      return res.status(400).json({ error: "Cada mensaje necesita role (user/assistant) y content de texto." });
    }
    if (m.content.length > 4000) {
      return res.status(400).json({ error: "Un mensaje supera el máximo de 4000 caracteres." });
    }
  }
  if (messages[messages.length - 1].role !== "user") {
    return res.status(400).json({ error: "El último mensaje debe ser del usuario." });
  }

  const result = await chat(messages);
  res.json(result);
});

module.exports = router;
