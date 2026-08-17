require("dotenv").config();
const pool = require("../src/config/db");

// Backfills work_orders.state (and propagates to linked quotes.state) for the 3,865 historical
// work orders, derived entirely from work_orders.address — the only field with usable coverage
// (customers.state, technicians.state, and every quote's zip_code are 0% populated; see the
// diagnostic that preceded this script). Four passes, most confident first, each only touching
// rows the previous pass left NULL:
//   1. Explicit state string in the address ("CA"/"California"/"TX"/"Texas", case-insensitive)
//   2. Known city name (approved list below)
//   3. Inline ZIP code in the address text, resolved via the zip_codes catalog (6 specific rows)
//   4. Individually-confirmed typo corrections (3 specific rows) — NOT a general rule
// Anything still NULL after all four stays NULL — no guessing.

const CA_CITIES = [
  "Los Angeles", "La Puente", "Cypress", "South San Francisco", "San Clemente", "Woodland",
  "Irvine", "Rancho Cordova", "Anaheim", "Anahiem", "Aneheim", "Hercules", "Loma Linda",
  "Garden Grove", "Ladera Ranch", "Camarillo", "Seal Beach", "Hawaiian Gardens", "Pacoima",
  "Yucaipa", "Santa Ana", "San Bruno", "San Dimas", "Sherman Oaks", "Fullerton", "Ontario",
  "Gardenia", "Rancho Murietta", "San Francisco", "Placentia", "Huntington Beach", "Daly City",
  "Long Beach", "Long Bach", "Alameda", "Chatsworth", "Upland", "Laguna Hills", "Monrovia",
  "San Mateo", "San Jose", "Lake Forest", "Wildomar", "Moreno Valley", "Oakland", "Menifee",
  "Harbor City", "Dana Point", "Santa Clarita", "Homeland", "Walnut Creek", "Antelope",
  "Lake Elsinore", "San Juan Capistrano", "Newport Beach", "Sacramento", "Sacramanto",
  "Woodland hill", "Lawndale", "Calabasas", "Calbasas", "Oak View", "Castro Valley",
  "Yorba Linda", "Pleasanton", "Vacaville", "Lancaster", "Riverside", "North Hollywood",
  "Milpitas", "Oak Park", "Laguna each", "Buena Park", "Lincoln", "Perris", "West Hills",
  "Van Nuys", "Panorama City", "Canoga Park", "Torrance", "Rancho Cucamonga", "Elk Grove",
  "Fair Oaks", "West Hollywood", "San Pedro", "Rancho Santa Margarita", "Murrieta",
  "Mission Viejo", "Half moon bay", "El Granada", "Pear blossom", "Pearblossom",
  "Santa Fe Springs",
];

const TX_CITIES = [
  "Houston", "Katy", "League City", "Wylie", "Georgetown", "Lago Vista", "San Antonio",
  "New Braunfels", "La Vernia", "Austin", "Friendswood", "Buda", "Round Rock", "Fort Worth",
  "Ft Worth", "Hutto", "North Richland Hills", "Dallas", "Schertz", "Wimberley", "Wimberly",
  "Poteet", "McKinney", "Converse",
];

// Pass 3: address has an inline ZIP but no recognizable city string. Resolved via the
// zip_codes catalog (confirmed all 6 present) rather than a blanket digit-regex, since a street
// number can also be 5 digits — targeting exact work orders avoids that false-positive risk.
const ZIP_OVERRIDES = [
  { workOrderNo: "Wo-3330", zip: "94103" },
  { workOrderNo: "Wo-3445", zip: "92833" },
  { workOrderNo: "Wo-3457", zip: "77024" },
  { workOrderNo: "Wo-3460", zip: "78610" },
  { workOrderNo: "Wo-3514", zip: "75495" },
  { workOrderNo: "Wo-3662", zip: "94116" },
];

// Pass 4: individually-confirmed typo corrections. Not folded into CA_CITIES/TX_CITIES on
// purpose — these are one-off misreadings of a single historical record, not a real city-name
// variant worth matching against every future address.
const TYPO_OVERRIDES = [
  { workOrderNo: "Wo-3692", state: "TX" }, // "San Atonio" -> San Antonio
  { workOrderNo: "Wo-3814", state: "TX" }, // "Cibilio" -> Cibolo
  { workOrderNo: "Wo-1192", state: "TX" }, // "Liberty Hills" -> Liberty Hill
];

function orCond(column, values) {
  return values.map((v) => `${column} ILIKE '%${v.replace(/'/g, "''")}%'`).join(" OR ");
}

async function main() {
  await pool.query("ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS state TEXT");
  await pool.query("ALTER TABLE quotes ADD COLUMN IF NOT EXISTS state TEXT");
  console.log("Columns ready.");

  // Pass 1: explicit state string.
  const p1ca = await pool.query(
    `UPDATE work_orders SET state = 'CA' WHERE active <> false AND state IS NULL AND address ~* '\\y(CA|California)\\y'`
  );
  const p1tx = await pool.query(
    `UPDATE work_orders SET state = 'TX' WHERE active <> false AND state IS NULL AND address ~* '\\y(TX|Texas)\\y'`
  );
  console.log(`Pass 1 (state string): +${p1ca.rowCount} CA, +${p1tx.rowCount} TX`);

  // Pass 2: known city names.
  const p2ca = await pool.query(
    `UPDATE work_orders SET state = 'CA' WHERE active <> false AND state IS NULL AND (${orCond("address", CA_CITIES)})`
  );
  const p2tx = await pool.query(
    `UPDATE work_orders SET state = 'TX' WHERE active <> false AND state IS NULL AND (${orCond("address", TX_CITIES)})`
  );
  console.log(`Pass 2 (city list): +${p2ca.rowCount} CA, +${p2tx.rowCount} TX`);

  // Pass 3: inline ZIP resolved via zip_codes catalog, targeted rows only.
  let p3count = 0;
  for (const { workOrderNo, zip } of ZIP_OVERRIDES) {
    const r = await pool.query(
      `UPDATE work_orders w SET state = z.state
       FROM zip_codes z
       WHERE w.work_order_no = $1 AND w.state IS NULL AND z.zipcode = $2`,
      [workOrderNo, zip]
    );
    p3count += r.rowCount;
  }
  console.log(`Pass 3 (ZIP via catalog): +${p3count}`);

  // Pass 4: confirmed individual typo corrections.
  let p4count = 0;
  for (const { workOrderNo, state } of TYPO_OVERRIDES) {
    const r = await pool.query(
      `UPDATE work_orders SET state = $1 WHERE work_order_no = $2 AND state IS NULL`,
      [state, workOrderNo]
    );
    p4count += r.rowCount;
  }
  console.log(`Pass 4 (typo overrides): +${p4count}`);

  // Bonus: propagate the now-resolved work order state to its source quote — a lossless copy
  // of already-validated data, not a new inference, so it doesn't need its own confidence pass.
  const propagated = await pool.query(`
    UPDATE quotes q SET state = w.state
    FROM work_orders w
    WHERE w.quote_id = q.id AND w.state IS NOT NULL AND q.state IS NULL AND q.active <> false
  `);
  console.log(`Propagated to linked quotes: +${propagated.rowCount}`);

  // Summary.
  const summary = await pool.query(
    `SELECT state, COUNT(*) FROM work_orders WHERE active <> false GROUP BY state ORDER BY 2 DESC`
  );
  console.log("\nFinal work_orders.state distribution:", summary.rows);

  const stillNull = await pool.query(
    `SELECT work_order_no, address FROM work_orders WHERE active <> false AND state IS NULL ORDER BY work_order_no`
  );
  console.log(`\nStill NULL (${stillNull.rows.length}), for manual review:`);
  stillNull.rows.forEach((r) => console.log(`  ${r.work_order_no}: ${JSON.stringify(r.address)}`));

  await pool.end();
}

main().catch((e) => {
  console.error("backfill-work-order-state failed:", e.message);
  process.exit(1);
});
