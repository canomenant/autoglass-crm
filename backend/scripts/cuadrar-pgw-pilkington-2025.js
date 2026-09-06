require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
// PGW y Pilkington 2025: los ajustes heredados de AppSheet se vuelven notas de débito reales, una por
// pieza, en el pago que las cobró. Las compras sin orden (payable huérfanas "pendiente") son esas
// piezas: se convierten en nota y se borran. Las notas quedan abiertas para que Antonio decida
// pérdida o cargo a técnico. Dist-0133 y Dist-0174 reciben una nota por la diferencia con la tarjeta.
//   node scripts/cuadrar-pgw-pilkington-2025.js          -> reporte
//   node scripts/cuadrar-pgw-pilkington-2025.js --apply  -> escribe
const fs = require("fs");
const pool = require("../src/config/db");
const notes = require("../src/store/notes.store");
const APPLY = process.argv.includes("--apply");
const ACTOR = "Cuadre PGW/Pilkington 2025 (2026-09-06)";
const money = (n) => Math.round(Number(n || 0) * 100) / 100;
const fmt = (n) => money(n).toFixed(2);
// lote -> compras sin orden que su débito heredado representa (id de payable huérfana)
const HUERFANAS = { "Dist-0011": [7160, 7163, 7182, 7243, 7249, 7288, 7380], "Dist-0045": [7276], "Dist-0189": [7350], "Dist-0196": [7364] };
const DIFERENCIAS = {
  "Dist-0133": { monto: 127.14, entidad: "PGW Sacramento", texto: "Cargo PGW del 30-sep-2025 $336.99 vs la única orden del pago (Wo-1642 $209.85)" },
  "Dist-0174": { monto: 69.92, entidad: "Pilkington Sacramento", texto: "Cargo Pilkington del 28-nov-2025 $69.92 sin orden que lo respalde (Wo-1847 se pagó el 8-sep en Dist-0117)" },
};
(async () => {
  const plan = [];
  for (const [pn, ids] of Object.entries(HUERFANAS)) {
    const L = (await pool.query("SELECT id, payment_number pn, payment_date::text d, total_amount::float t, subtotal::float s, debit_notes_total::float dn, credit_notes_total::float cn, legacy_adjustments leg FROM payouts WHERE payment_number=$1", [pn])).rows[0];
    const h = (await pool.query("SELECT id, party, amount::float a, part_number part, part_description d, status, payout_id, work_order_no FROM payable WHERE id = ANY($1)", [ids])).rows;
    const suma = money(h.reduce((s, x) => s + x.a, 0));
    const ok = h.length === ids.length && h.every((x) => !x.payout_id && !x.work_order_no) && Math.abs(suma - L.dn) < 0.005 && Math.abs(L.s + L.dn - L.cn - L.t) < 0.005;
    console.log(`${pn} ${L.d} pagado $${fmt(L.t)} = órdenes $${fmt(L.s)} + débito heredado $${fmt(L.dn)} | compras sin orden: ${h.length} por $${fmt(suma)} ${ok ? "COINCIDE" : "NO COINCIDE"}`);
    for (const x of h) console.log(`   ${x.party} ${x.part} $${fmt(x.a)} | ${(x.d || "").slice(0, 60)}`);
    if (ok) plan.push({ L, h });
  }
  for (const [pn, c] of Object.entries(DIFERENCIAS)) {
    const L = (await pool.query("SELECT id, payment_number pn, payment_date::text d, total_amount::float t, subtotal::float s, debit_notes_total::float dn, credit_notes_total::float cn, (SELECT COALESCE(sum(amount),0)::float FROM payable WHERE payout_id=payouts.id) ob FROM payouts WHERE payment_number=$1", [pn])).rows[0];
    const ok = Math.abs(L.ob + c.monto - L.t) < 0.005;
    console.log(`${pn} ${L.d} pagado $${fmt(L.t)} = órdenes $${fmt(L.ob)} + diferencia $${fmt(c.monto)} ${ok ? "CUADRA" : "NO CUADRA"}`);
    if (ok) plan.push({ L, dif: c });
  }
  if (!APPLY) { await pool.end(); return; }
  fs.writeFileSync(`backups/pgw-pilkington-notas-respaldo-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify({
    payouts: (await pool.query("SELECT * FROM payouts WHERE id = ANY($1)", [plan.map((p) => p.L.id)])).rows,
    payable: (await pool.query("SELECT * FROM payable WHERE id = ANY($1)", [Object.values(HUERFANAS).flat()])).rows,
  }, null, 1));
  for (const p of plan) {
    const { L } = p;
    if (p.h) {
      await pool.query("UPDATE payouts SET legacy_adjustments=true, updated_at=now(), updated_by=$2 WHERE id=$1", [L.id, ACTOR]);
      for (const x of p.h) {
        const n = await notes.create("DEBIT", {
          entityType: "DISTRIBUTOR", entityName: x.party.trim(), relatedPaymentId: L.id, amount: x.a, reason: "Part not installed",
          partNumber: x.part || "", invoiceNumber: "", issueDate: L.d, partDescription: (x.d || "").slice(0, 200),
          description: `Compra de ${x.party.trim()} pagada en ${L.pn} sin orden que la instale (venía de AppSheet como ajuste heredado; ${ACTOR})`,
        }, ACTOR);
        await pool.query("DELETE FROM payable WHERE id=$1 AND payout_id IS NULL AND work_order_no IS NULL", [x.id]);
        console.log(`  ${L.pn}: ${n.noteNumber} ${x.part} $${fmt(x.a)} (huérfana #${x.id} borrada)`);
      }
    } else {
      await pool.query("UPDATE payouts SET subtotal=$2, base_amount=$2, debit_notes_total=$3, legacy_adjustments=true, updated_at=now(), updated_by=$4 WHERE id=$1", [L.id, L.ob, p.dif.monto, ACTOR]);
      const n = await notes.create("DEBIT", {
        entityType: "DISTRIBUTOR", entityName: p.dif.entidad, relatedPaymentId: L.id, amount: p.dif.monto, reason: "Part not installed",
        partNumber: "Diferencia con la tarjeta", invoiceNumber: "", issueDate: L.d, description: `${p.dif.texto} (${ACTOR})`,
      }, ACTOR);
      console.log(`  ${L.pn}: ${n.noteNumber} diferencia $${fmt(p.dif.monto)}`);
    }
    await pool.query("UPDATE payouts SET notes=COALESCE(notes,'')||$2, updated_at=now() WHERE id=$1", [L.id, ` | ${ACTOR}: ajuste heredado desglosado en notas de débito reales.`]);
    const v = (await pool.query("SELECT legacy_adjustments leg, total_amount::float t, subtotal::float s, debit_notes_total::float dn, credit_notes_total::float cn, (SELECT COALESCE(sum(amount),0)::float FROM payable WHERE payout_id=$1) ob FROM payouts WHERE id=$1", [L.id])).rows[0];
    console.log(`  ${L.pn}: órdenes $${fmt(v.ob)} + débito $${fmt(v.dn)} − crédito $${fmt(v.cn)} = $${fmt(v.ob + v.dn - v.cn)} vs pagado $${fmt(v.t)} ${!v.leg && Math.abs(v.ob - v.s) < 0.005 && Math.abs(v.ob + v.dn - v.cn - v.t) < 0.005 ? "OK" : "REVISAR"}`);
  }
  // verificación PGW / Pilkington / Dealer 2025
  const v = (await pool.query(`SELECT o.payment_number pn, o.total_amount::float t, o.subtotal::float s, o.debit_notes_total::float dn, o.credit_notes_total::float cn, o.legacy_adjustments leg,
      (SELECT COALESCE(sum(amount),0)::float FROM payable WHERE payout_id=o.id) ob,
      (SELECT COALESCE(sum(amount),0)::float FROM credit_debit_note n WHERE n.payout_id=o.id AND n.active AND n.status NOT IN ('Void','Cancelled') AND n.kind='DEBIT') ndn,
      (SELECT COALESCE(sum(amount),0)::float FROM credit_debit_note n WHERE n.payout_id=o.id AND n.active AND n.status NOT IN ('Void','Cancelled') AND n.kind='CREDIT') ncn
    FROM payouts o WHERE o.type='DISTRIBUTOR' AND o.active<>false AND o.payment_date>='2025-01-01' AND o.payment_date<'2026-01-01'
      AND (EXISTS (SELECT 1 FROM payable p WHERE p.payout_id=o.id AND (p.party ILIKE 'Pgw%' OR p.party ILIKE 'Pilk%' OR p.party ILIKE 'Dealer%')) OR o.payment_number IN ('Dist-0045','Dist-0174','Dist-0189','Dist-0196')) ORDER BY o.payment_date`)).rows;
  let ok = 0; const T = { t: 0, ob: 0, dn: 0, cn: 0 };
  for (const x of v) {
    T.t += x.t; T.ob += x.ob; T.dn += x.dn; T.cn += x.cn;
    if (Math.abs(x.s + x.dn - x.cn - x.t) < 0.005 && Math.abs(x.ob - x.s) < 0.005 && !x.leg && Math.abs(x.ndn - x.dn) < 0.005 && Math.abs(x.ncn - x.cn) < 0.005) ok++; else console.log("  REVISAR", x.pn, JSON.stringify(x));
  }
  console.log(`\nPGW/Pilkington/Dealer 2025: ${ok} de ${v.length} lotes cierran con notas reales | pagado $${fmt(T.t)} = órdenes $${fmt(T.ob)} + débito $${fmt(T.dn)} − crédito $${fmt(T.cn)} | dif $${fmt(T.t - (T.ob + T.dn - T.cn))}`);
  await pool.end();
})().catch(async (e) => { console.error(e.stack); try { await pool.end(); } catch {} process.exit(1); });
