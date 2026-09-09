require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
// Pasa a la regla nueva de sales tax (solo partes) las cotizaciones cuyas órdenes siguen ABIERTAS y
// no tienen un centavo cobrado. Antonio, 9-sep-2026: "si pásalas".
//
// El 8-sep se congelaron las 4.733 cotizaciones existentes en tax_rule='subtotal' para que las
// órdenes ya cobradas no se movieran (add-tax-basis-columns.js). Ese motivo no aplica a un trabajo
// que todavía no se cobra: ahí sí se puede bajar el impuesto de verdad, porque nadie ha pagado nada
// que contradecir. El total de esas órdenes BAJA — es el efecto buscado.
//
// Se excluye cualquier orden con dinero encima (pago marcado, importe cobrado o paidAmount en la
// cotización) y las canceladas. Una cotización con VARIAS órdenes solo pasa si TODAS están abiertas
// y limpias: si una ya se cobró, la cotización se queda congelada.
//
// Después de cambiar la regla se llama al propio update() del store —no un UPDATE a mano— para que
// recalcule totales y sincronice la orden (total_sale y el snapshot de impuesto) por el mismo camino
// que usa la aplicación. Sin --apply solo enseña la tabla de lo que cambiaría.
const fs = require("fs");
const path = require("path");
const pool = require("../src/config/db");
const quotesStore = require("../src/store/quotes.store");
const workOrdersStore = require("../src/store/workorders.store");

const APPLY = process.argv.includes("--apply");
const f = (n) => Number(n || 0).toFixed(2);

const tieneDinero = (w) =>
  w.payment?.paid === true ||
  Number(w.payment?.amount || 0) > 0 ||
  (Array.isArray(w.paymentHistory) && w.paymentHistory.some((h) => Number(h?.amount || 0) > 0));

(async () => {
  const [quotes, wos] = await Promise.all([quotesStore.list(), workOrdersStore.list()]);
  const wosPorCotizacion = new Map();
  for (const w of wos) {
    if (w.active === false || !w.quoteId) continue;
    if (!wosPorCotizacion.has(w.quoteId)) wosPorCotizacion.set(w.quoteId, []);
    wosPorCotizacion.get(w.quoteId).push(w);
  }

  const candidatas = [];
  const excluidas = [];
  for (const q of quotes) {
    if (q.taxRule !== "subtotal") continue;
    const ordenes = wosPorCotizacion.get(q.id) || [];
    if (!ordenes.length) continue;
    const abiertas = ordenes.filter((w) => w.status !== "Cancelled");
    if (!abiertas.length) continue;
    const motivo =
      abiertas.some((w) => w.status === "Paid") ? "orden pagada"
      : abiertas.some(tieneDinero) ? "tiene dinero cobrado"
      : Number(q.paidAmount || 0) > 0 ? "paidAmount en la cotización"
      : null;
    if (motivo) {
      if (!abiertas.some((w) => w.status === "Paid")) excluidas.push({ cotizacion: q.quoteNo, ordenes: abiertas.map((w) => w.workOrderNo).join(", "), motivo });
      continue;
    }
    const antes = q.totals;
    candidatas.push({
      id: q.id,
      cotizacion: q.quoteNo,
      ordenes: abiertas.map((w) => w.workOrderNo).join(", "),
      estado: abiertas.map((w) => w.status).join(", "),
      taxAntes: Number(antes.taxAmount || 0),
      taxDespues: Number(antes.taxOnParts || 0),
      totalAntes: Number(antes.finalSalePrice || 0),
    });
  }

  console.log(APPLY ? "APLICANDO" : "SOLO PRUEBA (usa --apply para escribir)");
  console.log("Cotizaciones que pasan a regla 'parts':", candidatas.length);
  console.table(
    candidatas.map((c) => ({
      cotizacion: c.cotizacion, ordenes: c.ordenes, estado: c.estado,
      taxAntes: f(c.taxAntes), taxDespues: f(c.taxDespues), baja: f(c.taxAntes - c.taxDespues),
      finalSalePriceAntes: f(c.totalAntes), finalSalePriceDespues: f(c.totalAntes - (c.taxAntes - c.taxDespues)),
    }))
  );
  console.log("Baja total del impuesto:", f(candidatas.reduce((s, c) => s + c.taxAntes - c.taxDespues, 0)));
  if (excluidas.length) {
    console.log("\nAbiertas que NO se tocan por tener dinero encima:");
    console.table(excluidas);
  }
  if (!APPLY) { await pool.end(); return; }

  const respaldo = path.join(__dirname, `parts-tax-rule-open-orders-backup-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  fs.writeFileSync(respaldo, JSON.stringify(candidatas, null, 2));
  console.log("\nRespaldo:", respaldo);

  await pool.query(`UPDATE quotes SET tax_rule = 'parts' WHERE id = ANY($1::uuid[])`, [candidatas.map((c) => c.id)]);
  // update({}) no cambia ningún campo: solo dispara el recálculo de totales y la sincronización con
  // la orden, ya con la regla nueva leída de la base.
  let ok = 0;
  for (const c of candidatas) {
    await quotesStore.update(c.id, {});
    ok++;
  }
  console.log("Cotizaciones actualizadas y órdenes sincronizadas:", ok);
  await pool.end();
})().catch((e) => { console.error(e); process.exit(1); });
