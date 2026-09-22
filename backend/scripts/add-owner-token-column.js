require("dotenv").config();
const pool = require("../src/config/db");

// El comprobante del SOCIO va por su propio link.
//
// El comprobante de hoy lo abre el técnico: si se le agregaran las columnas de costo de parte,
// comisión del agente y ganancia —que es lo que el socio pidió ver (Antonio, 21-sep-2026)— el
// técnico vería los márgenes de la empresa con el mismo link. Por eso son dos documentos y dos
// tokens: `public_token` sigue siendo el del técnico, tal cual está hoy, y `owner_token` es la
// copia del dueño. Uno no lleva al otro.
async function main() {
  await pool.query(`ALTER TABLE payouts ADD COLUMN IF NOT EXISTS owner_token TEXT`);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS payouts_owner_token_idx ON payouts (owner_token) WHERE owner_token IS NOT NULL`);
  await pool.query(`ALTER TABLE payouts ADD COLUMN IF NOT EXISTS owner_access_log JSONB NOT NULL DEFAULT '[]'::jsonb`);

  const r = await pool.query(
    `SELECT column_name, data_type FROM information_schema.columns
      WHERE table_name = 'payouts' AND column_name IN ('owner_token', 'owner_access_log') ORDER BY 1`
  );
  console.table(r.rows);
  const n = await pool.query(`SELECT count(*)::int AS con_token FROM payouts WHERE owner_token IS NOT NULL`);
  console.log("lotes con link del socio emitido:", n.rows[0].con_token);
  await pool.end();
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
