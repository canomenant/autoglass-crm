const express = require("express");
const xlsx = require("xlsx");
const quotesStore = require("../store/quotes.store");
const workOrdersStore = require("../store/workorders.store");
const expensesStore = require("../store/expenses.store");
const partnerDistributionsStore = require("../store/partnerDistributions.store");
const partnerPaymentsStore = require("../store/partnerPayments.store");
const {
  computeRevenueComponents,
  computeCostComponents,
  computeSalesTax,
  computeTaxableBase,
  computeNonTaxableBase,
  computeCardFee,
  computeRevenueByState,
  normalizeCardFeePercent,
  COST_GROUPS,
  TAX_STATES,
  taxStateOf,
} = require("../lib/profitLossCalc");
const pool = require("../config/db");

const router = express.Router();

const DRILL_CAP = 200;

function capList(items) {
  const sorted = [...items].sort((a, b) => b.amount - a.amount);
  return { items: sorted.slice(0, DRILL_CAP), totalCount: items.length };
}

// "Investment Property" isn't a work order type that exists in the data yet, but it's the one
// explicitly agreed to exclude from this report going forward, so the filter is kept even though
// it's currently a no-op.
const MATRIX_EXCLUDED_TYPES = ["Investment Property"];

function validDateStr(d) {
  return typeof d === "string" && /^\d{4}-\d{2}-\d{2}/.test(d);
}

function monthOf(dateStr) {
  return Number(dateStr.slice(5, 7)) - 1;
}

// A row is { month: 0-11 or null (no valid date), id, workOrderNo, customerName, amount }.
// Builds the 12-month + "no date" shape shared by every line of the matrix.
function buildMatrixCategory(key, rows) {
  const monthly = Array(12).fill(0);
  const monthCells = Array.from({ length: 12 }, () => []);
  const noDateItems = [];
  let noDate = 0;

  for (const row of rows) {
    if (!row.amount) continue;
    const item = { id: row.id, workOrderNo: row.workOrderNo, customerName: row.customerName, amount: row.amount };
    if (row.month === null) {
      noDate += row.amount;
      noDateItems.push(item);
    } else {
      monthly[row.month] += row.amount;
      monthCells[row.month].push(item);
    }
  }

  const total = monthly.reduce((sum, v) => sum + v, 0) + noDate;
  return { key, monthly, noDate, total, cells: monthCells.map((items) => capList(items)), noDateCell: capList(noDateItems) };
}

// Single source of truth for revenue/cost figures — consumed by the QuickView header cards
// (frontend/src/lib/quickViewData.js), the Reports overview page, and the P&L report. Revenue
// counts only paid work orders (money actually collected); costs count every work order
// matching the filters regardless of payment status (a cost is incurred once the job is done,
// not once the customer settles). Technician cost comes from work_orders.labor_cost, not the
// payouts table — payouts only records already-processed payment batches (200 rows covering a
// fraction of jobs), not the real per-job labor cost.

// Bonos y ajustes que viven en los PAGOS y no en las órdenes: viajes cancelados, garantías, spiff,
// salario, saldos de 2024 y las deducciones. El P&L por orden no los veía (Antonio, 6-sep-2026:
// "¿y en el reporte de pérdidas y ganancias cómo vamos a contar esto?"), y son dinero que salió
// del banco. Se cuentan en el MES EN QUE SE PAGARON, por tipo, técnicos y agentes por separado;
// los saldos de periodos anteriores van en su propia fila para que el socio decida a qué año
// pertenecen. Las deducciones entran en negativo: bajan el costo.
async function loadPayoutAdjustments({ dateFrom, dateTo, year } = {}) {
  const r = await pool.query(
    `SELECT o.id, o.payment_number, o.type, o.payment_date::text AS d, o.bonus::float AS bonus, o.deductions::float AS deductions,
            COALESCE(json_agg(json_build_object('id', b.id, 'bonusType', b.bonus_type, 'amount', b.amount::float, 'note', b.note, 'date', b.item_date::text)
                     ORDER BY b.id) FILTER (WHERE b.id IS NOT NULL), '[]') AS items
       FROM payouts o LEFT JOIN payout_bonus_item b ON b.payout_id = o.id
      WHERE o.type IN ('TECHNICIAN','AGENT') AND o.active <> false AND o.status <> 'Cancelled'
        AND (o.bonus <> 0 OR o.deductions <> 0)
        AND ($1::date IS NULL OR o.payment_date::date >= $1::date)
        AND ($2::date IS NULL OR o.payment_date::date <= $2::date)
      GROUP BY o.id ORDER BY o.payment_date, o.payment_number`,
    [dateFrom || (year ? `${year}-01-01` : null), dateTo || (year ? `${year}-12-31` : null)]
  );
  const out = { technicianAdjustments: [], agentAdjustments: [], priorBalances: [] };
  for (const o of r.rows) {
    const date = (o.d || "").slice(0, 10);
    const base = { paymentId: o.id, paymentNumber: o.payment_number, payoutType: o.type, date };
    const items = o.items.length
      ? o.items.map((b) => ({ ...base, id: `b${b.id}`, bonusType: b.bonusType || "UNCLASSIFIED", note: b.note || "", amount: Number(b.amount || 0) }))
      : (o.bonus ? [{ ...base, id: `p${o.id}`, bonusType: "UNCLASSIFIED", note: "", amount: Number(o.bonus) }] : []);
    if (o.deductions) items.push({ ...base, id: `d${o.id}`, bonusType: "DEDUCTION", note: "", amount: -Number(o.deductions) });
    for (const it of items) {
      // Un saldo que solo se MUEVE de un pago a otro del mismo técnico (Tech-0041 → Tech-0213: +616.19
      // aquí, −616.19 allá) no es costo ni recuperación: la labor ya está contada en las órdenes.
      // Se reconoce porque su nota nombra al otro pago. Los saldos de 2024 pagados en 2025 sí entran.
      if (it.bonusType === "PRIOR_BALANCE" && /(Tech|Agent)-d{4}/.test(it.note || "")) continue;
      if (it.bonusType === "PRIOR_BALANCE") out.priorBalances.push(it);
      else if (o.type === "TECHNICIAN") out.technicianAdjustments.push(it);
      else out.agentAdjustments.push(it);
    }
  }
  return out;
}

// El estado de resultados como lo lee un dueño de negocio (Antonio, 8-sep-2026): cobros brutos,
// menos el sales tax que se le debe al estado, = ingreso neto; menos costo de ventas (partes,
// técnicos, comisiones de agentes, comisión del procesador de tarjetas, socios) = utilidad bruta;
// menos gastos operativos = utilidad neta. `kpis.revenue` sigue siendo el total cobrado — es la
// cifra que cuadra con /sales, el QuickView y el resumen de Reports — y todo lo demás cuelga de ahí.
router.get("/profit-loss", async (req, res) => {
  const { dateFrom, dateTo, type } = req.query;
  const cardFeePercent = normalizeCardFeePercent(req.query.cardFeePercent);

  function inRange(d) {
    if (!d) return !dateFrom && !dateTo;
    if (dateFrom && d < dateFrom) return false;
    if (dateTo && d > dateTo) return false;
    return true;
  }

  const allWorkOrders = await workOrdersStore.list();
  const workOrders = allWorkOrders.filter((w) => {
    if (!inRange(w.appointmentDate)) return false;
    if (type && (w.workOrderType || "Personal") !== type) return false;
    return true;
  });

  const quotes = await quotesStore.list();
  const quoteById = new Map(quotes.map((q) => [q.id, q]));

  const expenses = expensesStore.list().filter((e) => inRange(e.date));

  const paidWorkOrders = workOrders.filter((w) => w.payment?.paid);
  const revenue = paidWorkOrders.reduce((sum, w) => sum + Number(w.payment?.amount || 0), 0);

  // Revenue breakdown: see computeRevenueComponents() in lib/profitLossCalc.js for the "other"
  // plug rationale. Guarantees the 5 categories always sum to exactly `revenue`.
  let revParts = 0, revCalibration = 0, revDeductibles = 0, revSalesTax = 0, revOther = 0;
  const revPartsWOs = [], revCalibrationWOs = [], revDeductiblesWOs = [], revSalesTaxWOs = [], revOtherWOs = [];
  const salesTaxByState = Object.fromEntries([...TAX_STATES, "none"].map((s) => [s, { state: s, amount: 0, count: 0 }]));

  // Comisión del procesador: solo sobre lo cobrado con tarjeta, al porcentaje que pide la pantalla.
  let costCardFees = 0, cardCollected = 0;
  const costCardFeesWOs = [];

  for (const w of paidWorkOrders) {
    const quote = w.quoteId ? quoteById.get(w.quoteId) : null;
    const { parts, calibration, deductibles, salesTax, other } = computeRevenueComponents(w, quote);
    const row = { id: w.id, workOrderNo: w.workOrderNo, customerName: w.customerName };

    revParts += parts;
    revCalibration += calibration;
    revDeductibles += deductibles;
    revSalesTax += salesTax;
    revOther += other;
    if (parts) revPartsWOs.push({ ...row, amount: parts });
    if (calibration) revCalibrationWOs.push({ ...row, amount: calibration });
    if (deductibles) revDeductiblesWOs.push({ ...row, amount: deductibles });
    if (salesTax) {
      const state = taxStateOf(w);
      revSalesTaxWOs.push({ ...row, amount: salesTax, detail: `${state === "none" ? "—" : state} · ${Number(quote?.taxRate || 0)}%` });
      salesTaxByState[state].amount += salesTax;
      salesTaxByState[state].count += 1;
    }
    if (other) revOtherWOs.push({ ...row, amount: other });

    const { cardAmount, fee, method, mixed } = computeCardFee(w, cardFeePercent);
    if (fee) {
      costCardFees += fee;
      cardCollected += cardAmount;
      costCardFeesWOs.push({ ...row, amount: fee, detail: `${method}${mixed ? " ⚠" : ""} · $${cardAmount.toFixed(2)}` });
    }
  }

  // Cost breakdown: direct per-work-order costs, counted regardless of payment status.
  let costParts = 0, costCommissions = 0, costPayroll = 0;
  const costPartsWOs = [], costCommissionsWOs = [], costPayrollWOs = [];

  for (const w of workOrders) {
    const { glass, commission, labor } = computeCostComponents(w);
    const row = { id: w.id, workOrderNo: w.workOrderNo, customerName: w.customerName };

    costParts += glass;
    costCommissions += commission;
    costPayroll += labor;
    if (glass) costPartsWOs.push({ ...row, amount: glass });
    if (commission) costCommissionsWOs.push({ ...row, amount: commission });
    if (labor) costPayrollWOs.push({ ...row, amount: labor });
  }

  // Partner distributions are date-filtered by paid_at (when the distribution actually happened),
  // not appointmentDate like the 3 categories above — a distribution doesn't exist until the WO
  // is paid, so appointmentDate would be the wrong axis. Sourced from the stored ledger rather
  // than recomputed here, so the configured cutoff date and the "which job type" logic only ever
  // live in one place (partnerDistributions.store.js).
  const workOrderTypeById = new Map(allWorkOrders.map((w) => [w.id, w.workOrderType || "Personal"]));
  const partnerDistributions = (await partnerDistributionsStore.query({ dateFrom, dateTo })).filter(
    (d) => !type || workOrderTypeById.get(d.workOrderId) === type
  );
  const costPartnerDist = partnerDistributions.reduce((sum, d) => sum + d.amount, 0);
  const costPartnerDistWOs = partnerDistributions.map((d) => ({
    id: d.workOrderId,
    workOrderNo: d.workOrderNo,
    customerName: d.partnerName,
    amount: d.amount,
  }));

  const operatingExpenses = expenses.reduce((sum, e) => sum + Number(e.amount || 0), 0);
  const ajustes = await loadPayoutAdjustments({ dateFrom, dateTo });
  const sumAj = (rows) => rows.reduce((s, x) => s + x.amount, 0);

  // El sales tax no es ingreso ni costo: se cobra y se entrega al estado. Sale de los cobros antes
  // de medir cualquier margen, y todos los porcentajes de costos se miden contra el ingreso neto.
  const netRevenue = revenue - revSalesTax;
  const pctOfGross = (amount) => (revenue ? (amount / revenue) * 100 : 0);
  const pctOfNet = (amount) => (netRevenue ? (amount / netRevenue) * 100 : 0);

  const ajusteRow = (key) => {
    const rows = ajustes[key];
    const amount = sumAj(rows);
    return { key, group: COST_GROUPS[key], amount, percentOfRevenue: pctOfNet(amount), items: rows.slice(0, DRILL_CAP), totalCount: rows.length };
  };
  const woRow = (key, amount, rows) => ({ key, group: COST_GROUPS[key], amount, percentOfRevenue: pctOfNet(amount), ...capList(rows) });

  const costBreakdown = [
    woRow("partsDistributors", costParts, costPartsWOs),
    woRow("technicianPayroll", costPayroll, costPayrollWOs),
    woRow("agentCommissions", costCommissions, costCommissionsWOs),
    { ...woRow("cardProcessingFees", costCardFees, costCardFeesWOs), cardFeePercent, cardCollected, cardOrders: costCardFeesWOs.length },
    woRow("partnerDistribution", costPartnerDist, costPartnerDistWOs),
    ajusteRow("technicianAdjustments"),
    ajusteRow("agentAdjustments"),
    ajusteRow("priorBalances"),
    {
      key: "operatingExpenses",
      group: COST_GROUPS.operatingExpenses,
      amount: operatingExpenses,
      percentOfRevenue: pctOfNet(operatingExpenses),
      items: expenses
        .slice()
        .sort((a, b) => Number(b.amount) - Number(a.amount))
        .slice(0, DRILL_CAP)
        .map((e) => ({ id: e.id, category: e.category, date: e.date, amount: Number(e.amount) })),
      totalCount: expenses.length,
    },
  ];

  const costOfSales = costBreakdown.filter((c) => c.group === "costOfSales").reduce((s, c) => s + c.amount, 0);
  const operatingTotal = costBreakdown.filter((c) => c.group === "operating").reduce((s, c) => s + c.amount, 0);
  const costs = costOfSales + operatingTotal;
  const grossProfit = netRevenue - costOfSales;
  const profit = netRevenue - costs;

  res.json({
    filters: { dateFrom: dateFrom || "", dateTo: dateTo || "", type: type || "", cardFeePercent },
    kpis: {
      revenue,
      salesTax: revSalesTax,
      netRevenue,
      costOfSales,
      grossProfit,
      grossMarginPercent: pctOfNet(grossProfit),
      operatingExpenses: operatingTotal,
      costs,
      profit,
      marginPercent: pctOfNet(profit),
      cardFeePercent,
      cardCollected,
      cardFees: costCardFees,
    },
    revenueBreakdown: [
      { key: "parts", amount: revParts, percentOfRevenue: pctOfGross(revParts), ...capList(revPartsWOs) },
      { key: "calibration", amount: revCalibration, percentOfRevenue: pctOfGross(revCalibration), ...capList(revCalibrationWOs) },
      { key: "deductibles", amount: revDeductibles, percentOfRevenue: pctOfGross(revDeductibles), ...capList(revDeductiblesWOs) },
      { key: "other", amount: revOther, percentOfRevenue: pctOfGross(revOther), ...capList(revOtherWOs) },
      { key: "salesTax", amount: revSalesTax, percentOfRevenue: pctOfGross(revSalesTax), ...capList(revSalesTaxWOs) },
    ],
    revenueDeductions: [
      {
        key: "salesTax",
        amount: revSalesTax,
        percentOfRevenue: pctOfGross(revSalesTax),
        byState: Object.values(salesTaxByState).filter((s) => s.amount),
        ...capList(revSalesTaxWOs),
      },
    ],
    costBreakdown,
  });
});

// Same underlying math as /profit-loss (must reconcile with it exactly when unfiltered), bucketed
// by calendar month for a given year, and optionally narrowed to one state (CA/TX). Passing no
// `year` aggregates every year in the data instead of a single one — that's the mode that
// reconciles against /profit-loss's own unfiltered totals, and the only mode where the "no date"
// column can hold anything (see below).
//
// A handful of historical work orders (currently just 1, Wo-2866) have no appointmentDate at all,
// so they can't be assigned to a month OR a year. When a specific year is requested they're
// correctly left out (there's no evidence they belong to that year). When no year is requested,
// they're surfaced in an explicit "no date" column instead of being silently dropped — that's
// what keeps this endpoint's grand total matching /profit-loss to the cent.
router.get("/profit-loss-matrix", async (req, res) => {
  const { year, state } = req.query;
  const cardFeePercent = normalizeCardFeePercent(req.query.cardFeePercent);

  const allWorkOrders = await workOrdersStore.list();
  const availableYears = [...new Set(allWorkOrders.filter((w) => validDateStr(w.appointmentDate)).map((w) => w.appointmentDate.slice(0, 4)))].sort();

  let workOrders = allWorkOrders.filter((w) => !MATRIX_EXCLUDED_TYPES.includes(w.workOrderType));
  if (state) workOrders = workOrders.filter((w) => w.state === state);
  if (year) {
    workOrders = workOrders.filter((w) => validDateStr(w.appointmentDate) && w.appointmentDate.slice(0, 4) === String(year));
  }

  const quotes = await quotesStore.list();
  const quoteById = new Map(quotes.map((q) => [q.id, q]));

  const paidWorkOrders = workOrders.filter((w) => w.payment?.paid);
  const revenue = paidWorkOrders.reduce((sum, w) => sum + Number(w.payment?.amount || 0), 0);

  const revenueRows = { parts: [], calibration: [], deductibles: [], other: [], salesTax: [] };
  const salesTaxStateRows = Object.fromEntries([...TAX_STATES, "none"].map((s) => [s, []]));
  const cardFeeRows = [];
  let cardCollected = 0;
  for (const w of paidWorkOrders) {
    const month = validDateStr(w.appointmentDate) ? monthOf(w.appointmentDate) : null;
    const quote = w.quoteId ? quoteById.get(w.quoteId) : null;
    const { parts, calibration, deductibles, salesTax, other } = computeRevenueComponents(w, quote);
    const row = { month, id: w.id, workOrderNo: w.workOrderNo, customerName: w.customerName };
    revenueRows.parts.push({ ...row, amount: parts });
    revenueRows.calibration.push({ ...row, amount: calibration });
    revenueRows.deductibles.push({ ...row, amount: deductibles });
    revenueRows.other.push({ ...row, amount: other });
    revenueRows.salesTax.push({ ...row, amount: salesTax });
    salesTaxStateRows[taxStateOf(w)].push({ ...row, amount: salesTax });

    const { cardAmount, fee, method, mixed } = computeCardFee(w, cardFeePercent);
    cardCollected += cardAmount;
    cardFeeRows.push({ ...row, customerName: fee ? `${w.customerName} · ${method}${mixed ? " ⚠" : ""}` : w.customerName, amount: fee });
  }

  const costRows = { partsDistributors: [], technicianPayroll: [], agentCommissions: [], cardProcessingFees: cardFeeRows };
  const chargebackRows = [];
  for (const w of workOrders) {
    const month = validDateStr(w.appointmentDate) ? monthOf(w.appointmentDate) : null;
    const { glass, commission, labor } = computeCostComponents(w);
    const row = { month, id: w.id, workOrderNo: w.workOrderNo, customerName: w.customerName };
    costRows.partsDistributors.push({ ...row, amount: glass });
    costRows.technicianPayroll.push({ ...row, amount: labor });
    costRows.agentCommissions.push({ ...row, amount: commission });
    if (w.isChargeback) chargebackRows.push({ ...row, amount: glass + commission + labor });
  }

  // Partner distributions are keyed by paid_at, not appointmentDate (see /profit-loss above for
  // why), so they're fetched with their own date bounds rather than reusing the `workOrders` list.
  const stateById = new Map(allWorkOrders.map((w) => [w.id, w.state]));
  const typeById = new Map(allWorkOrders.map((w) => [w.id, w.workOrderType || "Personal"]));
  const distDateFrom = year ? `${year}-01-01` : undefined;
  const distDateTo = year ? `${year}-12-31` : undefined;
  const partnerDistributions = (await partnerDistributionsStore.query({ dateFrom: distDateFrom, dateTo: distDateTo })).filter((d) => {
    if (MATRIX_EXCLUDED_TYPES.includes(typeById.get(d.workOrderId))) return false;
    if (state && stateById.get(d.workOrderId) !== state) return false;
    return true;
  });
  costRows.partnerDistribution = partnerDistributions.map((d) => ({
    month: d.paidAt ? new Date(d.paidAt).getUTCMonth() : null,
    id: d.workOrderId,
    workOrderNo: d.workOrderNo,
    customerName: d.partnerName,
    amount: d.amount,
  }));

  const revenueBreakdown = Object.entries(revenueRows).map(([key, rows]) => buildMatrixCategory(key, rows));
  const salesTaxByState = Object.entries(salesTaxStateRows)
    .map(([key, rows]) => buildMatrixCategory(key, rows))
    .filter((c) => c.total);
  const costBreakdown = Object.entries(costRows).map(([key, rows]) => buildMatrixCategory(key, rows));

  // Operating expenses aren't split by state in the accountant's own template, so they're only
  // meaningful in the "All States" view — a state-filtered request omits this row entirely rather
  // than showing a prorated (and misleading) slice.
  if (!state) {
    // Los bonos y ajustes de los pagos tampoco se parten por estado: solo en "All States".
    const ajustes = await loadPayoutAdjustments({ year });
    for (const key of ["technicianAdjustments", "agentAdjustments", "priorBalances"]) {
      costBreakdown.push(buildMatrixCategory(key, ajustes[key].map((a) => ({
        month: validDateStr(a.date) ? monthOf(a.date) : null,
        id: a.id,
        workOrderNo: a.paymentNumber,
        customerName: [a.bonusType, a.note].filter(Boolean).join(" · "),
        amount: a.amount,
      }))));
    }
    const expenses = expensesStore.list().filter((e) => !year || (validDateStr(e.date) && e.date.slice(0, 4) === String(year)));
    const expenseRows = expenses.map((e) => ({
      month: validDateStr(e.date) ? monthOf(e.date) : null,
      id: e.id,
      workOrderNo: "",
      customerName: e.category,
      amount: Number(e.amount || 0),
    }));
    costBreakdown.push(buildMatrixCategory("operatingExpenses", expenseRows));
  }
  for (const c of costBreakdown) c.group = COST_GROUPS[c.key];

  const chargebacks = buildMatrixCategory("chargebacks", chargebackRows);

  // Sum a set of already-built categories down to a single {monthly, noDate, total} for the KPI rows.
  function sumCategories(categories) {
    const monthly = Array(12).fill(0);
    let noDate = 0;
    for (const c of categories) {
      c.monthly.forEach((v, i) => (monthly[i] += v));
      noDate += c.noDate;
    }
    return { monthly, noDate, total: monthly.reduce((s, v) => s + v, 0) + noDate };
  }
  const minus = (a, b) => ({ monthly: a.monthly.map((v, i) => v - b.monthly[i]), noDate: a.noDate - b.noDate, total: a.total - b.total });

  const gross = sumCategories(revenueBreakdown);
  const salesTax = revenueBreakdown.find((c) => c.key === "salesTax");
  const netRevenue = minus(gross, salesTax);
  const costOfSales = sumCategories(costBreakdown.filter((c) => c.group === "costOfSales"));
  const operating = sumCategories(costBreakdown.filter((c) => c.group === "operating"));
  const costsAgg = sumCategories(costBreakdown);
  const grossProfit = minus(netRevenue, costOfSales);
  const profitAgg = minus(netRevenue, costsAgg);

  res.json({
    filters: { year: year || "", state: state || "", cardFeePercent },
    availableYears,
    kpis: {
      revenueMonthly: gross.monthly,
      revenueNoDate: gross.noDate,
      revenueTotal: revenue,
      salesTaxMonthly: salesTax.monthly,
      salesTaxNoDate: salesTax.noDate,
      salesTaxTotal: salesTax.total,
      netRevenueMonthly: netRevenue.monthly,
      netRevenueNoDate: netRevenue.noDate,
      netRevenueTotal: netRevenue.total,
      costOfSalesMonthly: costOfSales.monthly,
      costOfSalesNoDate: costOfSales.noDate,
      costOfSalesTotal: costOfSales.total,
      grossProfitMonthly: grossProfit.monthly,
      grossProfitNoDate: grossProfit.noDate,
      grossProfitTotal: grossProfit.total,
      grossMarginPercent: netRevenue.total ? (grossProfit.total / netRevenue.total) * 100 : 0,
      operatingMonthly: operating.monthly,
      operatingNoDate: operating.noDate,
      operatingTotal: operating.total,
      costsMonthly: costsAgg.monthly,
      costsNoDate: costsAgg.noDate,
      costsTotal: costsAgg.total,
      profitMonthly: profitAgg.monthly,
      profitNoDate: profitAgg.noDate,
      profitTotal: profitAgg.total,
      marginPercent: netRevenue.total ? (profitAgg.total / netRevenue.total) * 100 : 0,
      cardFeePercent,
      cardCollected,
    },
    revenueBreakdown,
    salesTaxByState,
    costBreakdown,
    chargebacks: {
      ...chargebacks,
      note: "Informational only — already included in Glass Parts / Installer Contractors / Agent Commissions above, not subtracted separately.",
    },
  });
});

// Sales tax cobrado por estado y mes, tal como se llena la declaración (CDTFA en CA, Comptroller en
// TX): órdenes, base gravable, impuesto y tasa efectiva. Misma función y mismo eje de fecha (día del
// trabajo, órdenes pagadas) que el P&L, así que el total anual cuadra al centavo con la fila de
// sales tax de la matriz. Antonio, 8-sep-2026: "no veo cuánto pagamos de sales tax cada mes y
// anualmente".
router.get("/sales-tax", async (req, res) => {
  const { year } = req.query;
  const allWorkOrders = await workOrdersStore.list();
  const quotes = await quotesStore.list();
  const quoteById = new Map(quotes.map((q) => [q.id, q]));

  const paid = allWorkOrders.filter((w) => w.payment?.paid && !MATRIX_EXCLUDED_TYPES.includes(w.workOrderType));
  const availableYears = [...new Set(paid.filter((w) => validDateStr(w.appointmentDate)).map((w) => w.appointmentDate.slice(0, 4)))].sort();
  const inYear = year ? paid.filter((w) => validDateStr(w.appointmentDate) && w.appointmentDate.slice(0, 4) === String(year)) : paid;

  const states = [...TAX_STATES, "none"];
  // taxableBase = partes (lo que se declara); nonTaxable = mano de obra, calibración, viaje y
  // servicios (lo que NO se declara). Juntas son la venta antes de impuesto.
  const emptyCell = () => ({ orders: 0, taxableBase: 0, nonTaxable: 0, tax: 0, items: [] });
  const months = Array.from({ length: 12 }, () => Object.fromEntries(states.map((s) => [s, emptyCell()])));
  const noDate = Object.fromEntries(states.map((s) => [s, emptyCell()]));
  const totals = Object.fromEntries(states.map((s) => [s, emptyCell()]));

  for (const w of inYear) {
    const quote = w.quoteId ? quoteById.get(w.quoteId) : null;
    const tax = computeSalesTax(w, quote);
    const base = computeTaxableBase(w, quote, tax);
    const nonTaxable = computeNonTaxableBase(w, quote);
    // Una orden sin impuesto pero con venta (todo labor, o tasa 0) sí cuenta: su venta no gravable
    // es parte de lo que la declaración pide separar.
    if (!tax && !base && !nonTaxable) continue;
    const s = taxStateOf(w);
    const item = { id: w.id, workOrderNo: w.workOrderNo, customerName: w.customerName, date: w.appointmentDate || "", taxRate: w.taxRate ?? Number(quote?.taxRate || 0), taxableBase: base, nonTaxable, amount: tax };
    const cell = validDateStr(w.appointmentDate) ? months[monthOf(w.appointmentDate)][s] : noDate[s];
    for (const c of [cell, totals[s]]) {
      c.orders += 1;
      c.taxableBase += base;
      c.nonTaxable += nonTaxable;
      c.tax += tax;
      c.items.push(item);
    }
  }

  // Solo el detalle por celda va acotado; los totales y la fila anual salen completos.
  const finish = (cell) => ({ orders: cell.orders, taxableBase: cell.taxableBase, nonTaxable: cell.nonTaxable, tax: cell.tax, effectiveRate: cell.taxableBase ? (cell.tax / cell.taxableBase) * 100 : 0, ...capList(cell.items) });
  const finishRow = (byState) => {
    const out = Object.fromEntries(states.map((s) => [s, finish(byState[s])]));
    out.all = finish({
      orders: states.reduce((n, s) => n + byState[s].orders, 0),
      taxableBase: states.reduce((n, s) => n + byState[s].taxableBase, 0),
      nonTaxable: states.reduce((n, s) => n + byState[s].nonTaxable, 0),
      tax: states.reduce((n, s) => n + byState[s].tax, 0),
      items: [],
    });
    return out;
  };

  res.json({
    filters: { year: year || "" },
    availableYears,
    states,
    months: months.map(finishRow),
    noDate: finishRow(noDate),
    totals: finishRow(totals),
    // Qué porcentaje del negocio fue de cada estado. Sobre lo cobrado (todas las órdenes pagadas del
    // año, no solo las que tienen impuesto), para que cuadre con el ingreso del P&L de ese año.
    revenueByState: computeRevenueByState(inYear),
  });
});

// Convierte a .xlsx de verdad lo que el Reporte Detallado tiene en pantalla.
//
// Las filas llegan ya armadas desde el cliente, a proposito: son EXACTAMENTE las que se estan
// viendo en la vista previa, con las columnas y el orden que el usuario eligio. Rehacerlas aqui
// significaria mantener el catalogo de columnas y los filtros en dos sitios, y la primera vez que
// se tocara uno el archivo dejaria de coincidir con la pantalla. Este endpoint solo da formato.
//
// El CSV no pasa por aqui: eso se genera en el navegador sin pedirle nada al servidor. Aqui se
// viene solo por el binario de Excel, que necesita la libreria.
const EXPORT_MAX_ROWS = 20000;

router.post("/detailed/export", async (req, res) => {
  const { columns, rows, sheetName } = req.body || {};

  if (!Array.isArray(columns) || !columns.length) return res.status(400).json({ error: "columns is required" });
  if (!Array.isArray(rows)) return res.status(400).json({ error: "rows is required" });
  // Tope declarado y no un fallo por falta de memoria a mitad del archivo. Con 4,580 ordenes hoy
  // sobra de largo; si algun dia no, el aviso dice que hay que filtrar.
  if (rows.length > EXPORT_MAX_ROWS) {
    return res.status(413).json({ error: `Too many rows (${rows.length}). Narrow the filters to ${EXPORT_MAX_ROWS} or fewer.` });
  }

  const header = columns.map((c) => String(c.label ?? c.key ?? ""));
  const keys = columns.map((c) => String(c.key ?? ""));

  // aoa y no json_to_sheet: asi el orden de las columnas es el que mandan y no el que salga de las
  // claves del objeto. Los importes van como numero -no como "$543.38"- para que en Excel se
  // puedan sumar; el formato con simbolo se aplica abajo.
  const body = rows.map((row) => keys.map((k) => (row && row[k] !== undefined ? row[k] : "")));
  const sheet = xlsx.utils.aoa_to_sheet([header, ...body]);

  const moneyCols = new Set(columns.map((c, i) => (c.type === "money" ? i : -1)).filter((i) => i >= 0));
  if (moneyCols.size) {
    for (let r = 1; r <= body.length; r++) {
      for (const c of moneyCols) {
        const cell = sheet[xlsx.utils.encode_cell({ r, c })];
        if (cell && typeof cell.v === "number") cell.z = '"$"#,##0.00';
      }
    }
  }

  // Ancho por el contenido mas largo de cada columna, acotado: sin esto todo sale en el ancho por
  // defecto y hay que ajustar a mano 11 columnas antes de poder leer nada.
  sheet["!cols"] = header.map((h, c) => ({
    wch: Math.min(40, Math.max(10, h.length + 2, ...body.map((r) => String(r[c] ?? "").length + 2))),
  }));

  const book = xlsx.utils.book_new();
  xlsx.utils.book_append_sheet(book, sheet, String(sheetName || "Report").slice(0, 31));
  const buffer = xlsx.write(book, { type: "buffer", bookType: "xlsx" });

  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", 'attachment; filename="detailed-report.xlsx"');
  res.send(buffer);
});

router.get("/sales", async (req, res) => {
  const quotes = await quotesStore.list();
  const workOrders = await workOrdersStore.list();
  const personalWOs = workOrders.filter((w) => w.workOrderType !== "Insurance");
  const insuranceWOs = workOrders.filter((w) => w.workOrderType === "Insurance");
  const revenueOf = (list) => list.filter((w) => w.payment.paid).reduce((sum, w) => sum + Number(w.payment.amount || 0), 0);
  const completedOf = (list) => list.filter((w) => workOrdersStore.COMPLETED_STATUSES.includes(w.status)).length;

  res.json({
    totalQuotes: quotes.length,
    convertedQuotes: quotes.filter((q) => q.status === "Converted").length,
    totalWorkOrders: workOrders.length,
    completedWorkOrders: workOrders.filter((w) => workOrdersStore.COMPLETED_STATUSES.includes(w.status)).length,
    pendingPayment: workOrders.filter((w) => !w.payment.paid).length,
    personalQuotes: quotes.filter((q) => q.paymentType !== "Insurance").length,
    insuranceQuotes: quotes.filter((q) => q.paymentType === "Insurance").length,
    personalWorkOrders: personalWOs.length,
    insuranceWorkOrders: insuranceWOs.length,
    personalRevenue: revenueOf(personalWOs),
    insuranceRevenue: revenueOf(insuranceWOs),
    completedPersonalWorkOrders: completedOf(personalWOs),
    completedInsuranceWorkOrders: completedOf(insuranceWOs),
  });
});

router.get("/technicians", async (req, res) => {
  const workOrders = await workOrdersStore.list();
  const byTech = {};

  for (const w of workOrders) {
    const tech = w.tech || "Sin asignar";
    if (!byTech[tech]) byTech[tech] = { tech, jobs: 0, revenue: 0 };
    byTech[tech].jobs += 1;
    if (w.payment.paid) byTech[tech].revenue += Number(w.payment.amount || 0);
  }

  res.json(Object.values(byTech));
});

router.get("/partners", async (req, res) => {
  const { dateFrom, dateTo } = req.query;
  const distributions = await partnerDistributionsStore.query({ dateFrom, dateTo });

  const byPartner = new Map();
  for (const d of distributions) {
    if (!byPartner.has(d.partnerId)) {
      byPartner.set(d.partnerId, { partnerId: d.partnerId, partnerName: d.partnerName, amount: 0, workOrders: [] });
    }
    const bucket = byPartner.get(d.partnerId);
    bucket.amount += d.amount;
    bucket.workOrders.push({ id: d.id, workOrderId: d.workOrderId, workOrderNo: d.workOrderNo, jobType: d.jobType, amount: d.amount, paidAt: d.paidAt });
  }

  // Pagos al socio en el rango y saldo de todos los tiempos (Antonio, 7-sep-2026): lo distribuido
  // es lo ganado; los pagos son los cheques entregados; el saldo es lo que falta por pagar.
  const pagos = await partnerPaymentsStore.list({ dateFrom, dateTo });
  const saldos = await partnerPaymentsStore.balances();
  for (const [id, s] of saldos) {
    if (!byPartner.has(id)) byPartner.set(id, { partnerId: id, partnerName: s.partnerName, amount: 0, workOrders: [] });
  }
  const rows = [...byPartner.values()]
    .map(({ workOrders, ...bucket }) => {
      const s = saldos.get(bucket.partnerId) || { distributedAllTime: 0, paidAllTime: 0, balance: 0 };
      const pays = pagos.filter((p) => p.partnerId === bucket.partnerId);
      return { ...bucket, ...capList(workOrders), payments: pays, paidInRange: pays.reduce((a, p) => a + p.amount, 0), distributedAllTime: s.distributedAllTime, paidAllTime: s.paidAllTime, balance: s.balance };
    })
    .sort((a, b) => b.amount - a.amount);

  res.json({
    filters: { dateFrom: dateFrom || "", dateTo: dateTo || "" },
    totalAmount: distributions.reduce((sum, d) => sum + d.amount, 0),
    totalPaid: pagos.reduce((sum, p) => sum + p.amount, 0),
    totalBalance: [...saldos.values()].reduce((sum, s) => sum + s.balance, 0),
    partners: rows,
  });
});

router.get("/expenses", async (req, res) => {
  const expenses = await expensesStore.list();
  const byCategory = {};

  for (const e of expenses) {
    const category = e.category || "Sin categoría";
    byCategory[category] = (byCategory[category] || 0) + Number(e.amount || 0);
  }

  res.json(Object.entries(byCategory).map(([category, total]) => ({ category, total })));
});

module.exports = router;
