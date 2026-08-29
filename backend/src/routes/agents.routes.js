const express = require("express");
const store = require("../store/agents.store");

const router = express.Router();

// Lo que un desplegable de nombres necesita, que es para lo que un agente llama a esta ruta.
//
// sanitize() en el store sólo quita la contraseña, así que el registro salía entero: taxId (el
// número de identificación fiscal — SSN o EIN), domicilio, teléfono, tipo y tasa de comisión, y
// vía withStats() también commissionsPaid. Con el GET autorizado al rol AGENT en index.js, eso
// significaba que cualquier agente se descargaba el número fiscal de todos sus compañeros y lo
// que cobra cada uno.
function forNonAdmin(agent) {
  return { id: agent.id, name: agent.name, companyName: agent.companyName, status: agent.status };
}

router.get("/", async (req, res) => {
  // basic=1: para los desplegables, la ficha sin estadísticas (que cuestan la lista de
  // cotizaciones y una consulta de pagos por petición).
  const agents = req.query.basic ? store.listBasic() : await store.list();
  res.json(req.user.role === "ADMIN" ? agents : agents.map(forNonAdmin));
});

router.get("/:id", async (req, res) => {
  const item = await store.get(req.params.id);
  if (!item) return res.status(404).json({ error: "Agent not found" });
  // Un agente sí ve su propia ficha completa: son sus datos y su comisión.
  if (req.user.role !== "ADMIN" && item.id !== req.user.entityId) {
    return res.json(forNonAdmin(item));
  }
  res.json(item);
});

// POST/PUT/DELETE ya son ADMIN por el requireMethodRole del montaje en index.js.
router.post("/", async (req, res) => res.status(201).json(await store.create(req.body)));

router.put("/:id", async (req, res) => {
  const item = await store.update(req.params.id, req.body);
  if (!item) return res.status(404).json({ error: "Agent not found" });
  res.json(item);
});

router.delete("/:id", async (req, res) => {
  if (!(await store.remove(req.params.id))) return res.status(404).json({ error: "Agent not found" });
  res.status(204).end();
});

module.exports = router;
