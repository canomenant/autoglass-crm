const express = require("express");
const store = require("../store/presence.store");

const router = express.Router();

router.post("/ping", (req, res) => {
  res.json(store.ping(req.user, req.body.currentPage));
});

router.get("/", (req, res) => {
  res.json(store.list().map((s) => ({ ...s, status: "Online" })));
});

router.get("/active-users", (req, res) => {
  res.json(
    store.list().map((s) => ({
      id: s.userId,
      name: s.userName,
      role: s.role,
      avatar_url: null,
      last_active_at: new Date(s.lastSeen).toISOString(),
    }))
  );
});

module.exports = router;
