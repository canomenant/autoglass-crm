require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { execFile } = require("child_process");

const BACKUPS_DIR = path.join(__dirname, "..", "backups-pg");

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, (err, stdout, stderr) => {
      if (err) return reject(new Error(stderr || err.message));
      resolve(stdout);
    });
  });
}

async function hasLocalPgDump() {
  try {
    await run("pg_dump", ["--version"]);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  const label = process.argv[2] || "";
  fs.mkdirSync(BACKUPS_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const fileName = `${stamp}${label ? "_" + label : ""}.dump`;
  const destPath = path.join(BACKUPS_DIR, fileName);

  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) throw new Error("DATABASE_URL is not set");

  if (await hasLocalPgDump()) {
    await run("pg_dump", ["--format=custom", dbUrl, "-f", destPath]);
    console.log(`Backup created: ${destPath}`);
  } else {
    // Fallback for local dev: dump inside the Docker Postgres container, then copy out.
    const containerName = process.env.PG_CONTAINER_NAME || "autoglass-crm-postgres";
    const tmpPath = `/tmp/${fileName}`;
    await run("docker", ["exec", containerName, "pg_dump", "--format=custom", "-U", "autoglass", "-d", "autoglass_crm", "-f", tmpPath]);
    await run("docker", ["cp", `${containerName}:${tmpPath}`, destPath]);
    await run("docker", ["exec", containerName, "rm", tmpPath]);
    console.log(`Backup created via docker exec fallback: ${destPath}`);
  }
}

main().catch((err) => {
  console.error("pg-backup failed:", err.message);
  process.exit(1);
});
