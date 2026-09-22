require("dotenv").config();
const fs = require("fs");
const path = require("path");
const pool = require("../src/config/db");
const customersStore = require("../src/store/customers.store");

// Los clientes que se capturaron a mano en una cotización y nunca llegaron a la lista de clientes.
//
// Hasta el 21-sep-2026 la ficha SÓLO nacía cuando el cliente llenaba el link de intake; desde el
// formulario de la oficina el dato se quedaba dentro de quotes.new_customer. Resultado: 227
// cotizaciones con cliente capturado y sin ficha, o sea 219 personas que no aparecían en
// "Existing Customer" y había que reteclear en cada trabajo (Antonio, Wo-4814 / Thomas Martinez).
//
// El código ya está arreglado (syncCapturedCustomer en quotes.store) — esto rescata lo viejo.
//
// Sin --apply sólo simula. Con --apply crea las fichas, liga las cotizaciones y sus órdenes, y
// deja un respaldo JSON de todo lo que tocó.
const APLICAR = process.argv.includes("--apply");

const soloDigitos = (v) => String(v || "").replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "");
const limpio = (v) => String(v || "").trim();

async function main() {
  const { rows } = await pool.query(
    `SELECT id, quote_no, customer_name, new_customer, zip_code, created_at,
            vehicle_year, vehicle_make, vehicle_model, vehicle_body_type, vehicle_vin
       FROM quotes
      WHERE active <> false AND customer_id IS NULL
        AND btrim(coalesce(new_customer->>'firstName','') || coalesce(new_customer->>'lastName','')) <> ''
      ORDER BY created_at`
  );
  console.log(`Cotizaciones con cliente capturado y sin ficha: ${rows.length}`);

  // Las fichas que ya existen, por teléfono: si alguien ya está en la cartera se reusa, no se
  // crea una segunda.
  const existentes = await customersStore.list();
  const porTelefono = new Map();
  for (const c of existentes) {
    const t = soloDigitos(c.phone);
    if (t.length === 10 && !porTelefono.has(t)) porTelefono.set(t, c);
  }

  // Una persona = un teléfono. Sin teléfono, el nombre completo en minúsculas. Así dos
  // cotizaciones del mismo cliente comparten ficha en vez de generar dos.
  const personas = new Map();
  for (const q of rows) {
    const nc = q.new_customer || {};
    const tel = soloDigitos(nc.phone);
    const nombre = `${limpio(nc.firstName)} ${limpio(nc.lastName)}`.trim();
    const clave = tel.length === 10 ? `tel:${tel}` : `nom:${nombre.toLowerCase()}`;
    if (!personas.has(clave)) personas.set(clave, { clave, tel, nombre, quotes: [], ultima: null });
    const p = personas.get(clave);
    p.quotes.push({ id: q.id, quoteNo: q.quote_no });
    // La cotización más reciente manda: es el dato más fresco de esa persona.
    p.ultima = {
      nc,
      vehicle: { year: q.vehicle_year || "", make: q.vehicle_make || "", model: q.vehicle_model || "", bodyType: q.vehicle_body_type || "", vin: q.vehicle_vin || "", plate: "" },
      zipCode: q.zip_code,
      quoteNo: q.quote_no,
    };
  }

  const aCrear = [];
  const aLigar = [];
  for (const p of personas.values()) {
    const ya = p.tel.length === 10 ? porTelefono.get(p.tel) : null;
    if (ya) aLigar.push({ ...p, customerId: ya.id, nombreFicha: ya.name });
    else aCrear.push(p);
  }

  console.log(`  personas distintas: ${personas.size}`);
  console.log(`  ya tienen ficha (sólo se liga): ${aLigar.length}`);
  console.log(`  fichas nuevas por crear: ${aCrear.length}`);
  console.log("\nMuestra de lo que se va a crear:");
  aCrear.slice(0, 8).forEach((p) => console.log(`  ${p.nombre.padEnd(28)} ${p.tel || "(sin tel)"}   ${p.quotes.length} cotización(es)`));
  const variasQuotes = [...personas.values()].filter((p) => p.quotes.length > 1);
  if (variasQuotes.length) {
    console.log(`\nPersonas con más de una cotización (una sola ficha para todas): ${variasQuotes.length}`);
    variasQuotes.slice(0, 8).forEach((p) => console.log(`  ${p.nombre.padEnd(28)} ${p.quotes.map((q) => q.quoteNo).join(", ")}`));
  }

  if (!APLICAR) {
    console.log("\n(simulación — nada se escribió. Corre con --apply para aplicarlo)");
    await pool.end();
    return;
  }

  const respaldo = { fecha: new Date().toISOString(), creados: [], ligados: [] };

  for (const p of [...aCrear, ...aLigar]) {
    const nc = p.ultima.nc;
    let customerId = p.customerId;

    if (!customerId) {
      const customer = await customersStore.create({
        firstName: limpio(nc.firstName),
        lastName: limpio(nc.lastName),
        phone: limpio(nc.phone),
        phoneAlt: limpio(nc.phoneAlt),
        email: limpio(nc.email),
        address: limpio(nc.address),
        addressType: limpio(nc.addressType),
        unitNumber: limpio(nc.unitNumber),
        city: limpio(nc.city),
        state: limpio(nc.state),
        zipCode: limpio(nc.zipCode) || limpio(p.ultima.zipCode),
        vehicle: p.ultima.vehicle || {},
        createdBy: "Rescate de clientes 21-sep-2026",
      });
      customerId = customer.id;
      respaldo.creados.push({ customerId, nombre: customer.name, tel: customer.phone, quotes: p.quotes.map((q) => q.quoteNo) });
    } else {
      respaldo.ligados.push({ customerId, nombre: p.nombreFicha, quotes: p.quotes.map((q) => q.quoteNo) });
    }

    const ids = p.quotes.map((q) => q.id);
    await pool.query("UPDATE quotes SET customer_id = $1 WHERE id = ANY($2) AND customer_id IS NULL", [customerId, ids]);
    // La orden hereda la liga: la pantalla de clientes y los filtros por cliente la usan.
    await pool.query(
      "UPDATE work_orders SET customer_id = $1 WHERE quote_id = ANY($2) AND active <> false AND customer_id IS NULL",
      [customerId, ids]
    );
  }

  const archivo = path.join(__dirname, `rescate-clientes-${Date.now()}.json`);
  fs.writeFileSync(archivo, JSON.stringify(respaldo, null, 1));
  console.log(`\nFichas creadas: ${respaldo.creados.length} · ligadas a una existente: ${respaldo.ligados.length}`);
  console.log(`Respaldo: ${archivo}`);

  const q = await pool.query(
    `SELECT count(*)::int AS n FROM quotes WHERE active <> false AND customer_id IS NULL
       AND btrim(coalesce(new_customer->>'firstName','') || coalesce(new_customer->>'lastName','')) <> ''`
  );
  console.log(`Quedan sin ficha: ${q.rows[0].n}`);
  await pool.end();
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
