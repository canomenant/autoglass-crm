require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const pool = require("../src/config/db");

// Trabajo entregado que ya se dio por perdido (Antonio, 9-sep-2026). Hasta hoy solo había dos
// estados posibles para una orden sin cobrar: "pendiente de cobro" para siempre, o cancelarla — y
// cancelar miente, porque el vidrio se instaló y se le pagó al distribuidor, al técnico y al agente.
//
// El catálogo "Payment Status" tiene una opción "Not Paid" que nunca estuvo conectada a las órdenes;
// esto es la marca de verdad, con su fecha, su motivo y quién la puso, para poder separar lo
// incobrable de lo que todavía se está cobrando.
//
// No hay columna de importe: lo que se perdió es total_sale, que ya está en la orden. El P&L tampoco
// necesita un renglón de gasto — el costo del trabajo (vidrio, mano de obra, comisión) ya está
// contado y el ingreso es cero, así que la pérdida aparece sola. La marca es para poder listarlas.
async function main() {
  await pool.query(`ALTER TABLE work_orders
    ADD COLUMN IF NOT EXISTS uncollectible_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS uncollectible_reason TEXT,
    ADD COLUMN IF NOT EXISTS uncollectible_by TEXT,
    ADD COLUMN IF NOT EXISTS uncollectible_note TEXT`);
  console.log("work_orders.uncollectible_at / _reason / _by / _note listas.");

  const r = await pool.query("SELECT COUNT(*)::int n FROM work_orders WHERE uncollectible_at IS NOT NULL");
  console.log("Órdenes marcadas como incobrables hoy:", r.rows[0].n);
  await pool.end();
}

main().catch((e) => {
  console.error("add-workorder-uncollectible-columns failed:", e.message);
  process.exit(1);
});
