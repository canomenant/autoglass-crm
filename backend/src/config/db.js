const { Pool, types } = require("pg");

// NUMERIC (oid 1700) comes back as a string by default to avoid float rounding loss.
// Parse centrally here so every store's mapRow() can treat money fields as plain JS numbers.
types.setTypeParser(1700, (v) => (v === null ? null : parseFloat(v)));

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

module.exports = pool;
