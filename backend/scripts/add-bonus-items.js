// PASO 18: un bono puede ser varios bonos.
//
//   cd backend && node scripts/add-bonus-items.js          # dry-run, ROLLBACK
//   cd backend && node scripts/add-bonus-items.js --apply
//
// El campo unico de tipo se queda corto y Agent-0234 lo demuestra: sus $161.00 son cinco bonos de
// tipos distintos — CC COLLECTED $34, REVIEWS $20, ADMIN FEE $15, CC PROCESSED $42, ITEMIZED
// INVOICE $50 — y con un solo campo habria que elegir uno y perder cuatro.
//
// AppSheet lo modela como tabla hija ("Bonus or discount", con fecha, tipo, monto y nota por
// renglon). Esa tabla NO vino en el export: de los ocho CSV recibidos, ninguno la trae. Asi que
// esto crea la estructura y la deja lista; cuando el archivo aparezca, el import es un script corto.
//
// La invariante: cuando un lote tiene renglones, payouts.bonus ES su suma. Nunca se editan por
// separado, o el total del pago dejaria de cuadrar con lo que lo compone. Un lote sin renglones
// conserva su bonus tal cual, que es el caso de los 227 sin clasificar.
require("dotenv").config();
const pool = require("../src/config/db");

const APPLY = process.argv.includes("--apply");
const money = (n) => "$" + Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

(async () => {
  const c = await pool.connect();
  try {
    await c.query("BEGIN");

    await c.query(`CREATE TABLE IF NOT EXISTS payout_bonus_item (
      id BIGSERIAL PRIMARY KEY,
      payout_id INTEGER NOT NULL REFERENCES payouts(id) ON DELETE CASCADE,
      bonus_type TEXT,                       -- CC_COLLECTED, REVIEWS, ADMIN_FEE, ...
      amount NUMERIC(12,2) NOT NULL DEFAULT 0,
      note TEXT,
      item_date DATE,
      source TEXT,
      external_id TEXT UNIQUE,               -- id de AppSheet: hace idempotente el import futuro
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
    await c.query("CREATE INDEX IF NOT EXISTS pbi_payout_idx ON payout_bonus_item (payout_id)");
    await c.query("CREATE INDEX IF NOT EXISTS pbi_type_idx ON payout_bonus_item (bonus_type)");

    // NUMERIC(12,2) a proposito, al reves que las columnas de payouts: alli la falta de escala dejo
    // entrar 187.46000000000004. Aca Postgres redondea solo.

    // Los 3 lotes marcados ADJUSTMENT ya tienen tipo y motivo, asi que su renglon se puede crear
    // sin adivinar nada. Los 227 sin clasificar se quedan sin renglones a proposito: inventarles
    // uno de tipo desconocido no agrega informacion y ensucia el conteo de lo que falta.
    const r = await c.query(
      `INSERT INTO payout_bonus_item (payout_id, bonus_type, amount, note, item_date, source, external_id)
       SELECT id, bonus_type, bonus, bonus_reason, payment_date::date, 'migracion', 'payout:' || id
         FROM payouts
        WHERE active <> false AND bonus <> 0 AND bonus_type IS NOT NULL
       ON CONFLICT (external_id) DO NOTHING RETURNING 1`);

    const t = (await c.query(
      `SELECT count(*)::int lotes,
              count(*) FILTER (WHERE i.n > 0)::int con_renglones,
              round(SUM(o.bonus), 2) total
         FROM payouts o
         LEFT JOIN (SELECT payout_id, count(*)::int n FROM payout_bonus_item GROUP BY 1) i ON i.payout_id = o.id
        WHERE o.active <> false AND o.bonus <> 0`)).rows[0];

    // La invariante, comprobada: donde hay renglones, tienen que sumar el bono del lote.
    const rotos = (await c.query(
      `SELECT count(*)::int n FROM payouts o
         JOIN (SELECT payout_id, SUM(amount) s FROM payout_bonus_item GROUP BY 1) i ON i.payout_id = o.id
        WHERE abs(o.bonus - i.s) > 0.005`)).rows[0].n;

    console.log(APPLY ? "=== APLICANDO ===" : "=== DRY-RUN (termina en ROLLBACK) ===");
    console.log(`renglones creados: ${r.rowCount}`);
    console.log(`lotes con bono: ${t.lotes}, ${money(t.total)} — con renglones: ${t.con_renglones}`);
    console.log(`lotes donde los renglones no suman el bono: ${rotos}`);
    if (rotos) throw new Error("la invariante no se cumple");

    if (APPLY) { await c.query("COMMIT"); console.log("\nCOMMIT"); }
    else { await c.query("ROLLBACK"); console.log("\nROLLBACK: corre con --apply."); }
  } catch (e) {
    await c.query("ROLLBACK");
    console.error("ROLLBACK:", e.message);
    process.exitCode = 1;
  } finally {
    c.release();
    await pool.end();
  }
})().catch((e) => { console.error(e); process.exit(1); });
