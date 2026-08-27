const express = require("express");
const xlsx = require("xlsx");
const quotesStore = require("../store/quotes.store");
const workOrdersStore = require("../store/workorders.store");
const expensesStore = require("../store/expenses.store");
const partnerDistributionsStore = require("../store/partnerDistributions.store");
const { computeRevenueComponents, computeCostComponents } = require("../lib/profitLossCalc");

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
router.get("/profit-loss", async (req, res) => {
  const { dateFrom, dateTo, type } = req.query;

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
  // plug rationale. Guarantees the 4 categories always sum to exactly `revenue`.
  let revParts = 0, revCalibration = 0, revDeductibles = 0, revOther = 0;
  const revPartsWOs = [], revCalibrationWOs = [], revDeductiblesWOs = [], revOtherWOs = [];

  for (const w of paidWorkOrders) {
    const quote = w.quoteId ? quoteById.get(w.quoteId) : null;
    const { parts, calibration, deductibles, other } = computeRevenueComponents(w, quote);
    const row = { id: w.id, workOrderNo: w.workOrderNo, customerName: w.customerName };

    revParts += parts;
    revCalibration += calibration;
    revDeductibles += deductibles;
    revOther += other;
    if (parts) revPartsWOs.push({ ...row, amount: parts });
    if (calibration) revCalibrationWOs.push({ ...row, amount: calibration });
    if (deductibles) revDeductiblesWOs.push({ ...row, amount: deductibles });
    if (other) revOtherWOs.push({ ...row, amount: other });
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
  const costs = costParts + costCommissions + costPayroll + costPartnerDist + operatingExpenses;
  const profit = revenue - costs;
  const marginPercent = revenue ? (profit / revenue) * 100 : 0;
  const pctOfRevenue = (amount) => (revenue ? (amount / revenue) * 100 : 0);

  res.json({
    filters: { dateFrom: dateFrom || "", dateTo: dateTo || "", type: type || "" },
    kpis: { revenue, costs, profit, marginPercent },
    revenueBreakdown: [
      { key: "parts", amount: revParts, percentOfRevenue: pctOfRevenue(revParts), ...capList(revPartsWOs) },
      { key: "calibration", amount: revCalibration, percentOfRevenue: pctOfRevenue(revCalibration), ...capList(revCalibrationWOs) },
      { key: "deductibles", amount: revDeductibles, percentOfRevenue: pctOfRevenue(revDeductibles), ...capList(revDeductiblesWOs) },
      { key: "other", amount: revOther, percentOfRevenue: pctOfRevenue(revOther), ...capList(revOtherWOs) },
    ],
    costBreakdown: [
      { key: "partsDistributors", amount: costParts, percentOfRevenue: pctOfRevenue(costParts), ...capList(costPartsWOs) },
      { key: "agentCommissions", amount: costCommissions, percentOfRevenue: pctOfRevenue(costCommissions), ...capList(costCommissionsWOs) },
      { key: "technicianPayroll", amount: costPayroll, percentOfRevenue: pctOfRevenue(costPayroll), ...capList(costPayrollWOs) },
      { key: "partnerDistribution", amount: costPartnerDist, percentOfRevenue: pctOfRevenue(costPartnerDist), ...capList(costPartnerDistWOs) },
      {
        key: "operatingExpenses",
        amount: operatingExpenses,
        percentOfRevenue: pctOfRevenue(operatingExpenses),
        items: expenses
          .slice()
          .sort((a, b) => Number(b.amount) - Number(a.amount))
          .slice(0, DRILL_CAP)
          .map((e) => ({ id: e.id, category: e.category, date: e.date, amount: Number(e.amount) })),
        totalCount: expenses.length,
      },
    ],
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

  const revenueRows = { parts: [], calibration: [], deductibles: [], other: [] };
  for (const w of paidWorkOrders) {
    const month = validDateStr(w.appointmentDate) ? monthOf(w.appointmentDate) : null;
    const quote = w.quoteId ? quoteById.get(w.quoteId) : null;
    const { parts, calibration, deductibles, other } = computeRevenueComponents(w, quote);
    const row = { month, id: w.id, workOrderNo: w.workOrderNo, customerName: w.customerName };
    revenueRows.parts.push({ ...row, amount: parts });
    revenueRows.calibration.push({ ...row, amount: calibration });
    revenueRows.deductibles.push({ ...row, amount: deductibles });
    revenueRows.other.push({ ...row, amount: other });
  }

  const costRows = { partsDistributors: [], agentCommissions: [], technicianPayroll: [] };
  const chargebackRows = [];
  for (const w of workOrders) {
    const month = validDateStr(w.appointmentDate) ? monthOf(w.appointmentDate) : null;
    const { glass, commission, labor } = computeCostComponents(w);
    const row = { month, id: w.id, workOrderNo: w.workOrderNo, customerName: w.customerName };
    costRows.partsDistributors.push({ ...row, amount: glass });
    costRows.agentCommissions.push({ ...row, amount: commission });
    costRows.technicianPayroll.push({ ...row, amount: labor });
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
  const costBreakdown = Object.entries(costRows).map(([key, rows]) => buildMatrixCategory(key, rows));

  // Operating expenses aren't split by state in the accountant's own template, so they're only
  // meaningful in the "All States" view — a state-filtered request omits this row entirely rather
  // than showing a prorated (and misleading) slice.
  if (!state) {
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

  const costs = costBreakdown.reduce((sum, c) => sum + c.total, 0);
  const profit = revenue - costs;

  const chargebacks = buildMatrixCategory("chargebacks", chargebackRows);

  // Sum a set of already-built categories down to a single {monthly, noDate} pair for the KPI row.
  function sumCategories(categories) {
    const monthly = Array(12).fill(0);
    let noDate = 0;
    for (const c of categories) {
      c.monthly.forEach((v, i) => (monthly[i] += v));
      noDate += c.noDate;
    }
    return { monthly, noDate };
  }
  const revenueMonthlyAgg = sumCategories(revenueBreakdown);
  const costsMonthlyAgg = sumCategories(costBreakdown);
  const profitMonthly = revenueMonthlyAgg.monthly.map((v, i) => v - costsMonthlyAgg.monthly[i]);
  const profitNoDate = revenueMonthlyAgg.noDate - costsMonthlyAgg.noDate;

  res.json({
    filters: { year: year || "", state: state || "" },
    availableYears,
    kpis: {
      revenueMonthly: revenueMonthlyAgg.monthly,
      revenueNoDate: revenueMonthlyAgg.noDate,
      revenueTotal: revenue,
      costsMonthly: costsMonthlyAgg.monthly,
      costsNoDate: costsMonthlyAgg.noDate,
      costsTotal: costs,
      profitMonthly,
      profitNoDate,
      profitTotal: profit,
      marginPercent: revenue ? (profit / revenue) * 100 : 0,
    },
    revenueBreakdown,
    costBreakdown,
    chargebacks: {
      ...chargebacks,
      note: "Informational only — already included in Glass Parts / Installer Contractors / Agent Commissions above, not subtracted separately.",
    },
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

  const rows = [...byPartner.values()]
    .map(({ workOrders, ...bucket }) => ({ ...bucket, ...capList(workOrders) }))
    .sort((a, b) => b.amount - a.amount);

  res.json({
    filters: { dateFrom: dateFrom || "", dateTo: dateTo || "" },
    totalAmount: distributions.reduce((sum, d) => sum + d.amount, 0),
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
