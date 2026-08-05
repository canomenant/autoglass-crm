const distributorsStore = require("./store/distributors.store");
const techniciansStore = require("./store/technicians.store");
const agentsStore = require("./store/agents.store");

const DISTRIBUTORS = [
  "PGW San Antonio", "Mygrant Houston", "Mygrant Austin", "Mygrant Anaheim", "Mygrant Irving",
  "Mygrant Oakland", "Mygrant La Puente", "Pilkington Sacramento", "PGW Gardena", "Mygrant Sacramento",
  "Mygrant Riverside", "Mygrant Martinez", "Pilkington LA", "PGW Riverside", "PGW Houston",
  "Mygrant Hayward", "Mygrant San Francisco", "Mygrant Compton", "Pilkington San Jose", "PGW Sacramento",
  "Import Glass Corporation", "Mygrant San Jose", "Dealer Part", "PGW Austin", "Affordable",
  "PGW Dallas", "MYG Carrolton", "Reyes Auto Glass",
];

const TECHNICIANS = [
  "Aaron Gomez", "Sague Auto Glass", "Mauricio Recinos", "Joel Alexander", "Jesus Campos",
  "Nelson Edison", "Shine City Auto Glass", "Jeff Auto Glass", "Cirilo Jr", "Canos Auto Glass Inc.",
  "Auto Concierge Glass and Detail", "Junner Mero", "Tech Part", "777 Auto Glass", "San Saechao",
];

const AGENTS = [
  "Marco Cano", "Richard Salgado", "Alex Reyes", "Golbal Office Works",
  "Digiclique Digital Marketing Services", "Edgar Medina", "Jose Reyes",
];

function slugEmail(name, domain) {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .trim()
    .replace(/\s+/g, ".");
  return `${slug}@${domain}`;
}

async function seed() {
  if ((await distributorsStore.list()).length === 0) {
    DISTRIBUTORS.forEach((name) => distributorsStore.create({ name }));
  }

  if ((await techniciansStore.list()).length === 0) {
    TECHNICIANS.forEach((name) =>
      techniciansStore.create({ name, email: slugEmail(name, "reyesautoglass.com"), password: "Tech1234" })
    );
  }

  if ((await agentsStore.list()).length === 0) {
    AGENTS.forEach((name) =>
      agentsStore.create({ name, email: slugEmail(name, "reyesautoglass.com"), password: "Agent1234" })
    );
  }
}

module.exports = { seed };
