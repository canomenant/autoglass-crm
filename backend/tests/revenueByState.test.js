// El reparto por estado tiene que cuadrar con el ingreso del P&L (misma base: lo cobrado en las
// órdenes pagadas) y contestar dos preguntas distintas sin mezclarlas: qué parte del total fue de
// cada estado, y cómo se reparte entre CA y TX ignorando las órdenes que aún no tienen estado.
const { test, describe } = require("node:test");
const assert = require("node:assert");

const { computeRevenueByState } = require("../src/lib/profitLossCalc");

const wo = (state, amount, paid = true) => ({ state, payment: { paid, amount } });

describe("computeRevenueByState", () => {
  test("suma lo cobrado por estado y reparte el porcentaje sobre el total", () => {
    const r = computeRevenueByState([wo("CA", 600), wo("CA", 200), wo("TX", 200)]);
    assert.strictEqual(r.CA.orders, 2);
    assert.strictEqual(r.CA.revenue, 800);
    assert.strictEqual(r.TX.revenue, 200);
    assert.strictEqual(r.all.revenue, 1000);
    assert.strictEqual(r.CA.share, 80);
    assert.strictEqual(r.TX.share, 20);
    assert.strictEqual(r.none.orders, 0);
  });

  test("las órdenes sin estado van a su cubo y no entran en el reparto CA/TX", () => {
    const r = computeRevenueByState([wo("CA", 300), wo("TX", 100), wo(null, 100), wo("NV", 500)]);
    assert.strictEqual(r.none.orders, 2);
    assert.strictEqual(r.none.revenue, 600);
    assert.strictEqual(r.all.revenue, 1000);
    assert.strictEqual(r.CA.share, 30);
    assert.strictEqual(r.none.share, 60);
    assert.strictEqual(r.none.shareAssigned, 0);
    assert.strictEqual(r.assignedRevenue, 400);
    assert.strictEqual(r.CA.shareAssigned, 75);
    assert.strictEqual(r.TX.shareAssigned, 25);
    assert.ok(Math.abs(r.CA.revenue + r.TX.revenue + r.none.revenue - r.all.revenue) < 1e-9);
  });

  test("ignora lo no pagado y no divide por cero cuando no hay nada", () => {
    const r = computeRevenueByState([wo("CA", 500, false)]);
    assert.strictEqual(r.all.orders, 0);
    assert.strictEqual(r.CA.share, 0);
    assert.strictEqual(r.CA.shareAssigned, 0);
    assert.strictEqual(computeRevenueByState([]).all.revenue, 0);
  });
});
