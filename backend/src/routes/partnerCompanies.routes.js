const express = require("express");
const store = require("../store/partnerCompanies.store");

const router = express.Router();

// leadPrice es lo que la empresa PAGA por cada lead de ese socio: un término comercial, no un
// dato de la cotización. El montaje autoriza GET a AGENT porque el formulario de cotización y el
// informe de perdidas necesitan poner nombre a un partnerCompanyId — y para eso les basta con
// id y companyName, que es lo que ambos usan.
function forNonAdmin(c) {
  return { id: c.id, companyName: c.companyName, contactName: c.contactName, active: c.active };
}

router.get("/", async (req, res) => {
  const companies = await store.list();
  res.json(req.user.role === "ADMIN" ? companies : companies.map(forNonAdmin));
});

router.get("/:id", async (req, res) => {
  const company = await store.get(req.params.id);
  if (!company) return res.status(404).json({ error: "Partner company not found" });
  res.json(req.user.role === "ADMIN" ? company : forNonAdmin(company));
});

router.post("/", async (req, res) => res.status(201).json(await store.create(req.body)));

router.put("/:id", async (req, res) => {
  const company = await store.update(req.params.id, req.body);
  if (!company) return res.status(404).json({ error: "Partner company not found" });
  res.json(company);
});

router.delete("/:id", async (req, res) => {
  if (!(await store.remove(req.params.id))) return res.status(404).json({ error: "Partner company not found" });
  res.status(204).end();
});

module.exports = router;
