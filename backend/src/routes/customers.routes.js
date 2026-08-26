const express = require("express");
const store = require("../store/customers.store");
const workOrdersStore = require("../store/workorders.store");
const quotesStore = require("../store/quotes.store");

const router = express.Router();

// Cada rol ve el subconjunto de clientes que su trabajo requiere.
//
// El montaje en index.js autoriza GET a TECHNICIAN, y la lista salía sin filtrar: cualquier
// técnico —incluido uno de una empresa subcontratada, que es como están modelados— se
// descargaba nombre, teléfono, correo, domicilio y vehículo de TODA la cartera en una sola
// petición, sin necesidad de tener ninguna orden asignada.
//
// Devuelve null para ADMIN, que significa "sin filtro".
async function visibleCustomerIds(user) {
  if (user.role === "ADMIN") return null;

  const workOrders = await workOrdersStore.list();
  if (user.role === "TECHNICIAN") {
    return new Set(workOrders.filter((w) => w.technicianId === user.entityId).map((w) => w.customerId));
  }

  // Un agente ve los clientes de sus cotizaciones y de las órdenes que salieron de ellas.
  const owned = (await quotesStore.list()).filter((q) => q.agentId === user.entityId);
  const ownedQuoteIds = new Set(owned.map((q) => q.id));
  const ids = new Set(owned.map((q) => q.customerId));
  workOrders.filter((w) => ownedQuoteIds.has(w.quoteId)).forEach((w) => ids.add(w.customerId));
  return ids;
}

router.get("/", async (req, res) => {
  const customers = await store.list();
  const allowed = await visibleCustomerIds(req.user);
  res.json(allowed ? customers.filter((c) => allowed.has(c.id)) : customers);
});

router.get("/:id", async (req, res) => {
  const customer = await store.get(req.params.id);
  if (!customer) return res.status(404).json({ error: "Customer not found" });
  const allowed = await visibleCustomerIds(req.user);
  // 404 y no 403: distinguirlos confirma qué ids existen.
  if (allowed && !allowed.has(customer.id)) return res.status(404).json({ error: "Customer not found" });
  res.json(customer);
});

router.post("/", async (req, res) => res.status(201).json(await store.create({ ...req.body, createdBy: req.user.name })));

router.put("/:id", async (req, res) => {
  const customer = await store.update(req.params.id, { ...req.body, updatedBy: req.user.name });
  if (!customer) return res.status(404).json({ error: "Customer not found" });
  res.json(customer);
});

router.delete("/:id", async (req, res) => {
  if (!(await store.remove(req.params.id))) return res.status(404).json({ error: "Customer not found" });
  res.status(204).end();
});

module.exports = router;
