require("dotenv").config();
const pool = require("../src/config/db");

// The previous backfill copied work_orders_history.calibration_type verbatim — 91% of the
// 497 backfilled values turned out to be punctuation artifacts (",", ",  ,  ,", etc.) from
// the history's own comma-separated multi-line-item convention applied to a field that
// usually had nothing real in any position. Only "Static" and "Dynamic" are real values.
const VALID = new Set(["Static", "Dynamic"]);

async function main() {
  const topLevel = await pool.query(
    "SELECT id, calibration_type FROM quotes WHERE calibration_type IS NOT NULL AND calibration_type != ''"
  );
  let topLevelCleared = 0;
  for (const row of topLevel.rows) {
    if (!VALID.has(row.calibration_type)) {
      await pool.query("UPDATE quotes SET calibration_type = '', updated_at = now() WHERE id = $1", [row.id]);
      topLevelCleared++;
    }
  }
  console.log(`quotes.calibration_type: ${topLevelCleared} garbage values cleared (of ${topLevel.rows.length} populated).`);

  const withLineItems = await pool.query("SELECT id, line_items FROM quotes WHERE jsonb_array_length(line_items) > 0");
  let lineItemsCleared = 0;
  let quotesUpdated = 0;
  for (const row of withLineItems.rows) {
    let changed = false;
    const fixed = row.line_items.map((li) => {
      if (li.calibrationType && !VALID.has(li.calibrationType)) {
        changed = true;
        lineItemsCleared++;
        return { ...li, calibrationType: "" };
      }
      return li;
    });
    if (changed) {
      await pool.query("UPDATE quotes SET line_items = $1, updated_at = now() WHERE id = $2", [
        JSON.stringify(fixed),
        row.id,
      ]);
      quotesUpdated++;
    }
  }
  console.log(`line_items[].calibrationType: ${lineItemsCleared} garbage values cleared across ${quotesUpdated} quotes.`);

  await pool.end();
}

main().catch((e) => {
  console.error("fix-calibration-type-garbage failed:", e.message);
  process.exit(1);
});
