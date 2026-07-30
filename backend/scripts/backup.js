const { backup } = require("../src/lib/persistence");

const label = process.argv[2] || "";
const dest = backup(label);
console.log(`Backup created: ${dest}`);
