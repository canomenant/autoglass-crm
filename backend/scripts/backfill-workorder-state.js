require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
// Asigna work_orders.state (CA/TX) a las órdenes que no lo tienen, para que el sales tax se
// declare en el estado correcto (Antonio, 8-sep-2026: "¿no podemos relacionar esas órdenes con la
// dirección?"). Solo toca filas con state NULL y guarda un respaldo con los ids tocados, así que
// deshacerlo es volver a poner NULL en esos ids.
//
// Pistas, de más a menos fuerte. Una orden se resuelve con el primer nivel que dé una respuesta
// sin contradicción:
//   1. Dirección y código postal: el texto de la dirección ("..., CA 92831"), el zip que trae la
//      dirección o la cotización (contra el catálogo zip_codes y contra los rangos postales de CA
//      90000–96199 / TX 75000–79999 y 885xx), y quotes.state. Si las pistas se contradicen, no se toca.
//   2. Técnico + tasa: técnicos con ≥5 órdenes que trabajan al 99%+ en un solo estado, siempre que
//      la tasa de la cotización no lo desmienta (una tasa > 8.25% no existe en Texas, así que es CA).
//   3. Solo tasa > 8.25% → CA.
//   4. Nombre de ciudad en la dirección (lista corta de ciudades conocidas de cada estado).
// Lo que no cae en ninguno queda en NULL y se lista al final para revisarlo a mano.
//
//   node scripts/backfill-workorder-state.js           → solo muestra qué haría
//   node scripts/backfill-workorder-state.js --apply   → escribe y deja el respaldo en scripts/
// Tras aplicar hay que reiniciar/redesplegar el backend: la lista de órdenes está en listCache.
const fs = require("fs");
const path = require("path");
const pool = require("../src/config/db");
const workOrdersStore = require("../src/store/workorders.store");
const quotesStore = require("../src/store/quotes.store");
const listCache = require("../src/lib/listCache");
const { TAX_STATES } = require("../src/lib/profitLossCalc");

const APPLY = process.argv.includes("--apply");

const CITIES = {
  CA: /\b(lake elsinore|lake elsnore|folsom|long beach|dana point|los angeles|san diego|anaheim|riverside|irvine|santa ana|fresno|sacramento|oakland|san jose|bakersfield|temecula|murrieta|corona|ontario|pomona|fullerton|garden grove|huntington beach|torrance|glendale|pasadena|oceanside|escondido|chula vista|el cajon|moreno valley|fontana|rancho cucamonga|san bernardino|victorville|palmdale|lancaster|santa clarita|burbank|downey|norwalk|whittier|compton|inglewood|carson|lakewood|costa mesa|newport beach|mission viejo|laguna|tustin|brea|placentia|yorba linda|chino|upland|redlands|hemet|perris|menifee|indio|palm springs|palm desert|la habra|buena park|cypress|stanton|westminster|fountain valley|seal beach)\b/i,
  TX: /\b(dfw|dwf airport|dallas|fort worth|ft worth|arlington|plano|irving|garland|frisco|mckinney|denton|richardson|carrollton|lewisville|grand prairie|mesquite|allen|flower mound|euless|bedford|hurst|grapevine|southlake|keller|mansfield|burleson|cedar hill|desoto|duncanville|lancaster tx|rockwall|wylie|rowlett|the colony|little elm|prosper|celina|kerrville|kerrvile|houston|austin|san antonio|el paso|waco|killeen|round rock|midland|odessa|lubbock|amarillo)\b/i,
};

function stateFromAddress(addr) {
  const a = String(addr || "");
  if (/\b(CA|California)\b/i.test(a) && !/\b(TX|Texas)\b/i.test(a)) return "CA";
  if (/\b(TX|Texas)\b/i.test(a) && !/\b(CA|California)\b/i.test(a)) return "TX";
  return "";
}
function stateFromZip(z) {
  const n = Number(String(z || "").match(/\b(\d{5})\b/)?.[1]);
  if (!n) return "";
  if (n >= 90000 && n <= 96199) return "CA";
  if ((n >= 75000 && n <= 79999) || (n >= 88500 && n <= 88599)) return "TX";
  return "";
}
function zipFromAddress(addr) {
  const m = String(addr || "").match(/\b(\d{5})(?:-\d{4})?\b/g);
  return m ? m[m.length - 1] : "";
}
function stateFromCity(addr) {
  const ca = CITIES.CA.test(addr || ""), tx = CITIES.TX.test(addr || "");
  return ca && !tx ? "CA" : tx && !ca ? "TX" : "";
}

(async () => {
  const wos = await workOrdersStore.list();
  const quotes = await quotesStore.list();
  const qById = new Map(quotes.map((q) => [q.id, q]));
  const zips = new Map((await pool.query("SELECT zipcode, state FROM zip_codes")).rows.map((r) => [String(r.zipcode).trim(), r.state]));

  const techState = {};
  for (const w of wos) if (TAX_STATES.includes(w.state) && w.tech) { techState[w.tech] = techState[w.tech] || { CA: 0, TX: 0 }; techState[w.tech][w.state]++; }

  const plan = [];
  for (const w of wos.filter((x) => !TAX_STATES.includes(x.state))) {
    const q = w.quoteId ? qById.get(w.quoteId) : null;
    const zipWo = zipFromAddress(w.address);
    const strong = [...new Set([stateFromAddress(w.address), zips.get(zipWo) || "", stateFromZip(zipWo), zips.get(String(q?.zipCode || "").trim()) || "", stateFromZip(q?.zipCode), TAX_STATES.includes(q?.state) ? q.state : ""].filter(Boolean))];
    const rate = Number(q?.taxRate || 0);
    const rateVote = rate > 8.25 ? "CA" : "";
    const ts = techState[w.tech];
    const total = ts ? ts.CA + ts.TX : 0;
    const techVote = ts && total >= 5 && Math.max(ts.CA, ts.TX) / total >= 0.99 ? (ts.CA > ts.TX ? "CA" : "TX") : "";
    const cityVote = stateFromCity(w.address);

    let state = "", tier = "", basis = "";
    if (strong.length === 1) { state = strong[0]; tier = "1-direccion/zip"; basis = `zip/dirección`; }
    else if (strong.length > 1) { tier = "CONFLICTO"; basis = strong.join(" vs "); }
    else if (techVote && (!rateVote || rateVote === techVote)) { state = techVote; tier = "2-tecnico+tasa"; basis = `${w.tech} ${ts.CA} CA / ${ts.TX} TX${rate ? `, tasa ${rate}%` : ""}`; }
    else if (rateVote) { state = rateVote; tier = "3-tasa"; basis = `tasa ${rate}% > 8.25%`; }
    else if (cityVote) { state = cityVote; tier = "4-ciudad"; basis = String(w.address || "").slice(0, 50); }
    else { tier = "SIN RESOLVER"; basis = `tech=${w.tech || "-"} tasa=${rate} dir="${String(w.address || "").slice(0, 40)}"`; }
    plan.push({ id: w.id, wo: w.workOrderNo, date: (w.appointmentDate || "").slice(0, 10), paid: !!w.payment?.paid, tax: Number(q?.totals?.taxAmount || 0), state, tier, basis });
  }

  const byTier = {};
  for (const p of plan) { const k = `${p.tier}${p.state ? " → " + p.state : ""}`; byTier[k] = (byTier[k] || 0) + 1; }
  console.log(APPLY ? "APLICANDO" : "SOLO PRUEBA (usa --apply para escribir)", "| órdenes sin estado:", plan.length);
  console.table(byTier);
  console.log("\nNivel 2–4 (inferidas, revisar):");
  console.table(plan.filter((p) => p.state && p.tier !== "1-direccion/zip").map(({ id, ...p }) => p));
  console.log("\nQuedan sin estado:");
  console.table(plan.filter((p) => !p.state).map(({ id, ...p }) => p));

  const toWrite = plan.filter((p) => p.state);
  if (!APPLY) { await pool.end(); return; }

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backup = path.join(__dirname, `workorder-state-backfill-${stamp}.json`);
  fs.writeFileSync(backup, JSON.stringify(toWrite, null, 2));
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    let n = 0;
    for (const p of toWrite) {
      const r = await client.query("UPDATE work_orders SET state = $1 WHERE id = $2 AND state IS NULL", [p.state, p.id]);
      n += r.rowCount;
    }
    await client.query("COMMIT");
    listCache.invalidate("workorders");
    console.log(`\nActualizadas ${n} órdenes. Respaldo: ${backup}`);
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
  await pool.end();
})().catch((e) => { console.error(e.stack); process.exit(1); });
