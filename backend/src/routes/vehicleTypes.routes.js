const express = require("express");
const store = require("../store/vehicleTypes.store");

const router = express.Router();

// --- cascade -----------------------------------------------------------------
// Each level takes the one above it as a query parameter and answers only for that. Declared
// before "/:id" so "cascade" is never read as an id.
//
// These return names, not ids: the quote's vehicle is stored as { year, make, model, bodyType }
// text and that is not changing — a catalog id on the quote would break the moment a catalog row
// is edited or removed, which is exactly the trap the part-number line items avoided.
router.get("/cascade/years", async (req, res) => res.json({ years: store.years() }));

router.get("/cascade/makes", async (req, res) => {
  const { year } = req.query;
  if (!year) return res.status(400).json({ error: "year is required." });
  res.json({ year: Number(year), makes: store.makes(year) });
});

router.get("/cascade/models", async (req, res) => {
  const { year, make } = req.query;
  if (!year || !make) return res.status(400).json({ error: "year and make are required." });
  res.json({ year: Number(year), make, models: store.models(year, make) });
});

// `source` says where the list came from: "exact" for this year/make/model, "model" borrowed from
// the same model in other years, "taxonomy" for the full list when nothing is known. The client
// shows the distinction rather than presenting a guess as a filtered result.
router.get("/cascade/body-types", async (req, res) => {
  const { year, make, model } = req.query;
  if (!year || !make || !model) return res.status(400).json({ error: "year, make and model are required." });
  res.json(store.bodyTypes(year, make, model));
});

router.get("/", async (req, res) => res.json(await store.list()));

router.post("/", async (req, res) => {
  const { created, duplicate } = await store.create(req.body, req.user?.name);
  // 409 with the row that already exists — the quote form offers to select it, which is what the
  // user wanted in the first place.
  if (!created) {
    return res.status(409).json({
      error: "That vehicle is already in the catalog.",
      duplicate: true,
      existing: duplicate,
    });
  }
  res.status(201).json(created);
});

router.put("/:id", async (req, res) => {
  const item = await store.update(req.params.id, req.body);
  if (!item) return res.status(404).json({ error: "Not found" });
  res.json(item);
});

router.delete("/:id", async (req, res) => {
  if (!(await store.remove(req.params.id))) return res.status(404).json({ error: "Not found" });
  res.status(204).end();
});

module.exports = router;
