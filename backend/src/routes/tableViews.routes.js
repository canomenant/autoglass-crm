const express = require("express");
const store = require("../store/tableViews.store");
const { actorFrom: actor } = require("../lib/actor");

const router = express.Router();

// Una vista Personal pertenece a quien la creó.
//
// Antes el propietario salía de `req.query.performedBy`, que lo escribe quien llama: bastaba
// pasar el nombre de otra persona para leer sus vistas personales. Y PUT, set-default y DELETE
// no comprobaban propiedad en absoluto — operaban sobre el id a secas, que es un entero
// correlativo, así que cualquiera podía reescribir o borrar las vistas guardadas del
// administrador iterando ids.
//
// 404 y no 403: distinguirlos confirma qué ids existen.
function denyUnlessOwner(view, userName) {
  if (!view) return { status: 404, error: "View not found" };
  if (view.scope === "Personal" && view.userName !== userName) {
    return { status: 404, error: "View not found" };
  }
  return null;
}

router.get("/", async (req, res) => {
  if (!req.query.module) return res.status(400).json({ error: "module is required" });
  res.json(await store.list(req.query.module, actor(req)));
});

router.post("/", async (req, res) => {
  // Una vista de empresa la ve todo el mundo, así que crearla es una decisión de administración.
  if (req.body?.scope === "Company" && req.user.role !== "ADMIN") {
    return res.status(403).json({ error: "Only an admin can create a company-wide view." });
  }
  const view = await store.create(req.body, actor(req));
  res.status(201).json(view);
});

router.put("/:id", async (req, res) => {
  const denied = denyUnlessOwner(store.get(req.params.id), actor(req));
  if (denied) return res.status(denied.status).json({ error: denied.error });

  const view = await store.update(req.params.id, req.body);
  if (!view) return res.status(404).json({ error: "View not found" });
  res.json(view);
});

router.post("/:id/set-default", async (req, res) => {
  const denied = denyUnlessOwner(store.get(req.params.id), actor(req));
  if (denied) return res.status(denied.status).json({ error: denied.error });

  const view = await store.setDefault(req.params.id, actor(req));
  if (!view) return res.status(404).json({ error: "View not found" });
  res.json(view);
});

router.delete("/:id", async (req, res) => {
  const denied = denyUnlessOwner(store.get(req.params.id), actor(req));
  if (denied) return res.status(denied.status).json({ error: denied.error });

  const ok = await store.remove(req.params.id);
  if (!ok) return res.status(404).json({ error: "View not found" });
  res.status(204).end();
});

module.exports = router;
