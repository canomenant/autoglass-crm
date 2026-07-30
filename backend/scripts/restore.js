const { listBackups, restore } = require("../src/lib/persistence");

const name = process.argv[2];

if (!name) {
  const backups = listBackups();
  if (backups.length === 0) {
    console.log("No backups found.");
  } else {
    console.log("Available backups (newest first):");
    backups.forEach((b) => console.log(`  ${b}`));
    console.log("\nUsage: node scripts/restore.js <backup-name>");
  }
  process.exit(0);
}

restore(name);
console.log(`Restored from backup: ${name}`);
console.log("Restart the backend server to load the restored data.");
