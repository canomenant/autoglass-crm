const express = require("express");
const store = require("../store/technicians.store");

const router = express.Router();

// Lo que el panel de asignación necesita para un no-admin: quién es y a qué teléfono se le manda
// la orden. Tarifas, correo, dirección, número fiscal y estadísticas se quedan en la oficina.
function forNonAdmin(t) {
  return { id: t.id, name: t.name, status: t.status, phone: t.phone };
}

router.get("/", async (req, res) => {
  const items = await store.list();
  res.json(req.user.role === "ADMIN" ? items : items.map(forNonAdmin));
});

router.get("/:id", async (req, res) => {
  const item = await store.get(req.params.id);
  if (!item) return res.status(404).json({ error: "Technician not found" });
  res.json(req.user.role === "ADMIN" ? item : forNonAdmin(item));
});

router.post("/", async (req, res) => res.status(201).json(await store.create(req.body)));

router.put("/:id", async (req, res) => {
  const item = await store.update(req.params.id, req.body);
  if (!item) return res.status(404).json({ error: "Technician not found" });
  res.json(item);
});

router.delete("/:id", async (req, res) => {
  if (!(await store.remove(req.params.id))) return res.status(404).json({ error: "Technician not found" });
  res.status(204).end();
});

module.exports = router;
