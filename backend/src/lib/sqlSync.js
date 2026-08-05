const RETRY_DELAYS_MS = [200, 800, 2000];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isDualWriteEnabled() {
  return process.env.DUAL_WRITE === "true";
}

// Fire-and-forget from the caller's perspective (never awaited, never throws out) — retries
// internally with backoff, then logs a single structured line either way. JSON/app_data has
// already been persisted and returned to the user by the time this resolves or fails.
async function syncToSql({ entity, id, businessKey, sqlFn }) {
  if (!isDualWriteEnabled()) return;
  const appDataUpdatedAt = new Date().toISOString();
  let lastError = null;

  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    try {
      await sqlFn();
      console.log(JSON.stringify({
        event: "sync_to_sql",
        entity,
        id,
        businessKey,
        appDataUpdatedAt,
        sqlUpdatedAt: new Date().toISOString(),
        success: true,
        attempt: attempt + 1,
      }));
      return;
    } catch (err) {
      lastError = err;
      if (attempt < RETRY_DELAYS_MS.length) await sleep(RETRY_DELAYS_MS[attempt]);
    }
  }

  console.error(JSON.stringify({
    event: "sync_to_sql",
    entity,
    id,
    businessKey,
    appDataUpdatedAt,
    sqlUpdatedAt: null,
    success: false,
    error: lastError ? lastError.message : "unknown error",
  }));
}

// Historical synthesized records (Q-0001..Q-3865, WO-0001..WO-3865) already occupy that
// number range in SQL. New records must continue past the higher of what either side has
// ever used, forever — so this checks SQL's actual max every time, not just once at boot.
// Falls back to the JSON-side counter alone if SQL is unreachable (never blocks creation).
async function nextBusinessNumber({ pool, table, column, jsonNextId }) {
  let sqlMax = 0;
  try {
    const r = await pool.query(
      `SELECT COALESCE(MAX((regexp_replace(${column}, '\\D', '', 'g'))::int), 0) AS max_num FROM ${table}`
    );
    sqlMax = Number(r.rows[0] && r.rows[0].max_num) || 0;
  } catch (err) {
    console.error(`[nextBusinessNumber] SQL lookup for ${table}.${column} failed, using JSON counter only: ${err.message}`);
  }
  return Math.max(jsonNextId, sqlMax + 1);
}

module.exports = { isDualWriteEnabled, syncToSql, nextBusinessNumber };
