require('dotenv').config();
const path = require('path');
const fs = require('fs');
const XLSX = require('xlsx');
const { Pool } = require('pg');

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

const clean = (val) => { if (val === undefined || val === null) return null; const s = String(val).trim(); return s === '' ? null : s; };
const toNum = (val) => { if (val === undefined || val === null || String(val).trim() === '') return 0; const n = parseFloat(String(val).replace(/[^0-9.-]/g, '')); return isNaN(n) ? 0 : n; };

const TEST_WO_NUMBERS = Array.from({ length: 200 }, (_, i) => `WO-${String(i + 1).padStart(4, '0')}`);

async function cleanupTestRecords(client) {
  let deletedWorkOrders = 0, deletedQuotes = 0, deletedCustomers = 0, deletedPayments = 0;
  await client.query('BEGIN');
  try {
    for (const woNumber of TEST_WO_NUMBERS) {
      const woRes = await client.query('SELECT id, quote_id FROM work_orders WHERE UPPER(wo_number) = UPPER($1)', [woNumber]);
      for (const wo of woRes.rows) {
        const payRes = await client.query('DELETE FROM payments WHERE work_order_id = $1', [wo.id]);
        deletedPayments += payRes.rowCount;
        await client.query('DELETE FROM work_orders WHERE id = $1', [wo.id]);
        deletedWorkOrders++;
        console.log(`Deleted test work order ${woNumber} (id ${wo.id})`);
        if (wo.quote_id) {
          const stillUsed = await client.query('SELECT id FROM work_orders WHERE quote_id = $1 LIMIT 1', [wo.quote_id]);
          if (stillUsed.rows.length === 0) {
            const quoteRes = await client.query('SELECT customer_id FROM quotes WHERE id = $1', [wo.quote_id]);
            await client.query('DELETE FROM quotes WHERE id = $1', [wo.quote_id]);
            deletedQuotes++;
            const customerId = quoteRes.rows[0] && quoteRes.rows[0].customer_id;
            if (customerId) {
              const stillUsedCustomer = await client.query('SELECT id FROM quotes WHERE customer_id = $1 LIMIT 1', [customerId]);
              if (stillUsedCustomer.rows.length === 0) {
                await client.query('DELETE FROM customers WHERE id = $1', [customerId]);
                deletedCustomers++;
              }
            }
          }
        }
      }
    }
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  }
  console.log(`Cleanup done — Work Orders: ${deletedWorkOrders} | Quotes: ${deletedQuotes} | Customers: ${deletedCustomers} | Payments: ${deletedPayments}`);
}

async function getOrCreateCustomer(client, row) {
  const phone = clean(row['PHONE NUMBER']);
  if (phone) {
    const r = await client.query('SELECT id FROM customers WHERE phone = $1 LIMIT 1', [phone]);
    if (r.rows.length > 0) return r.rows[0].id;
  }
  const r = await client.query('INSERT INTO customers (name, phone, email, address) VALUES ($1,$2,$3,$4) RETURNING id', [clean(row['CUSTOMER']), phone, clean(row['EMAIL']), clean(row['ADDRESS'])]);
  return r.rows[0].id;
}

async function importCsv(csvPath) {
  const wb = XLSX.readFile(csvPath, { raw: false });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: null });
  console.log('Total rows:', rows.length);
  let imported = 0, skipped = 0, errors = 0;
  for (const row of rows) {
    const wo = clean(row['Work order #']);
    if (!wo) { skipped++; continue; }
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const ex = await client.query('SELECT id FROM work_orders WHERE UPPER(wo_number) = UPPER($1) LIMIT 1', [wo]);
      if (ex.rows.length > 0) { await client.query('ROLLBACK'); skipped++; continue; }
      const cid = await getOrCreateCustomer(client, row);
      const qr = await client.query('INSERT INTO quotes (customer_id,agent,distributor,job_type,part_number) VALUES ($1,$2,$3,$4,$5) RETURNING id', [cid, clean(row['AGENT']), clean(row['DISTRIBUTOR']), clean(row['JOB TYPE']), clean(row['PART NUMBER'])]);
      const wr = await client.query('INSERT INTO work_orders (quote_id,wo_number,tech,year,make,model,vin,status) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id', [qr.rows[0].id, wo, clean(row['TECH '] || row['TECH']), clean(row['YEAR']), clean(row['MAKE']), clean(row['MODEL']), clean(row['VIN#']), clean(row['STATUS'])]);
      await client.query('INSERT INTO payments (work_order_id,payment_type,subtotal_part,subtotal_molding,subtotal_services,tax,total) VALUES ($1,$2,$3,$4,$5,$6,$7)', [wr.rows[0].id, clean(row['PAYMENT TYPE']), toNum(row['SUBTOTAL PART']), toNum(row['SUBTOTAL MOLDING']), toNum(row['SUBTOTAL SERVICES']), toNum(row['TOTAL TAX']), toNum(row['Total'])]);
      await client.query('COMMIT');
      imported++;
      console.log(`Imported WO#: ${wo} (${imported}/${rows.length})`);
    } catch (e) {
      await client.query('ROLLBACK');
      console.error(`Error WO# ${wo}: ${e.message}`);
      errors++;
    } finally {
      client.release();
    }
  }
  console.log(`Import done — Imported: ${imported} | Skipped: ${skipped} | Errors: ${errors}`);
}

async function run() {
  const csvPath = path.join(__dirname, 'data', 'work_orders.csv');
  if (!fs.existsSync(csvPath)) {
    console.error('File not found:', csvPath);
    process.exit(1);
  }
  const client = await pool.connect();
  try {
    await cleanupTestRecords(client);
  } finally {
    client.release();
  }
  await importCsv(csvPath);
  await pool.end();
}

run().catch((e) => {
  console.error('Fatal:', e.message);
  process.exit(1);
});
