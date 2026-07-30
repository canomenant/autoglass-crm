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

async function hasLocalPgRestore() {
  try {
    await run("pg_restore", ["--version"]);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  const fileName = process.argv[2];
  if (!fileName) {
    console.log("Usage: npm run restore:pg -- <dump-file-name>");
    console.log("Available backups:");
    if (fs.existsSync(BACKUPS_DIR)) {
      fs.readdirSync(BACKUPS_DIR).sort().reverse().forEach((f) => console.log(`  ${f}`));
    }
    process.exit(1);
  }

  const srcPath = path.join(BACKUPS_DIR, fileName);
  if (!fs.existsSync(srcPath)) throw new Error(`Backup not found: ${srcPath}`);

  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) throw new Error("DATABASE_URL is not set");

  if (await hasLocalPgRestore()) {
    await run("pg_restore", ["--clean", "--if-exists", "--no-owner", "-d", dbUrl, srcPath]);
    console.log(`Restored from: ${srcPath}`);
  } else {
    const containerName = process.env.PG_CONTAINER_NAME || "autoglass-crm-postgres";
    const tmpPath = `/tmp/${fileName}`;
    await run("docker", ["cp", srcPath, `${containerName}:${tmpPath}`]);
    await run("docker", ["exec", containerName, "pg_restore", "--clean", "--if-exists", "--no-owner", "-U", "autoglass", "-d", "autoglass_crm", tmpPath]);
    await run("docker", ["exec", containerName, "rm", tmpPath]);
    console.log(`Restored via docker exec fallback from: ${srcPath}`);
  }
}

main().catch((err) => {
  console.error("pg-restore failed:", err.message);
  process.exit(1);
});
