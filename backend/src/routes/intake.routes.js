const express = require("express");
const quotesStore = require("../store/quotes.store");
const insuranceStore = require("../store/insurance.store");

const router = express.Router();

function sanitizeForCustomer(quote) {
  return {
    id: quote.id,
    quoteNo: quote.quoteNo,
    status: quote.status,
    intakeCompletedAt: quote.intakeCompletedAt,
    newCustomer: quote.newCustomer,
    zipCode: quote.zipCode,
    vehicle: quote.vehicle,
    insuranceCompanyId: quote.insuranceCompanyId,
    policyNumber: quote.policyNumber,
    claimNumber: quote.claimNumber,
    glassType: quote.glassType,
    damageNotes: quote.damageNotes,
    intakePhotos: quote.intakePhotos,
  };
}

router.get("/:token", async (req, res) => {
  const quote = await quotesStore.getByIntakeToken(req.params.token);
  if (!quote) return res.status(404).json({ error: "Intake link not found" });
  if (quote.intakeTokenExpiresAt && new Date(quote.intakeTokenExpiresAt).getTime() < Date.now()) {
    return res.status(410).json({ error: "This intake link has expired" });
  }

  const updated = (await quotesStore.markIntakeOpened(req.params.token)) || quote;
  const insuranceCompanies = await insuranceStore.list();
  res.json({
    quote: sanitizeForCustomer(updated),
    insuranceCompanies: insuranceCompanies.map((c) => ({ id: c.id, name: c.name })),
  });
});

router.put("/:token", async (req, res) => {
  const quote = await quotesStore.getByIntakeToken(req.params.token);
  if (!quote) return res.status(404).json({ error: "Intake link not found" });
  if (quote.intakeTokenExpiresAt && new Date(quote.intakeTokenExpiresAt).getTime() < Date.now()) {
    return res.status(410).json({ error: "This intake link has expired" });
  }

  const updated = await quotesStore.submitIntake(req.params.token, req.body);
  if (!updated) return res.status(404).json({ error: "Intake link not found" });
  res.json({ quote: sanitizeForCustomer(updated) });
});

router.get("/:token/vin-decode/:vin", async (req, res) => {
  const quote = await quotesStore.getByIntakeToken(req.params.token);
  if (!quote) return res.status(404).json({ error: "Intake link not found" });

  const vin = (req.params.vin || "").trim();
  if (vin.length !== 17) return res.status(400).json({ error: "VIN must be 17 characters" });

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 6000);
    const response = await fetch(`https://vpic.nhtsa.dot.gov/api/vehicles/decodevinvalues/${encodeURIComponent(vin)}?format=json`, {
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!response.ok) return res.json({});

    const data = await response.json();
    const result = data?.Results?.[0] || {};
    res.json({
      year: result.ModelYear || "",
      make: result.Make || "",
      model: result.Model || "",
      bodyType: result.BodyClass || "",
    });
  } catch {
    res.json({});
  }
});

module.exports = router;
