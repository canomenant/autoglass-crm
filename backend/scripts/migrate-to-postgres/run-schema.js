require("dotenv").config();
const fs = require("fs");
const path = require("path");
const pool = require("../../src/config/db");

async function main() {
  const reset = process.argv.includes("--reset");
  const client = await pool.connect();
  try {
    if (reset) {
      console.log("Resetting schema...");
      await client.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
    }
    const sql = fs.readFileSync(path.join(__dirname, "schema.sql"), "utf-8");
    console.log("Applying schema.sql...");
    await client.query(sql);
    console.log("Schema applied successfully.");
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error("Failed to apply schema:", err.message);
  process.exit(1);
});
