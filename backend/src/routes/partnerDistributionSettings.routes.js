const express = require("express");
const store = require("../store/partnerDistributionSettings.store");

const router = express.Router();

router.get("/", async (req, res) => res.json(await store.get()));

router.put("/", async (req, res) => res.json(await store.update(req.body)));

module.exports = router;
