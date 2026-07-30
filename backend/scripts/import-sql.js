require("dotenv").config();
const fs = require("fs");
const path = require("path");
const mysql = require("mysql2/promise");

const SQL_DIR = process.argv[2] || path.join(__dirname, "..", "sql");

async function main() {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    multipleStatements: true,
  });

  const files = fs.readdirSync(SQL_DIR).filter((f) => f.endsWith(".sql")).sort();
  if (!files.length) {
    console.error(`No .sql files found in ${SQL_DIR}`);
    process.exit(1);
  }

  for (const file of files) {
    const sql = fs.readFileSync(path.join(SQL_DIR, file), "utf-8");
    console.log(`Importing ${file}...`);
    await conn.query(sql);
  }

  console.log("Import complete.");
  await conn.end();
}

main().catch((err) => {
  console.error("Import failed:", err.message);
  process.exit(1);
});
