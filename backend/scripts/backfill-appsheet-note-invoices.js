require("dotenv").config();
const pool = require("../src/config/db");
const XLSX = require("xlsx");

// El Invoice # de las notas de débito heredadas. AppSheet SÍ lo traía — SERVICEPART_LABEL, que
// es el Order Number de la línea de compra ("303_802_1097772" en PGW, "S66552177-1" en Mygrant) —
// pero el import original nunca lo copió a invoice_number, y la pantalla mostraba "—" en las 302
// ND-#### (detectado por Antonio, 29-ago-2026). Se rellena desde el export, SOLO donde el campo
// está vacío: uno capturado a mano nunca se pisa. Se actualizan también las retiradas
// (active=false), para que si algún día se reactivan ya traigan su factura.
//
// --apply para escribir; sin el flag solo simula.

const APPLY = process.argv.includes("--apply");
const EXCEL = "C:/Users/Antonio Cano/OneDrive/Documents/Bases de Datos Completas.xlsx";

(async () => {
  const wb = XLSX.readFile(EXCEL);
  const dn = XLSX.utils.sheet_to_json(wb.Sheets["BD_DEBITNOTE"], { defval: null });
  const mapa = {};
  for (const d of dn) {
    const num = d["# DEBIT NOTE"];
    const label = String(d["SERVICEPART_LABEL"] || "").trim();
    if (num && label) mapa[num] = label;
  }
  console.log(`Facturas en el export: ${Object.keys(mapa).length} notas.`);

  const filas = (await pool.query(
    `SELECT id, note_number, invoice_number, active FROM credit_debit_note
      WHERE kind = 'DEBIT' AND source = 'appsheet' AND btrim(COALESCE(invoice_number, '')) = ''`
  )).rows;
  const plan = filas.filter((f) => mapa[f.note_number]);
  console.log(`Notas sin Invoice # en la base: ${filas.length} — con factura en el export: ${plan.length} (${plan.filter((f) => f.active).length} activas, ${plan.filter((f) => !f.active).length} retiradas).`);
  plan.slice(0, 8).forEach((f) => console.log(`  ${f.note_number} -> ${mapa[f.note_number]}`));

  if (!APPLY) {
    console.log("\nSimulación. Volver a lanzar con --apply para escribir.");
    await pool.end();
    return;
  }

  let n = 0;
  for (const f of plan) {
    await pool.query(
      `UPDATE credit_debit_note SET invoice_number = $2, updated_at = now()
        WHERE id = $1 AND btrim(COALESCE(invoice_number, '')) = ''`,
      [f.id, mapa[f.note_number]]
    );
    n++;
  }
  console.log(`\nRellenadas: ${n} notas con su factura del export.`);
  await pool.end();
})().catch((e) => {
  console.error("FALLA:", e.message);
  process.exit(1);
});
