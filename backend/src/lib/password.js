const bcrypt = require("bcryptjs");

const BCRYPT_HASH_RE = /^\$2[aby]\$\d{2}\$/;

async function hashPassword(plain) {
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
