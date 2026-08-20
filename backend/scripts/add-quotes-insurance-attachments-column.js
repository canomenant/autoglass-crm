require("dotenv").config();
const pool = require("../src/config/db");

// Storage for the insurance claim referral PDF (or a photo of it) directly on the quote — base64
// in the JSONB array, same pattern as crm_photos/customer_photos. Defaults to '[]' so every
// existing row is immediately valid without a backfill.
async function main() {
  await pool.query("ALTER TABLE quotes ADD COLUMN IF NOT EXISTS insurance_attachments JSONB NOT NULL DEFAULT '[]'");
  console.log("quotes.insurance_attachments column ready.");
  await pool.end();
}

main().catch((e) => {
  console.error("add-quotes-insurance-attachments-column failed:", e.message);
  process.exit(1);
});
