require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
// Qué porcentaje del negocio fue de cada estado (CA vs TX) en un año. Lo pidió el contador para el
// 2025 (Paul, sep-2026). Es el mismo número que muestra la tarjeta "Negocio por estado" del reporte
// de Sales Tax: lo cobrado en las órdenes pagadas, por fecha del trabajo, por estado de la orden.
//
//   node scripts/revenue-by-state.js --year 2025
//   node scripts/revenue-by-state.js            → todos los años
//
// Las órdenes sin estado salen en su propia fila. Si pesan, primero hay que asignarles estado con
// scripts/backfill-workorder-state.js y volver a correr esto.
const pool = require("../src/config/db");
const workOrdersStore = require("../src/store/workorders.store");
const { computeRevenueByState, TAX_STATES } = require("../src/lib/profitLossCalc");

const yearArg = process.argv.indexOf("--year");
const year = yearArg > -1 ? String(process.argv[yearArg + 1] || "") : "";

const money = (n) => `$${Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const pct = (n) => `${Number(n || 0).toFixed(2)}%`;

(async () => {
  const all = await workOrdersStore.list();
  const paid = all.filter((w) => w.payment?.paid && w.workOrderType !== "Investment Property");
  const inYear = year ? paid.filter((w) => /^\d{4}-\d{2}-\d{2}/.test(w.appointmentDate || "") && w.appointmentDate.slice(0, 4) === year) : paid;
  const r = computeRevenueByState(inYear);

  // Salida en inglés a propósito: es lo que se le reenvía al contador tal cual.
  console.log(`\nRevenue by state — ${year || "all years"} (paid work orders, by job date)\n`);
  console.log("State        Orders      Collected    % of total   % of CA + TX");
  for (const s of [...TAX_STATES, "none"]) {
    const c = r[s];
    if (!c.orders) continue;
    const label = (s === "none" ? "No state" : s).padEnd(12);
    console.log(`${label} ${String(c.orders).padStart(7)} ${money(c.revenue).padStart(14)} ${pct(c.share).padStart(13)} ${(s === "none" ? "—" : pct(c.shareAssigned)).padStart(14)}`);
  }
  console.log(`${"Total".padEnd(12)} ${String(r.all.orders).padStart(7)} ${money(r.all.revenue).padStart(14)} ${"100.00%".padStart(13)}`);
  if (r.none.orders) {
    console.log(`\n${r.none.orders} work orders (${money(r.none.revenue)}) have no state. To assign them: node scripts/backfill-workorder-state.js`);
  }
  await pool.end();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
