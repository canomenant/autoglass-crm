const bcrypt = require("bcryptjs");

const BCRYPT_HASH_RE = /^\$2[aby]\$\d{2}\$/;
const MIN_LENGTH = 8;

// Every store (agents/technicians/users) routes password writes through this one function, so
// this is the single choke point for the length rule — the frontend also checks it for instant
// feedback, but this is what actually stops a too-short password from being persisted, including
// via a direct API call that bypasses the UI entirely.
async function hashPassword(plain) {
  if (!plain || plain.length < MIN_LENGTH) {
    throw new Error(`Password must be at least ${MIN_LENGTH} characters.`);
  }
  return bcrypt.hash(plain, 12);
}

function isBcryptHash(stored) {
  return BCRYPT_HASH_RE.test(stored || "");
}

// Legacy rows still hold plaintext from before this migration; new writes are always hashed by
// the stores (see agents/technicians/users store `create`/`update`). A missing/empty stored
// password must never validate — without this guard, an account nobody has set a password for
// yet would accept `{ password: "" }` as a login.
async function verifyPassword(plain, stored) {
  if (!stored) return { valid: false, needsRehash: false };
  if (isBcryptHash(stored)) {
    return { valid: await bcrypt.compare(plain, stored), needsRehash: false };
  }
  const valid = plain === stored;
  return { valid, needsRehash: valid };
}

module.exports = { hashPassword, isBcryptHash, verifyPassword };
