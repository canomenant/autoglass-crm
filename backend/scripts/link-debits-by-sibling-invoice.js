require("dotenv").config();
const pool = require("../src/config/db");
const XLSX = require("xlsx");

// Enlaza notas de débito heredadas a su pago de distribuidor usando EVIDENCIA del export: la
// factura de la nota (Order Number) aparece también en líneas hermanas CON work order, y esas
// líneas sí dicen en qué pago se pagó la factura (ID_PAYMENTDISTRIBUTOR). Si toda la factura se
// pagó en un lote, la parte del técnico facturada en ella se pagó ahí mismo.
//
// El método se auto-validó antes de escribir nada: reproduce los enlaces que Antonio capturó a
// mano (S67099893→Dist-0044, S67300470→Dist-0049, S67457701→Dist-0056, S67598971→Dist-0057).
//
// Reglas:
//   - Solo facturas cuyo pago hermano es ÚNICO (con dos pagos posibles no se adivina).
//   - Guardia del hueco: la nota entra solo si cabe en el débito heredado aún sin explicar del
//     pago (debit_notes_total − débitos ya enlazados). Nunca se sobregira un lote.
//   - Solo notas activas sin payout_id; las capturadas a mano nunca se tocan.
//
// --apply para escribir; sin el flag solo simula.

const APPLY = process.argv.includes("--apply");
const cents = (n) => Math.round(Number(n || 0) * 100);
const EXCEL = "C:/Users/Antonio Cano/OneDrive/Documents/Bases de Datos Completas.xlsx";

(async () => {
  const wb = XLSX.readFile(EXCEL);
  const sheet = (n) => XLSX.utils.sheet_to_json(wb.Sheets[n], { defval: null });
  const det = sheet("BD_WORKORDER_DETAIL");
  const pd = sheet("BD_PAYMENTDISTRIBUTOR");
  const pdById = Object.fromEntries(pd.map((r) => [r.ID, r["CONSECUTIVE DISTRIBUTOR"]]));

  const porFactura = {};
  det.forEach((l) => {
    const inv = String(l["Order Number"] || "").trim();
    const pago = l["ID_PAYMENTDISTRIBUTOR"] ? pdById[l["ID_PAYMENTDISTRIBUTOR"]] : null;
    if (!inv || !pago) return;
    (porFactura[inv] = porFactura[inv] || new Set()).add(pago);
  });
  const pagoDe = (inv) => {
    const s = porFactura[inv] || porFactura[inv.replace(/-\d+$/, "")];
    return s && s.size === 1 ? [...s][0] : null;
  };

  // Candidatas vivas: heredadas, activas, sin pago, con factura.
  const notas = (await pool.query(`
    SELECT id, note_number, amount, invoice_number
      FROM credit_debit_note
     WHERE kind = 'DEBIT' AND source = 'appsheet' AND active AND status NOT IN ('Void','Cancelled')
       AND payout_id IS NULL AND btrim(COALESCE(invoice_number, '')) <> ''
     ORDER BY note_number`)).rows;

  // Hueco vivo por pago.
  const pagos = (await pool.query(`
    SELECT po.id, po.payment_number, po.debit_notes_total,
           COALESCE((SELECT SUM(n.amount) FROM credit_debit_note n
             WHERE n.payout_id = po.id AND n.kind = 'DEBIT' AND n.active
               AND n.status NOT IN ('Void','Cancelled')), 0) AS ya
      FROM payouts po WHERE po.type = 'DISTRIBUTOR' AND po.active <> false`)).rows;
  const porNumero = Object.fromEntries(pagos.map((p) => [p.payment_number, { id: p.id, gap: cents(p.debit_notes_total) - cents(p.ya) }]));

  const plan = [];
  const fuera = [];
  for (const n of notas) {
    const destino = pagoDe(String(n.invoice_number).trim());
    if (!destino) continue;
    const p = porNumero[destino];
    if (!p) { fuera.push([n.note_number, destino, "el pago no existe en la web"]); continue; }
    if (cents(n.amount) > p.gap) { fuera.push([n.note_number, destino, `no cabe: hueco $${(p.gap / 100).toFixed(2)} < nota $${n.amount}`]); continue; }
    p.gap -= cents(n.amount);
    plan.push({ nota: n, destino, payoutId: p.id });
  }

  console.log(`Enlaces con evidencia de factura: ${plan.length} notas ($${(plan.reduce((s, x) => s + cents(x.nota.amount), 0) / 100).toFixed(2)}).`);
  plan.forEach((x) => console.log(`  ${x.nota.note_number} $${x.nota.amount} (inv ${x.nota.invoice_number}) -> ${x.destino}`));
  if (fuera.length) {
    console.log("\nCon evidencia pero NO enlazadas (revisar):");
    fuera.forEach((f) => console.log("  " + f.join(" | ")));
  }

  if (!APPLY) {
    console.log("\nSimulación. Volver a lanzar con --apply para escribir.");
    await pool.end();
    return;
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const x of plan) {
      await client.query(
        `UPDATE credit_debit_note SET payout_id = $2, status = 'Applied', updated_at = now(),
                audit_log = COALESCE(audit_log, '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
                  'timestamp', now(), 'user', 'System',
                  'action', 'Linked to distributor payment ' || $3 || ' by invoice evidence (sibling lines in AppSheet export)'))
          WHERE id = $1 AND payout_id IS NULL AND active`, [x.nota.id, x.payoutId, x.destino]);
    }
    // Candado: ningún pago tocado puede quedar con débitos por ENCIMA de su total heredado.
    const check = (await client.query(`
      SELECT po.payment_number, po.debit_notes_total, COALESCE(SUM(n.amount), 0) AS notas
        FROM payouts po JOIN credit_debit_note n ON n.payout_id = po.id
       WHERE n.kind = 'DEBIT' AND n.active AND n.status NOT IN ('Void','Cancelled')
         AND po.id = ANY($1)
       GROUP BY po.payment_number, po.debit_notes_total`, [[...new Set(plan.map((x) => x.payoutId))]])).rows;
    const malos = check.filter((l) => cents(l.notas) > cents(l.debit_notes_total));
    if (malos.length) {
      malos.forEach((l) => console.error(`  SOBREGIRO ${l.payment_number}: notas $${Number(l.notas).toFixed(2)} > total $${Number(l.debit_notes_total).toFixed(2)}`));
      throw new Error("un lote quedaría sobregirado — ROLLBACK");
    }
    await client.query("COMMIT");
    console.log(`\nEnlazadas: ${plan.length}. Verificación: ningún lote sobregirado (${check.length} revisados).`);
  } catch (e) {
    try { await client.query("ROLLBACK"); } catch {}
    throw e;
  } finally {
    client.release();
  }
  await pool.end();
})().catch((e) => {
  console.error("FALLA:", e.message);
  process.exit(1);
});
