require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
// Pone en cada renglón de cotización la bandera isTaxable que dice el catálogo de tipos de trabajo
// (Antonio, 8-sep-2026: "manda el catálogo"). Medido antes de correrlo: 351 renglones marcados
// gravables siendo servicio (Chip Repair $30,521, Labor $13,920, Delivery Surcharge, Trip, Window
// Installation, Calibration, Roll Up Window…) y 3,998 renglones sin bandera que hoy caen al catálogo
// en tiempo de cálculo; aquí quedan explícitos para que un cambio futuro del catálogo no los mueva.
//
// También arregla dos tipos que no estaban en el catálogo: "Rear left Window Regulator" (minúscula)
// se renombra al tipo real, y "Adhesive" se da de alta como parte gravable (como "Supplies").
//
// Solo toca quotes.line_items. No toca precios, totales cobrados ni órdenes. Las cotizaciones viejas
// (tax_rule 'subtotal') no cambian su impuesto mostrado porque esa regla no mira la bandera; las 53
// itemized sí pueden bajar su impuesto si tenían un servicio marcado gravable: se listan al final.
//
//   node scripts/fix-line-item-tax-flags.js           → solo muestra qué haría
//   node scripts/fix-line-item-tax-flags.js --apply   → escribe y deja respaldo en scripts/
const fs = require("fs");
const path = require("path");
const pool = require("../src/config/db");
const jobTypesStore = require("../src/store/jobTypes.store");

const APPLY = process.argv.includes("--apply");
const RENAME = { "Rear left Window Regulator": "Rear Left Window Regulator" };

(async () => {
  if (!jobTypesStore.findByName("Adhesive")) {
    if (APPLY) { jobTypesStore.create({ name: "Adhesive", type: "Parts", isTaxable: true }); console.log("Catálogo: 'Adhesive' dado de alta como Parts / gravable."); }
    else console.log("Catálogo: daría de alta 'Adhesive' como Parts / gravable.");
  }
  const r = await pool.query("SELECT id, quote_no, invoice_mode, tax_rule, tax_rate, line_items FROM quotes WHERE active <> false ORDER BY created_at");
  const changed = [];
  const stats = { flagSet: 0, flagFlipped: 0, renamed: 0, unknownType: {} };
  const itemizedImpact = [];
  for (const q of r.rows) {
    const items = Array.isArray(q.line_items) ? q.line_items : [];
    let touched = false;
    let taxableBefore = 0, taxableAfter = 0;
    const out = items.map((li) => {
      const item = { ...li };
      if (RENAME[item.jobType]) { item.jobType = RENAME[item.jobType]; stats.renamed++; touched = true; }
      const cat = jobTypesStore.findByName(item.jobType) || (item.jobType === "Adhesive" ? { isTaxable: true } : null);
      const before = li.isTaxable !== undefined && li.isTaxable !== null ? li.isTaxable !== false : (cat ? cat.isTaxable !== false : true);
      taxableBefore += before ? Number(li.pricePart || 0) : 0;
      if (cat) {
        const want = cat.isTaxable !== false;
        if (li.isTaxable === undefined || li.isTaxable === null) { item.isTaxable = want; stats.flagSet++; touched = true; }
        else if ((li.isTaxable !== false) !== want) { item.isTaxable = want; stats.flagFlipped++; touched = true; }
      } else if (item.jobType) {
        stats.unknownType[item.jobType] = (stats.unknownType[item.jobType] || 0) + 1;
      }
      const after = item.isTaxable !== undefined && item.isTaxable !== null ? item.isTaxable !== false : true;
      taxableAfter += after ? Number(item.pricePart || 0) : 0;
      return item;
    });
    if (touched) {
      changed.push({ id: q.id, quoteNo: q.quote_no, before: items, after: out });
      if (q.invoice_mode === "itemized" && Math.abs(taxableAfter - taxableBefore) > 0.005) {
        const rate = Number(q.tax_rate || 0);
        itemizedImpact.push({ quote: q.quote_no, baseAntes: taxableBefore.toFixed(2), baseDespues: taxableAfter.toFixed(2), impuestoAntes: (taxableBefore * rate / 100).toFixed(2), impuestoDespues: (taxableAfter * rate / 100).toFixed(2) });
      }
    }
  }
  console.log(APPLY ? "APLICANDO" : "SOLO PRUEBA (usa --apply para escribir)");
  console.log("Cotizaciones a tocar:", changed.length, "| banderas puestas donde faltaban:", stats.flagSet, "| banderas volteadas (manda el catálogo):", stats.flagFlipped, "| renombradas:", stats.renamed);
  console.log("Tipos fuera de catálogo (se dejan como están):", stats.unknownType);
  console.log("Cotizaciones ITEMIZED cuyo impuesto mostrado cambia:", itemizedImpact.length);
  if (itemizedImpact.length) console.table(itemizedImpact);
  if (!APPLY) { await pool.end(); return; }

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backup = path.join(__dirname, `line-item-tax-flags-backup-${stamp}.json`);
  fs.writeFileSync(backup, JSON.stringify(changed.map(({ id, quoteNo, before }) => ({ id, quoteNo, line_items: before })), null, 1));
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const c of changed) await client.query("UPDATE quotes SET line_items = $1, updated_at = now() WHERE id = $2", [JSON.stringify(c.after), c.id]);
    await client.query("COMMIT");
    console.log(`Actualizadas ${changed.length} cotizaciones. Respaldo: ${backup}`);
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
  await pool.end();
})().catch((e) => { console.error(e.stack); process.exit(1); });
