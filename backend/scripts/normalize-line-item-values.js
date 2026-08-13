require("dotenv").config();
const pool = require("../src/config/db");

// Casing-only differences (unambiguous) plus two confirmed same-company rebrands.
const DISTRIBUTOR_MAP = {
  "Pgw Houston": "PGW Houston",
  "Pgw Dallas": "PGW Dallas",
  "Pgw Riverside": "PGW Riverside",
  "Pgw Austin": "PGW Austin",
  "Reyes auto Glass": "Reyes Auto Glass",
  "Pgw San Antonio": "PGW San Antonio",
  "Affordable Glass": "Affordable",
  "Mygrant Carrolton": "MYG Carrolton",
};

// The calibrationTypes catalog uses Spanish names ("Estático"/"Dinámica"); the historical
// import (work_orders_history.calibration_type) used English ("Static"/"Dynamic") — same
// mismatch class as distributor naming, just discovered while auditing this fix.
const CALIBRATION_MAP = {
  Static: "Estático",
  Dynamic: "Dinámica",
};

async function main() {
  const rows = await pool.query(
    "SELECT id, calibration_type, line_items FROM quotes WHERE jsonb_array_length(line_items) > 0 OR (calibration_type IS NOT NULL AND calibration_type != '')"
  );

  let distributorNormalized = 0;
  let calibrationNormalized = 0;
  let topLevelCalibrationNormalized = 0;
  let quotesUpdated = 0;

  for (const q of rows.rows) {
    let changed = false;

    const fixedLineItems = (q.line_items || []).map((li) => {
      let item = li;
      if (item.distributor && DISTRIBUTOR_MAP[item.distributor]) {
        item = { ...item, distributor: DISTRIBUTOR_MAP[item.distributor] };
        distributorNormalized++;
        changed = true;
      }
      if (item.calibrationType && CALIBRATION_MAP[item.calibrationType]) {
        item = { ...item, calibrationType: CALIBRATION_MAP[item.calibrationType] };
        calibrationNormalized++;
        changed = true;
      }
      return item;
    });

    let topLevelCalibration = q.calibration_type;
    if (topLevelCalibration && CALIBRATION_MAP[topLevelCalibration]) {
      topLevelCalibration = CALIBRATION_MAP[topLevelCalibration];
      topLevelCalibrationNormalized++;
      changed = true;
    }

    if (changed) {
      await pool.query(
        "UPDATE quotes SET line_items = $1, calibration_type = $2, updated_at = now() WHERE id = $3",
        [JSON.stringify(fixedLineItems), topLevelCalibration, q.id]
      );
      quotesUpdated++;
    }
  }

  console.log("=== Results ===");
  console.log(`distributor normalized: ${distributorNormalized}`);
  console.log(`line_items[].calibrationType normalized: ${calibrationNormalized}`);
  console.log(`quotes.calibration_type (top-level) normalized: ${topLevelCalibrationNormalized}`);
  console.log(`quotes updated: ${quotesUpdated}`);

  await pool.end();
}

main().catch((e) => {
  console.error("normalize-line-item-values failed:", e.message);
  process.exit(1);
});
