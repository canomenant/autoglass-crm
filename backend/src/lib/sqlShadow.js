function isShadowEnabled(sourceFlag) {
  return process.env.SQL_READ_SHADOW === "true" && sourceFlag !== "sql";
}

// Fire-and-forget: runs the SQL query, matches rows to jsonResult by business key, diffs
// field-by-field, and logs. Never awaited by callers, never throws, never touches jsonResult —
// the real response has already been returned by the time this finishes.
async function shadowRead({ label, jsonResult, sqlQueryFn, matchKeyFn, compareFn }) {
  try {
    const sqlRows = await sqlQueryFn();
    const sqlByKey = new Map();
    for (const row of sqlRows) {
      const key = matchKeyFn(row);
      if (key) sqlByKey.set(key, row);
    }

    const jsonKeys = new Set();
    let mismatches = 0;

    for (const jsonRow of jsonResult) {
      const key = matchKeyFn(jsonRow);
      if (!key) continue;
      jsonKeys.add(key);
      const sqlRow = sqlByKey.get(key);
      if (!sqlRow) {
        mismatches++;
        console.warn(`[shadow:${label}] in JSON, missing in SQL: ${key}`);
        continue;
      }
      const diff = compareFn(jsonRow, sqlRow);
      if (diff) {
        mismatches++;
        console.warn(`[shadow:${label}] mismatch for ${key}:`, diff);
      }
    }

    for (const key of sqlByKey.keys()) {
      if (!jsonKeys.has(key)) {
        mismatches++;
        console.warn(`[shadow:${label}] in SQL, missing in JSON: ${key}`);
      }
    }

    if (mismatches === 0) {
      console.log(`[shadow:${label}] OK — ${jsonResult.length} records aligned`);
    } else {
      console.warn(`[shadow:${label}] ${mismatches} discrepancies out of ${jsonResult.length} JSON / ${sqlRows.length} SQL records`);
    }
  } catch (err) {
    console.error(`[shadow:${label}] shadow read failed (response already sent, unaffected):`, err.message);
  }
}

module.exports = { isShadowEnabled, shadowRead };
