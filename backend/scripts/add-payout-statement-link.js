// PASO 12: el comprobante de pago se puede enviar por link.
//
//   cd backend && node scripts/add-payout-statement-link.js --apply
//
// Un tecnico o un agente que cobra quiere ver de que sale su monto sin pedirle una captura a
// nadie. El link abre una pagina publica con el desglose y sus work orders, y desde ahi se
// imprime a PDF — mismo mecanismo que la vista de factura, sin dependencia nueva.
//
// Se sigue el patron que ya existe para el link movil del tecnico, y por la misma razon: esto
// muestra cuanto gana una persona, asi que es una credencial y no un enlace inocente.
//
//   - token aleatorio de 20 caracteres, no el id: un id correlativo deja adivinar los otros pagos
//   - public_access_log guarda cada apertura, para saber si un link se filtro
//   - se revoca regenerando, no expira: alguien puede necesitarlo dias despues, pero uno filtrado
//     tiene que poder matarse en un click
//   - el token no se crea solo; nace cuando alguien pide compartir el pago
require("dotenv").config();
const pool = require("../src/config/db");

const APPLY = process.argv.includes("--apply");

(async () => {
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    await c.query("ALTER TABLE payouts ADD COLUMN IF NOT EXISTS public_token TEXT");
    await c.query("ALTER TABLE payouts ADD COLUMN IF NOT EXISTS public_access_log JSONB NOT NULL DEFAULT '[]'::jsonb");
    // Unico y solo sobre los que tienen token: la busqueda es por token exacto, y un indice
    // parcial evita que los 791 sin token compitan por el mismo NULL.
    await c.query("CREATE UNIQUE INDEX IF NOT EXISTS payouts_public_token_idx ON payouts (public_token) WHERE public_token IS NOT NULL");

    const n = (await c.query("SELECT count(*)::int n FROM payouts WHERE public_token IS NOT NULL")).rows[0].n;
    console.log(APPLY ? "=== APLICANDO ===" : "=== DRY-RUN (termina en ROLLBACK) ===");
    console.log(`columnas listas. Lotes con link emitido hoy: ${n} (se emiten a pedido, no en masa).`);

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
