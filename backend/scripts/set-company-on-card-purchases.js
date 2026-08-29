// Le pone `company` (proveedor legible) a los 82 lotes del import de compras de tarjeta
// (Dist-0255..0336), que subieron sin nada en la columna Distributor del reporte (Antonio,
// 29-ago-2026: "veo que subieron sin distribuidor").
//
// company es el PROVEEDOR del estado de cuenta, no la bodega: Mygrant/Pilkington/PGW quedaron
// abiertos a propósito y la bodega la dirán las obligaciones al vincular. La lista de pagos cae a
// company solo mientras el lote no tenga obligaciones (payments.store list()).
//
// Uso: node scripts/set-company-on-card-purchases.js [--dry-run]

require("dotenv").config();
const pool = require("../src/config/db");

const DRY = process.argv.includes("--dry-run");

// Del comercio del estado de cuenta (guardado en la nota) al nombre corto que se muestra.
const PROVEEDOR = [
  [/MYGRANT/i, "Mygrant #011"],
  [/PILKINGTON/i, "Pilkington"],
  [/PGW/i, "PGW"],
  [/IGC SANTA ANA/i, "IGC Santa Ana"],
  [/IGC HOUSTON/i, "IGC Houston"],
  [/IMPORT GLASS/i, "Import Glass"],
  [/AFFORDABLE/i, "Affordable"],
  [/VITRO/i, "Vitro"],
  [/VOLKSWAGEN/i, "Volkswagen"],
];

(async () => {
  const lotes = (
    await pool.query(
      `SELECT id, payment_number, notes FROM payouts
        WHERE type='DISTRIBUTOR' AND is_adhoc AND notes LIKE 'Compra tarjeta — %WOs por vincular%'
          AND (company IS NULL OR btrim(company) = '')
        ORDER BY payment_number`)
  ).rows;
  console.log(`Lotes sin company: ${lotes.length}`);

  const porNombre = {};
  for (const lote of lotes) {
    const merchant = lote.notes.replace(/^Compra tarjeta — /, "").replace(/ \| WOs por vincular.*$/, "");
    const regla = PROVEEDOR.find(([re]) => re.test(merchant));
    if (!regla) throw new Error(`Sin mapeo para ${lote.payment_number}: "${merchant}"`);
    const nombre = regla[1];
    porNombre[nombre] = (porNombre[nombre] || 0) + 1;
    if (!DRY) {
      await pool.query(`UPDATE payouts SET company = $2, updated_at = now() WHERE id = $1`, [lote.id, nombre]);
    }
  }
  console.log(porNombre);
  console.log(DRY ? "--dry-run: no se escribió nada." : "Aplicado.");
  await pool.end();
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
