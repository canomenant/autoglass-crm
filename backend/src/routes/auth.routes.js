const express = require("express");
const jwt = require("jsonwebtoken");
const agentsStore = require("../store/agents.store");
const techniciansStore = require("../store/technicians.store");
const usersStore = require("../store/users.store");
const { verifyPassword } = require("../lib/password");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

// users.store roles (Admin/Tech/Sales/Employee) are a different, older vocabulary than the JWT
// roles (ADMIN/AGENT/TECHNICIAN) the rest of the app checks — only "Admin" has a defined mapping
// today. A "Sales"/"Tech"/"Employee" users.store record intentionally can't log in yet.
const USERS_ROLE_MAP = { Admin: "ADMIN" };

function issueToken(res, payload) {
  const token = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: "8h" });
  res.json({ token, user: payload });
}

router.post("/login", async (req, res) => {
  const { email, password } = req.body;

  // Break-glass path: only reachable when both vars are explicitly set (e.g. in Railway), so it's
  // off by default with no hardcoded credential to leak.
  if (
    process.env.EMERGENCY_ADMIN_EMAIL &&
    process.env.EMERGENCY_ADMIN_PASSWORD &&
    email === process.env.EMERGENCY_ADMIN_EMAIL &&
    password === process.env.EMERGENCY_ADMIN_PASSWORD
  ) {
    return issueToken(res, { id: "emergency-admin", email, name: "Emergency Admin", role: "ADMIN", entityId: null, mustChangePassword: false });
  }

  const user = usersStore.findByEmail(email);
  const mappedRole = user && USERS_ROLE_MAP[user.role];
  if (user && mappedRole) {
    const { valid, needsRehash } = await verifyPassword(password, user.password);
    if (valid) {
      if (needsRehash) usersStore.update(user.id, { password }).catch((e) => console.error("rehash failed:", e.message));
      return issueToken(res, { id: `user-${user.id}`, email: user.email, name: user.name, role: mappedRole, entityId: user.id, mustChangePassword: user.mustChangePassword });
    }
  }

  const agent = agentsStore.findByEmail(email);
  if (agent) {
    const { valid, needsRehash } = await verifyPassword(password, agent.password);
    if (valid) {
      if (agent.status !== "Active") return res.status(401).json({ error: "This account is inactive" });
      if (needsRehash) agentsStore.update(agent.id, { password }).catch((e) => console.error("rehash failed:", e.message));
      return issueToken(res, { id: `agent-${agent.id}`, email: agent.email, name: agent.name, role: "AGENT", entityId: agent.id, mustChangePassword: agent.mustChangePassword });
    }
  }

  const technician = await techniciansStore.findByEmail(email);
  if (technician) {
    const { valid, needsRehash } = await verifyPassword(password, technician.password);
    if (valid) {
      if (technician.status !== "Active") return res.status(401).json({ error: "This account is inactive" });
      if (needsRehash) techniciansStore.update(technician.id, { password }).catch((e) => console.error("rehash failed:", e.message));
      return issueToken(res, { id: `tech-${technician.id}`, email: technician.email, name: technician.name, role: "TECHNICIAN", entityId: technician.id, mustChangePassword: technician.mustChangePassword });
    }
  }

  return res.status(401).json({ error: "Invalid credentials" });
});

router.post("/forgot-password", (req, res) => {
  res.json({ message: "If the account exists, a reset link was sent." });
});

router.post("/change-password", requireAuth, async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  const { role, entityId } = req.user;

  if (entityId == null) {
    return res.status(400).json({ error: "This account cannot change its password here." });
  }
  if (!newPassword || newPassword.length < 8) {
    return res.status(400).json({ error: "New password must be at least 8 characters." });
  }

  const store = { ADMIN: usersStore, AGENT: agentsStore, TECHNICIAN: techniciansStore }[role];
  if (!store) return res.status(400).json({ error: "This account cannot change its password here." });

  // findByEmail (unlike list/get) returns the unsanitized record — the password hash is needed
  // here to verify currentPassword, and every store's findByEmail already returns it raw.
  const record = await store.findByEmail(req.user.email);
  if (!record) return res.status(404).json({ error: "Account not found" });

  const { valid } = await verifyPassword(currentPassword, record.password);
  if (!valid) return res.status(401).json({ error: "Current password is incorrect" });

  await store.update(entityId, { password: newPassword, mustChangePassword: false });
  res.json({ message: "Password updated." });
});

module.exports = router;
