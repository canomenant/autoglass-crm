require("dotenv").config();
const crypto = require("crypto");
const agentsStore = require("../src/store/agents.store");
const techniciansStore = require("../src/store/technicians.store");

// Every active agent and technician gets a fresh, random, bcrypt-hashed password (store.update()
// hashes automatically — see lib/password.js) and mustChangePassword: true, replacing whatever
// predictable seed password ("AgentX...", "TechX...") or earlier stopgap they had. Prints a plain
// table to stdout for the admin to distribute — that's the only place these values are ever shown.
function genPassword() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#%";
  const bytes = crypto.randomBytes(16);
  let out = "";
  for (let i = 0; i < 16; i++) out += chars[bytes[i] % chars.length];
  return out;
}

async function main() {
  const rows = [];

  const agents = await agentsStore.list();
  for (const agent of agents.filter((a) => a.status === "Active")) {
    const password = genPassword();
    await agentsStore.update(agent.id, { password, mustChangePassword: true });
    rows.push({ role: "AGENT", name: agent.name, email: agent.email, password });
  }

  const technicians = await techniciansStore.list();
  for (const tech of technicians.filter((t) => t.status === "Active")) {
    const password = genPassword();
    await techniciansStore.update(tech.id, { password, mustChangePassword: true });
    rows.push({ role: "TECHNICIAN", name: tech.name, email: tech.email, password });
  }

  console.log(`\nRotated ${rows.length} passwords (${agents.filter((a) => a.status === "Active").length} agents, ${technicians.filter((t) => t.status === "Active").length} technicians):\n`);
  console.table(rows);
  console.log("\nEveryone is flagged mustChangePassword — the app forces a change on their first login.");
}

main().catch((e) => {
  console.error("rotate-service-passwords failed:", e.message);
  process.exit(1);
});
