// Moves the agent logins out of the repo and into app_data, and rotates them.
//
//   cd backend && node scripts/migrate-agent-passwords.js          # dry run
//   cd backend && node scripts/migrate-agent-passwords.js --apply  # rotates and writes
//
// backend/data/agents.json was the only copy of the agents' passwords, and it was tracked in git.
// Every other file in backend/data/ was untracked in ded2e96; this one could not be, because
// initPostgres.js keeps "agents.json" out of the Postgres cache — app_data's copy came from
// cat_agent, which has no password field, so loading it would have locked every agent out.
//
// This closes that loop: put the real records, hashes included, into app_data so the exclusion is
// no longer needed. users.json already works exactly this way, so no new table is required.
//
// Rotation is part of the same pass because untracking a file does not remove it from git history.
// The old hashes are still reachable in every clone of this repo, so the only way to actually end
// the exposure is for those hashes to stop being current.
//
// Verify Agent (id 8) is deleted rather than migrated: created a day after the seven real agents,
// absent from cat_agent, active:false, zero quotes, zero payouts — and holding a 9-character
// plaintext password. verifyPassword() accepts plaintext on its legacy path, so that value is a
// working credential sitting in the repo. It only fails to log in today because findByEmail filters
// active !== false; reactivating the account from Settings would make it usable.
//
// AFTER APPLYING: remove "agents.json" from CACHE_EXCLUDED_KEYS, drop the !data/agents.json
// negation from backend/.gitignore, git rm --cached the file, and restart the backend.
require("dotenv").config();
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const pool = require("../src/config/db");
const { hashPassword, isBcryptHash } = require("../src/lib/password");

const APPLY = process.argv.includes("--apply");
const KEY = "agents.json";
const FILE = path.join(__dirname, "..", "data", "agents.json");
const DELETE_IDS = [8]; // Verify Agent

// No I/l/1/O/0: these get read aloud and typed by hand off a message.
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
function generatePassword(length = 16) {
  const bytes = crypto.randomBytes(length * 2);
  let out = "";
  for (let i = 0; out.length < length; i++) out += ALPHABET[bytes[i] % ALPHABET.length];
  return out;
}

(async () => {
  const local = JSON.parse(fs.readFileSync(FILE, "utf8"));
  const remote = (await pool.query("SELECT value FROM app_data WHERE key = $1", [KEY])).rows[0]?.value || [];

  console.log(`archivo local: ${local.length} agentes   app_data: ${remote.length}\n`);

  const toDelete = local.filter((a) => DELETE_IDS.includes(Number(a.id)));
  const keep = local.filter((a) => !DELETE_IDS.includes(Number(a.id)));

  console.log("=== a eliminar ===");
  for (const a of toDelete) {
    const quotes = (await pool.query("SELECT count(*) n FROM quotes WHERE agent_id = $1 AND active <> false", [a.id])).rows[0].n;
    console.log(`  id ${a.id}  ${a.name} <${a.email}>  active=${a.active}  quotes=${quotes}  password=${isBcryptHash(a.password) ? "bcrypt" : "TEXTO PLANO"}`);
    if (Number(quotes) > 0) throw new Error(`${a.name} tiene ${quotes} quotes — no se elimina automaticamente.`);
  }

  console.log("\n=== a migrar y rotar ===");
  const rotated = [];
  for (const a of keep) {
    const password = generatePassword();
    rotated.push({ id: a.id, name: a.name, email: a.email, password });
    console.log(`  id ${String(a.id).padEnd(3)} ${String(a.name).padEnd(40)} ${a.email}`);
  }

  if (!APPLY) {
    console.log("\nDRY RUN — no se modifico nada. Usar --apply para rotar y escribir.");
    await pool.end();
    return;
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backup = path.join(__dirname, `migrate-agent-passwords-backup-${stamp}.json`);
  fs.writeFileSync(backup, JSON.stringify({ local, remote }, null, 2));
  console.log(`\nrespaldo (contiene los hashes viejos, gitignoreado): scripts/${path.basename(backup)}`);

  const next = [];
  for (const a of keep) {
    const { password } = rotated.find((r) => r.id === a.id);
    next.push({
      ...a,
      password: await hashPassword(password),
      // Forces a change on first login, so these generated values are a handoff and not the
      // password anyone ends up keeping.
      mustChangePassword: true,
      updatedAt: new Date().toISOString(),
    });
  }

  // app_data first: the moment agents.json stops being cache-excluded, this is what the app reads.
  await pool.query(
    `INSERT INTO app_data (key, value, updated_at) VALUES ($1, $2, now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [KEY, JSON.stringify(next)]
  );
  // The local file stays current too — it is the cold-start fallback when Postgres is unreachable,
  // and leaving a stale copy with the pre-rotation hashes would defeat the rotation on that path.
  fs.writeFileSync(FILE, JSON.stringify(next, null, 2));

  const after = (await pool.query("SELECT jsonb_array_length(value) n FROM app_data WHERE key = $1", [KEY])).rows[0].n;
  console.log(`APLICADO: app_data ahora tiene ${after} agentes, todos con bcrypt y mustChangePassword`);

  console.log("\n=== CLAVES NUEVAS — se muestran una sola vez ===\n");
  for (const r of rotated) {
    console.log(`  ${r.name}`);
    console.log(`     ${r.email}`);
    console.log(`     ${r.password}\n`);
  }
  console.log("  Cada agente debe cambiarla en el primer login (mustChangePassword: true).");

  await pool.end();
})();
