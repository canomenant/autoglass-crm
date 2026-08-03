const path = require('path');
const XLSX = require('xlsx');
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const clean = (val) => { if (val === undefined || val === null) return null; const s = String(val).trim(); return s === '' ? null : s; };
const toNum = (val) => { if (val === undefined || val === null || String(val).trim() === '') return 0; const n = parseFloat(String(val).replace(/[^0-9.-]/g, '')); return isNaN(n) ? 0 : n; };
async function getOrCreateCustomer(client, row) {
  const phone = clean(row['PHONE NUMBER']);
  if (phone) { const r = await client.query('SELECT id FROM customers WHERE phone = $1 LIMIT 1', [phone]); if (r.rows.length > 0) return r.rows[0].id; }
  const r = await client.query('INSERT INTO customers (name, phone, email, address) VALUES ($1,$2,$3,$4) RETURNING id', [clean(row['CUSTOMER']), phone, clean(row['EMAIL']), clean(row['ADDRESS'])]);
  return r.rows[0].id;
}
async function run(filePath) {
  const rows = XLSX.utils.sheet_to_json(XLSX.readFile(filePath).Sheets[XLSX.readFile(filePath).SheetNames[0]], { defval: null });
  console.log('Total rows:', rows.length);
  let imported = 0, skipped = 0, errors = 0;
  for (const row of rows) {
    const wo = clean(row['Work order #']); if (!wo) { skipped++; continue; }
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const ex = await client.query('SELECT id FROM work_orders WHERE wo_number=$1 LIMIT 1', [wo]);
      if (ex.rows.length > 0) { await client.query('ROLLBACK'); skipped++; continue; }
      const cid = await getOrCreateCustomer(client, row);
      const qr = await client.query('INSERT INTO quotes (customer_id,agent,distributor,job_type,part_number) VALUES ($1,$2,$3,$4,$5) RETURNING id', [cid, clean(row['AGENT']), clean(row['DISTRIBUTOR']), clean(row['JOB TYPE']), clean(row['PART NUMBER'])]);
      const wr = await client.query('INSERT INTO work_orders (quote_id,wo_number,tech,year,make,model,vin,status) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id', [qr.rows[0].id, wo, clean(row['TECH ']||row['TECH']), clean(row['YEAR']), clean(row['MAKE']), clean(row['MODEL']), clean(row['VIN#']), clean(row['STATUS'])]);
      await client.query('INSERT INTO payments (work_order_id,payment_type,subtotal_part,subtotal_molding,subtotal_services,tax,total) VALUES ($1,$2,$3,$4,$5,$6,$7)', [wr.rows[0].id, clean(row['PAYMENT TYPE']), toNum(row['SUBTOTAL PART']), toNum(row['SUBTOTAL MOLDING']), toNum(row['SUBTOTAL SERVICES']), toNum(row['TOTAL TAX']), toNum(row['Total'])]);
      await client.query('COMMIT'); imported++; console.log(`Imported WO#: ${wo} (${imported}/${rows.length})`);
    } catch(e) { await client.query('ROLLBACK'); console.error(`Error WO# ${wo}: ${e.message}`); errors++; } finally { client.release(); }
  }
  console.log(`Done — Imported: ${imported} | Skipped: ${skipped} | Errors: ${errors}`);
  await pool.end();
}
const f = process.argv[2]; if (!require('fs').existsSync(f)) { console.error('File not found:', f); process.exit(1); }
run(f).catch(e => { console.error('Fatal:', e.message); process.exit(1); });
