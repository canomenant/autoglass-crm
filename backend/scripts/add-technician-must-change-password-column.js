require("dotenv").config();
const pool = require("../src/config/db");

// Support for the mustChangePassword flag (agents/users get it for free since they're JSON-store
// records) — technicians live in SQL, so this needs an actual column. Existing rows default to
// false: nobody's forcing all 15 seeded technicians through a change-password redirect on their
// next login just because this column now exists; that only starts applying going forward, when
// an admin resets someone's password or a new technician is created with one.
async function main() {
  await pool.query("ALTER TABLE technicians ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN NOT NULL DEFAULT false");
  console.log("technicians.must_change_password column ready.");
  await pool.end();
}

main().catch((e) => {
  console.error("add-technician-must-change-password-column failed:", e.message);
  process.exit(1);
});
