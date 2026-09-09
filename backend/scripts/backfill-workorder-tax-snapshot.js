require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
// Escribe en cada orden el snapshot del sales tax que se le debe al estado — SOLO partes — a partir
// de su cotización (quote.totals.taxOnParts / taxableBase / nonTaxableBase). Ver
// add-tax-basis-columns.js. Con --apply escribe; sin él solo muestra totales por año y estado.
//
// Se corre DESPUÉS de fix-line-item-tax-flags.js, para que la base de partes ya tenga las banderas
// del catálogo. Órdenes sin cotización quedan en NULL (los reportes las tratan como $0 de impuesto).
// Es idempotente: recalcular y volver a escribir da lo mismo mientras la cotización no cambie.
const pool = require("../src/config/db");
const workOrdersStore = require("../src/store/workorders.store");
const quotesStore = require("../src/store/quotes.store");

const APPLY = process.argv.includes("--apply");
const f = (n) => Number(n || 0).toFixed(2);

(async () => {
  const wos = await workOrdersStore.list();
  const quotes = await quotesStore.list();
  const qById = new Map(quotes.map((q) => [q.id, q]));
  const rows = [];
  const agg = {};
  let sinCotizacion = 0;
  for (const w of wos) {
    const q = w.quoteId ? qById.get(w.quoteId) : null;
    if (!q) { sinCotizacion++; continue; }
    const t = q.totals || {};
    const row = { id: w.id, taxRate: Number(q.taxRate || 0), taxableBase: Number(t.taxableBase || 0), nonTaxableBase: Number(t.nonTaxableBase || 0), salesTax: Number(t.taxOnParts || 0) };
    rows.push(row);
    if (w.payment?.paid && w.status !== "Cancelled") {
      const k = `${(w.appointmentDate || "").slice(0, 4) || "?"}|${["CA", "TX"].includes(w.state) ? w.state : "none"}`;
      agg[k] = agg[k] || { n: 0, taxable: 0, nonTaxable: 0, tax: 0, viejo: 0 };
      agg[k].n++; agg[k].taxable += row.taxableBase; agg[k].nonTaxable += row.nonTaxableBase; agg[k].tax += row.salesTax; agg[k].viejo += Number(t.taxAmount || 0);
    }
  }
  console.log(APPLY ? "APLICANDO" : "SOLO PRUEBA (usa --apply para escribir)", "| órdenes con cotización:", rows.length, "| sin cotización (quedan NULL):", sinCotizacion);
  console.log("Órdenes pagadas y no canceladas, por año y estado:");
  console.table(Object.entries(agg).sort().map(([k, a]) => ({ k, n: a.n, ventasGravables: f(a.taxable), ventasNoGravables: f(a.nonTaxable), impuestoSoloPartes: f(a.tax), impuestoCotizacionVieja: f(a.viejo) })));
  if (!APPLY) { await pool.end(); return; }

  const r = await pool.query(
    `UPDATE work_orders AS w
        SET tax_rate = v.tax_rate, taxable_base = v.taxable_base, non_taxable_base = v.non_taxable_base, sales_tax = v.sales_tax
       FROM unnest($1::uuid[], $2::numeric[], $3::numeric[], $4::numeric[], $5::numeric[]) AS v(id, tax_rate, taxable_base, non_taxable_base, sales_tax)
      WHERE w.id = v.id`,
    [rows.map((x) => x.id), rows.map((x) => x.taxRate), rows.map((x) => x.taxableBase), rows.map((x) => x.nonTaxableBase), rows.map((x) => x.salesTax)]
  );
  console.log(`Actualizadas ${r.rowCount} órdenes.`);
  await pool.end();
})().catch((e) => { console.error(e.stack); process.exit(1); });
