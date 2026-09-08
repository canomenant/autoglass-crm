require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
// Antonio Cano, socio (7-sep-2026): balance a favor que viene de 2024 ($62,439.86) y los cheques /
// Zelle con los que se le ha ido pagando la comisión desde enero 2025. El balance entra como una
// distribución con fecha 31-dic-2024 (cuenta en el saldo acumulado, NO en el P&L 2025); los pagos
// van al libro de pagos al socio.
const crypto = require("crypto");
const pool = require("../src/config/db");
const pp = require("../src/store/partnerPayments.store");
const PAGOS = [
  ["2025-01-14", 7500, "Check", "CK 565"], ["2025-02-15", 7500, "Check", "CK 566"], ["2025-03-15", 7500, "Check", "CK 569"],
  ["2025-04-15", 7500, "Check", "CK 570"], ["2025-05-15", 7500, "Check", "CK 519"], ["2025-06-15", 7500, "Check", "CK 446"],
  ["2025-07-16", 7500, "Check", "CK 447"], ["2025-08-15", 7500, "Check", "CK 567"], ["2025-09-15", 7500, "Check", "CK 568"],
  ["2025-10-15", 7500, "Check", "CK 451"], ["2025-11-15", 7500, "Check", "CK 452"], ["2025-12-15", 7500, "Check", "CK 453"],
  ["2026-01-15", 7500, "Check", "CK 456"], ["2026-02-15", 7500, "Check", "CK 458"], ["2026-03-15", 7500, "Check", "CK 460"],
  ["2026-04-15", 7500, "Check", "CK 461"], ["2026-05-15", 7500, "Check", "CK 462"], ["2026-06-15", 5000, "Zelle", ""],
  ["2026-06-18", 2500, "Zelle", ""], ["2026-07-15", 7500, "Check", "CK 463"], ["2026-08-15", 7500, "Check", "CK 465"],
];
(async () => {
  const socio = ((await pool.query("SELECT value FROM app_data WHERE key='businessPartners.json'")).rows[0]?.value || []).find((p) => /antonio cano/i.test(p.name));
  if (!socio) throw new Error("no está el socio Antonio Cano");
  const ya = (await pool.query("SELECT 1 FROM partner_distributions WHERE partner_id=$1 AND work_order_no='Balance 2024'", [socio.id])).rowCount;
  if (!ya) await pool.query(
    `INSERT INTO partner_distributions (id, work_order_id, work_order_no, partner_id, partner_name, job_type, amount, paid_at) VALUES ($1, NULL, 'Balance 2024', $2, $3, 'Balance a favor de 2024', 62439.86, '2024-12-31')`,
    [crypto.randomUUID(), socio.id, socio.name]);
  const existentes = await pp.list({ partnerId: socio.id });
  let n = 0;
  for (const [d, a, m, ref] of PAGOS) {
    if (existentes.some((p) => p.paymentDate === d && Math.abs(p.amount - a) < 0.005)) continue;
    await pp.create({ partnerId: socio.id, partnerName: socio.name, paymentDate: d, amount: a, method: m, reference: ref, notes: "Pago de comisión de socio (lista de Antonio, 7-sep-2026)" }, "Antonio Cano");
    n++;
  }
  const b = (await pp.balances()).get(Number(socio.id));
  console.log(`balance 2024 ${ya ? "ya estaba" : "agregado"} | pagos agregados: ${n} | distribuido a la fecha $${b.distributedAllTime} | pagado $${b.paidAllTime} | saldo $${b.balance}`);
  await pool.end(); process.exit(0);
})().catch((e) => { console.error(e.stack); process.exit(1); });
