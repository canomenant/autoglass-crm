const express = require("express");
const jwt = require("jsonwebtoken");
const agentsStore = require("../store/agents.store");
const techniciansStore = require("../store/technicians.store");

const router = express.Router();

const DEMO_USER = {
  id: 1,
  email: "demo@llamara.com",
  password: "Demo1234",
  role: "ADMIN",
  name: "Demo Admin",
};

function issueToken(res, payload) {
  const token = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: "8h" });
  res.json({ token, user: payload });
}

router.post("/login", async (req, res) => {
  const { email, password } = req.body;

  if (email === DEMO_USER.email && password === DEMO_USER.password) {
    return issueToken(res, { id: DEMO_USER.id, email: DEMO_USER.email, name: DEMO_USER.name, role: "ADMIN", entityId: null });
  }

  const agent = agentsStore.findByEmail(email);
  if (agent && agent.password === password) {
    if (agent.status !== "Active") return res.status(401).json({ error: "This account is inactive" });
    return issueToken(res, { id: `agent-${agent.id}`, email: agent.email, name: agent.name, role: "AGENT", entityId: agent.id });
  }

  const technician = await techniciansStore.findByEmail(email);
  if (technician && technician.password === password) {
    if (technician.status !== "Active") return res.status(401).json({ error: "This account is inactive" });
    return issueToken(res, { id: `tech-${technician.id}`, email: technician.email, name: technician.name, role: "TECHNICIAN", entityId: technician.id });
  }

  return res.status(401).json({ error: "Invalid credentials" });
});

router.post("/forgot-password", (req, res) => {
  res.json({ message: "If the account exists, a reset link was sent." });
});

module.exports = router;
