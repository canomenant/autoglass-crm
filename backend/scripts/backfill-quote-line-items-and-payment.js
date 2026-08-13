require("dotenv").config();
const crypto = require("crypto");
const pool = require("../src/config/db");

// Payment methods confirmed in the catalog (Cash, Zelle, Venmo, PayPal, "We Have CC In File",
// "Deposit" — the last two just added by add-payment-methods.js) map straight through.
// "CashApp" normalizes to the catalog's "Cash App". "Get Payment"/"Insurance"/"NOT PAID" are
// workflow states, not payment methods — their text goes to internalNotes instead, and
// payment.method stays blank rather than forcing a nonsensical catalog match.
const METHOD_NORMALIZE = { CashApp: "Cash App" };
const NOT_A_METHOD = new Set(["Get Payment", "Insurance", "NOT PAID"]);

function firstValue(commaSeparated) {
  if (!commaSeparated) return "";
  return commaSeparated.split(",")[0].trim();
}

function splitList(commaSeparated) {
  if (!commaSeparated) return [];
  return commaSeparated.split(",").map((s) => s.trim()).filter(Boolean);
}

async function main() {
  console.log("Loading cat_part_number NAGS lookup...");
  const catalog = await pool.query(
    "SELECT name_part_number, nags_description FROM cat_part_number WHERE nags_description IS NOT NULL AND nags_description != '' AND nags_description != 'NULL'"
  );
  const nagsMap = new Map();
  for (const row of catalog.rows) {
    if (!nagsMap.has(row.name_part_number)) nagsMap.set(row.name_part_number, row.nags_description);
  }
  console.log(`Loaded ${nagsMap.size} part numbers with a usable NAGS description.`);

  const rows = (
    await pool.query(`
      SELECT h.wo_number, h.job_type, h.part_number, h.distributor, h.distributor_order,
             h.subtotal_part, h.calibration_type, h.payment_type, h.id_authorization, h.upsell,
             w.id AS wo_id, w.internal_notes, w.payment AS wo_payment,
             q.id AS quote_id, q.line_items, q.upsell AS q_upsell, q.calibration_type AS q_calibration_type
      FROM work_orders_history h
      JOIN work_orders w ON w.work_order_no ILIKE h.wo_number
      JOIN quotes q ON w.quote_id = q.id
    `)
  ).rows;
  console.log(`Matched ${rows.length} history rows to a work order + quote.`);

  let lineItemsUpdated = 0;
  let paymentMethodUpdated = 0;
  let authIdUpdated = 0;
  let upsellUpdated = 0;
  let calibrationUpdated = 0;
  let notesUpdated = 0;

  for (const r of rows) {
    // ── line_items reconstruction (only if currently empty) ──────────────────────────────
    if (Array.isArray(r.line_items) && r.line_items.length === 0) {
      const jobTypes = splitList(r.job_type);
      const partNumbers = splitList(r.part_number);
      const distributors = splitList(r.distributor);
      const orderNumbers = splitList(r.distributor_order);
      const lineCount = Math.max(jobTypes.length, partNumbers.length, distributors.length, orderNumbers.length, 1);

      if (jobTypes.length || partNumbers.length) {
        const lineItems = [];
        for (let i = 0; i < lineCount; i++) {
          const partNumber = partNumbers[i] || "";
          lineItems.push({
            id: crypto.randomUUID(),
            jobType: jobTypes[i] || "",
            partNumber,
            nagsDescription: nagsMap.get(partNumber) || "",
            calibrationType: i === 0 ? (r.calibration_type || "") : "",
            priceTier: "",
            pricePart: i === 0 ? Number(r.subtotal_part) || 0 : 0,
            distributor: distributors[i] || "",
            orderNumber: orderNumbers[i] || "",
          });
        }
        await pool.query("UPDATE quotes SET line_items = $1, updated_at = now() WHERE id = $2", [
          JSON.stringify(lineItems),
          r.quote_id,
        ]);
        lineItemsUpdated++;
      }
    }

    // ── payment.method / payment.authorizationId (only if currently empty) ───────────────
    const currentMethod = r.wo_payment?.method || "";
    const currentAuthId = r.wo_payment?.authorizationId || "";
    let newPayment = null;

    if (!currentMethod) {
      const raw = firstValue(r.payment_type);
      if (raw) {
        if (NOT_A_METHOD.has(raw)) {
          if (!(r.internal_notes || "").includes(raw)) {
            const note = `Payment type from import: ${raw}`;
            const combined = r.internal_notes ? `${r.internal_notes} | ${note}` : note;
            await pool.query("UPDATE work_orders SET internal_notes = $1, updated_at = now() WHERE id = $2", [
              combined,
              r.wo_id,
            ]);
            notesUpdated++;
          }
        } else {
          const normalized = METHOD_NORMALIZE[raw] || raw;
          newPayment = { ...(r.wo_payment || {}), method: normalized };
          paymentMethodUpdated++;
        }
      }
    }

    if (!currentAuthId && r.id_authorization && r.id_authorization !== "NULL") {
      newPayment = { ...(newPayment || r.wo_payment || {}), authorizationId: r.id_authorization };
      authIdUpdated++;
    }

    if (newPayment) {
      await pool.query("UPDATE work_orders SET payment = $1, updated_at = now() WHERE id = $2", [
        JSON.stringify(newPayment),
        r.wo_id,
      ]);
    }

    // ── quotes.upsell (only if currently 0) ───────────────────────────────────────────────
    if (Number(r.q_upsell) === 0 && Number(r.upsell) > 0) {
      await pool.query("UPDATE quotes SET upsell = $1, updated_at = now() WHERE id = $2", [
        Number(r.upsell),
        r.quote_id,
      ]);
      upsellUpdated++;
    }

    // ── quotes.calibrationType (only if currently empty) ──────────────────────────────────
    if (!r.q_calibration_type && r.calibration_type) {
      await pool.query("UPDATE quotes SET calibration_type = $1, updated_at = now() WHERE id = $2", [
        r.calibration_type,
        r.quote_id,
      ]);
      calibrationUpdated++;
    }
  }

  console.log("\n=== Results ===");
  console.log(`line_items reconstructed: ${lineItemsUpdated}`);
  console.log(`payment.method set: ${paymentMethodUpdated}`);
  console.log(`payment.authorizationId set: ${authIdUpdated}`);
  console.log(`internal_notes appended (non-method payment_type): ${notesUpdated}`);
  console.log(`upsell backfilled: ${upsellUpdated}`);
  console.log(`calibrationType backfilled: ${calibrationUpdated}`);

  await pool.end();
}

main().catch((e) => {
  console.error("backfill-quote-line-items-and-payment failed:", e.message);
  process.exit(1);
});
