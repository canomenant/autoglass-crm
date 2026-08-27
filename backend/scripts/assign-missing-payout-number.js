require("dotenv").config();
const pool = require("../src/config/db");

// Asigna número de pago al único payout que no lo tiene.
//
// Es el pago de $71.53 a Mygrant Hayward: la única fila de BD_PAYMENTDISTRIBUTOR.csv que venía SIN
// consecutivo — ni en AppSheet tuvo número — y el import lo respetó tal cual. Quedó en estado Paid
// con payment_number NULL, y eso no tiene salida en el flujo normal: el número lo pone approve(),
// que exige estado "Ready For Payment"; un pago ya pagado no pasa por ahí nunca. Mientras tanto el
// detalle lo titulaba "Draft — awaiting approval", que es el rótulo de "sin número" mintiendo sobre
// un pago cobrado hace meses.
//
// Usa exactamente la fórmula de approve() — count(numerados del tipo) + 1 — y deja la misma entrada
// de auditoría que habría dejado aprobar. Se niega a correr si hay más de un payout sin número o si
// el número calculado ya existe: este script es para ESTA anomalía, no una herramienta general.
//
// --apply para escribir; sin el flag solo simula.

const APPLY = process.argv.includes("--apply");
const PREFIX = { TECHNICIAN: "Tech", AGENT: "Ag", DISTRIBUTOR: "Dist" };
const pad = (n) => String(n).padStart(4, "0");

(async () => {
  const sinNumero = (await pool.query(
    "SELECT id, type, status, total_amount, payment_date FROM payouts WHERE active <> false AND payment_number IS NULL"
  )).rows;

  if (sinNumero.length !== 1) {
    console.error(`Esperaba exactamente 1 payout sin número; hay ${sinNumero.length}. No se toca nada.`);
    process.exit(1);
  }
  const p = sinNumero[0];
  console.log(`Único sin número: ${p.type} ${p.status} $${p.total_amount} [${p.payment_date}]`);

  const count = Number((await pool.query(
    "SELECT COUNT(*) AS c FROM payouts WHERE type = $1 AND payment_number IS NOT NULL", [p.type]
  )).rows[0].c);
  const numero = `${PREFIX[p.type]}-${pad(count + 1)}`;

  const ocupado = (await pool.query("SELECT 1 FROM payouts WHERE payment_number = $1", [numero])).rowCount > 0;
  if (ocupado) {
    console.error(`El número calculado ${numero} ya existe. No se toca nada.`);
    process.exit(1);
  }
  console.log(`Número a asignar (fórmula de approve): ${numero}`);

  if (!APPLY) {
    console.log("\nSimulación. Volver a lanzar con --apply para escribir.");
    await pool.end();
    return;
  }

  const audit = {
    user: "Antonio Cano",
    timestamp: new Date().toISOString(),
    action: "Payment number assigned (AppSheet import came without one)",
    oldValue: { paymentNumber: null },
    newValue: { paymentNumber: numero },
  };
  await pool.query(
    `UPDATE payouts SET payment_number = $2, audit_log = COALESCE(audit_log, '[]'::jsonb) || $3::jsonb, updated_at = now()
      WHERE id = $1`,
    [p.id, numero, JSON.stringify([audit])]
  );
  const v = (await pool.query("SELECT payment_number FROM payouts WHERE id = $1", [p.id])).rows[0];
  const resto = (await pool.query(
    "SELECT count(*)::int AS n FROM payouts WHERE active <> false AND payment_number IS NULL"
  )).rows[0].n;
  console.log(`Asignado: ${v.payment_number}. Payouts sin número que quedan: ${resto}.`);
  await pool.end();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
