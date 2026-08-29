const express = require("express");
const store = require("../store/distributors.store");

const router = express.Router();

// Mismo criterio que en agents.routes.js: el montaje en index.js autoriza GET a AGENT porque un
// agente necesita elegir distribuidor en una cotización, y para eso basta el nombre. La ficha
// completa lleva accountNumber (el número de cuenta bancaria), taxId, y por withStats() también
// el volumen de compra — datos de la relación comercial con el proveedor, no de la cotización.
function forNonAdmin(d) {
  return {
    id: d.id,
    name: d.name,
    contactName: d.contactName,
    phone: d.phone,
    email: d.email,
    city: d.city,
    state: d.state,
    status: d.status,
  };
}

router.get("/", async (req, res) => {
  // basic=1: para los desplegables (cotizaciones, notas), que sólo necesitan la ficha. Las
  // estadísticas cuestan la lista de órdenes y una consulta de pagos, y un desplegable no las mira.
  const distributors = req.query.basic ? store.listBasic() : await store.list();
  res.json(req.user.role === "ADMIN" ? distributors : distributors.map(forNonAdmin));
});

router.get("/:id", async (req, res) => {
  const distributor = await store.get(req.params.id);
  if (!distributor) return res.status(404).json({ error: "Distributor not found" });
  res.json(req.user.role === "ADMIN" ? distributor : forNonAdmin(distributor));
});

router.post("/", async (req, res) => res.status(201).json(await store.create(req.body)));

router.put("/:id", async (req, res) => {
  const distributor = await store.update(req.params.id, req.body);
  if (!distributor) return res.status(404).json({ error: "Distributor not found" });
  res.json(distributor);
});

router.delete("/:id", async (req, res) => {
  if (!(await store.remove(req.params.id))) return res.status(404).json({ error: "Distributor not found" });
  res.status(204).end();
});

module.exports = router;
