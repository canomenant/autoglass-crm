require("dotenv").config();
const crypto = require("crypto");
const pool = require("../src/config/db");
const { initPostgres } = require("../src/lib/initPostgres");
// users.store.js reads app_data into its module-level cache the moment it's required, via
// persistence.js's loadOrSeed() — that has to happen AFTER initPostgres() populates the shared
// pg cache, or this script silently writes to the local JSON file only (invisible to the running
// server, which boots from app_data). Bit us once already while building this script.

// Idempotent by email (same pattern as add-technician-password.js) — safe to re-run. The password
// is generated here, not passed as a CLI arg, so it never sits in shell history or a tool-call log
// — it's only ever visible in this script's own stdout, printed once.
function genPassword() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#%";
  const bytes = crypto.randomBytes(20);
  let out = "";
  for (let i = 0; i < 20; i++) out += chars[bytes[i] % chars.length];
  return out;
}

async function main() {
  const email = process.argv[2];
  const name = process.argv[3] || "Admin";
  if (!email) {
    console.error("Usage: node scripts/seed-real-admin.js <email> [name]");
    process.exit(1);
  }

  await initPostgres();
  const usersStore = require("../src/store/users.store");

  const password = genPassword();
  const existing = usersStore.findByEmail(email);

  if (existing) {
    await usersStore.update(existing.id, { role: "Admin", password, mustChangePassword: true });
    console.log(`Updated existing users.store record #${existing.id} (${email}) — role set to Admin, password reset.`);
  } else {
    const created = await usersStore.create({ name, email, role: "Admin", password });
    console.log(`Created users.store record #${created.id} (${email}) with role Admin.`);
  }

  console.log(`\nBootstrap password (shown once — change it immediately via the app's Change Password screen):\n${password}\n`);

  // save() syncs to app_data fire-and-forget (never awaited, by design — see persistence.js).
  // pool.end() alone isn't reliably synchronized with that in-flight query, so give it a moment
  // before closing the pool — confirmed empirically that pool.end() right after create() can
  // still race the sync and leave app_data stale.
  await new Promise((resolve) => setTimeout(resolve, 1500));
  await pool.end();
}

main().catch((e) => {
  console.error("seed-real-admin failed:", e.message);
  process.exit(1);
});
