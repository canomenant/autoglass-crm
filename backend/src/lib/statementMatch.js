const pool = require("../config/db");

// Cruza cada renglón contra las órdenes de trabajo, para que la vista previa ya diga qué va a
// enganchar y qué va a quedar pendiente de decisión. La llave fuerte es el nombre del cliente
// cuando el statement lo trae; si no, part number y cercanía de fecha, y ahí se marca dudoso.
const ACCESORIO = /^(WFS|WFT|WKT|WLM|WLS|WCR|USM|MSP|AWH|QC\d|5504G|U4\d\d|UKB|MZT|RLE|PUGM|DELIVERY|SIKAFLEX)/i;
const norm = (s) =>
  String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
const base = (p) => String(p || "").split(/\s+/).slice(0, 2).join(" ").toUpperCase();

async function cruzar(bloques) {
  // LA LLAVE EXACTA: la línea de la cotización guarda el número de requisición con que se pidió
  // la parte (`orderNumber`, p. ej. S73749583) — el mismo que encabeza cada renglón del statement
  // (S73749583-1, -2, -3). Cruzar por ahí no adivina nada: es el número que Mygrant y nosotros
  // usamos para la misma compra. Se intenta ANTES que cliente/parte/fecha, que son aproximaciones.
  const porReq = new Map();
  const reqs = (await pool.query(
    `SELECT upper(btrim(li->>'orderNumber')) AS req, wo.work_order_no, wo.customer_name
       FROM quotes q
       CROSS JOIN LATERAL jsonb_array_elements(q.line_items) li
       JOIN work_orders wo ON wo.quote_id = q.id AND wo.active <> false
      WHERE COALESCE(btrim(li->>'orderNumber'), '') <> ''`
  )).rows;
  for (const r of reqs) if (!porReq.has(r.req)) porReq.set(r.req, r);

  const fechas = bloques.flatMap((b) => b.lines.map((l) => l.date)).filter(Boolean).sort();
  if (!fechas.length) return bloques;
  const desde = new Date(new Date(fechas[0]).getTime() - 30 * 86400000).toISOString().slice(0, 10);
  const hasta = new Date(new Date(fechas[fechas.length - 1]).getTime() + 30 * 86400000).toISOString().slice(0, 10);

  const wos = (await pool.query(
    `SELECT work_order_no, customer_name, part_number, glass_cost, appointment_date::date::text AS f
       FROM work_orders WHERE appointment_date::date BETWEEN $1::date AND $2::date`,
    [desde, hasta]
  )).rows;
  const porCliente = new Map();
  for (const w of wos) {
    const k = norm(w.customer_name);
    if (!k) continue;
    if (!porCliente.has(k)) porCliente.set(k, []);
    porCliente.get(k).push(w);
  }

  for (const b of bloques) {
    for (const l of b.lines) {
      if (b.kind === "CREDIT_MEMO") { l.classification = "CREDIT"; continue; }
      if (l.returned) { l.classification = "RETURNED"; continue; }

      // Primero la requisición: es el mismo número en los dos lados, no una coincidencia.
      const exacta = porReq.get(String(l.reqNo || "").split("-")[0].toUpperCase());
      if (exacta) {
        l.workOrderNo = exacta.work_order_no;
        l.matchSource = "requisición";
        l.classification = "INSTALLED";
        continue;
      }

      const cands = porCliente.get(norm(l.customerName)) || [];
      const mismaParte = cands.filter((w) => base(w.part_number) === base(l.partNumber));
      let w = mismaParte[0] || cands[0] || null;
      l.matchSource = w ? (mismaParte.length ? "cliente+parte" : "cliente") : null;

      if (!w && l.date) {
        const cerca = wos
          .filter((x) => base(x.part_number) === base(l.partNumber))
          .map((x) => ({ x, d: Math.abs((new Date(x.f) - new Date(l.date)) / 86400000) }))
          .filter((o) => o.d <= 21)
          .sort((a, c) => a.d - c.d);
        const exacto = cerca.find((o) => Math.abs(Number(o.x.glass_cost || 0) - Math.abs(l.amount || 0)) < 0.02);
        if (exacto) { w = exacto.x; l.matchSource = "parte+fecha+monto"; }
        else if (cerca.length) { w = cerca[0].x; l.matchSource = "parte+fecha"; l.uncertain = true; }
      }

      l.workOrderNo = w ? w.work_order_no : null;
      l.classification = w ? "INSTALLED" : ACCESORIO.test(l.partNumber || "") ? "ACCESSORY" : "UNDECIDED";
    }

    // Un accesorio viaja con el vidrio de SU MISMA requisición: la moldura de S73749583-3 se
    // instaló donde el FW04945 de S73749583-2. Hereda esa orden. El que no tiene vidrio hermano
    // (un cartón de uretano comprado suelto) no está resuelto: es una decisión — cargo al técnico
    // o gasto de taller — y disfrazarlo de "accesorio" lo escondía del montón de por decidir.
    const woPorReq = new Map();
    for (const l of b.lines) {
      if (!l.workOrderNo || !l.reqNo) continue;
      woPorReq.set(String(l.reqNo).split("-")[0], l.workOrderNo);
    }
    for (const l of b.lines) {
      if (l.classification !== "ACCESSORY") continue;
      const hermano = woPorReq.get(String(l.reqNo || "").split("-")[0]);
      if (hermano) l.workOrderNo = hermano;
      else l.classification = "UNDECIDED";
    }
    const c = (k) => b.lines.filter((l) => l.classification === k).length;
    b.match = { installed: c("INSTALLED"), returned: c("RETURNED"), credit: c("CREDIT"),
                accessory: c("ACCESSORY"), undecided: c("UNDECIDED"),
                uncertain: b.lines.filter((l) => l.uncertain).length };
  }
  return bloques;
}

module.exports = { cruzar };
