require("dotenv").config();
const pool = require("../src/config/db");

function fieldDiffs(json, sql) {
  const diffs = [];
  if ((json.status || "") !== (sql.status || "")) diffs.push(`status: '${json.status}' vs '${sql.status}'`);
  if ((json.tech || "") !== (sql.tech || "")) diffs.push(`tech: '${json.tech}' vs '${sql.tech}'`);
  if ((json.distributor || "") !== (sql.distributor || "")) diffs.push(`distributor: '${json.distributor}' vs '${sql.distributor}'`);
  if ((json.partNumber || "") !== (sql.part_number || "")) diffs.push(`partNumber: '${json.partNumber}' vs '${sql.part_number}'`);
  if ((json.jobType || "") !== (sql.job_type || "")) diffs.push(`jobType: '${json.jobType}' vs '${sql.job_type}'`);
  if (Number(json.laborCost || 0) !== Number(sql.labor_cost || 0)) diffs.push(`laborCost: ${json.laborCost} vs ${sql.labor_cost}`);
  if (Number(json.glassCost || 0) !== Number(sql.glass_cost || 0)) diffs.push(`glassCost: ${json.glassCost} vs ${sql.glass_cost}`);
  if (Number(json.totalSale || 0) !== Number(sql.total_sale || 0)) diffs.push(`totalSale: ${json.totalSale} vs ${sql.total_sale}`);
  const jv = json.vehicle || {};
  if ((jv.year ?? "") != (sql.vehicle_year ?? "")) diffs.push(`vehicle.year: '${jv.year}' vs '${sql.vehicle_year}'`);
  if ((jv.make || "") !== (sql.vehicle_make || "")) diffs.push(`vehicle.make: '${jv.make}' vs '${sql.vehicle_make}'`);
  if ((jv.model || "") !== (sql.vehicle_model || "")) diffs.push(`vehicle.model: '${jv.model}' vs '${sql.vehicle_model}'`);
  if (!!json.quoteId !== !!sql.quote_id) diffs.push(`quoteId presence: ${!!json.quoteId} vs ${!!sql.quote_id}`);
  return diffs;
}

async function main() {
  const [appDataRes, sqlRes] = await Promise.all([
    pool.query("SELECT value FROM app_data WHERE key = 'workorders.json'"),
    pool.query(`
      SELECT id, work_order_no, quote_id, status, tech, distributor, part_number, job_type,
             labor_cost, glass_cost, total_sale, vehicle_year, vehicle_make, vehicle_model
      FROM work_orders
    `),
  ]);

  const jsonRows = appDataRes.rows[0] ? appDataRes.rows[0].value : [];
  const sqlByNo = new Map(sqlRes.rows.map((r) => [r.work_order_no, r]));

  console.log(`Comparando ${jsonRows.length} work orders (app_data) contra ${sqlRes.rows.length} (SQL)...`);

  let clean = 0;
  let mismatched = 0;
  let missingInSql = 0;
  const seenInJson = new Set();

  for (const json of jsonRows) {
    seenInJson.add(json.workOrderNo);
    const sql = sqlByNo.get(json.workOrderNo);
    if (!sql) {
      missingInSql++;
      console.warn(`[MISSING IN SQL] ${json.workOrderNo}`);
      continue;
    }
    if (json.id !== sql.id) {
      mismatched++;
      console.warn(`[ID MISMATCH] ${json.workOrderNo}: app_data=${json.id} vs sql=${sql.id}`);
      continue;
    }
    const diffs = fieldDiffs(json, sql);
    if (diffs.length > 0) {
      mismatched++;
      console.warn(`[MISMATCH] ${json.workOrderNo}:`, diffs.join("; "));
    } else {
      clean++;
    }
  }

  let missingInJson = 0;
  for (const sql of sqlRes.rows) {
    if (!seenInJson.has(sql.work_order_no)) {
      missingInJson++;
      console.warn(`[MISSING IN app_data] ${sql.work_order_no}`);
    }
  }

  console.log("\n--- Resumen ---");
  console.log(`Alineados: ${clean}`);
  console.log(`Con discrepancias de campos: ${mismatched}`);
  console.log(`Faltantes en SQL: ${missingInSql}`);
  console.log(`Faltantes en app_data: ${missingInJson}`);
  console.log(`Total app_data: ${jsonRows.length} | Total SQL: ${sqlRes.rows.length}`);

  await pool.end();
}

main().catch((e) => {
  console.error("diff-workorders failed:", e.message);
  process.exit(1);
});
