const express = require("express");
const store = require("../store/statements.store");
const { parseWorkbook, parsePasted } = require("../lib/statementParser");
const pool = require("../config/db");

const router = express.Router();

// Cruza cada renglón contra las órdenes de trabajo, para que la vista previa ya diga qué va a
// enganchar y qué va a quedar pendiente de decisión. La llave fuerte es el nombre del cliente
// cuando el statement lo trae; si no, part number y cercanía de fecha, y ahí se marca dudoso.
const ACCESORIO = /^(WFS|WFT|WKT|WLM|WLS|WCR|USM|MSP|AWH|QC\d|5504G|U4\d\d|UKB|MZT|RLE|PUGM|DELIVERY|SIKAFLEX)/i;
const norm = (s) =>
  String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
const base = (p) => String(p || "").split(/\s+/).slice(0, 2).join(" ").toUpperCase();

async function cruzar(bloques) {
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
    const c = (k) => b.lines.filter((l) => l.classification === k).length;
    b.match = { installed: c("INSTALLED"), returned: c("RETURNED"), credit: c("CREDIT"),
                accessory: c("ACCESSORY"), undecided: c("UNDECIDED"),
                uncertain: b.lines.filter((l) => l.uncertain).length };
  }
  return bloques;
}

// Cuánto le debemos al distribuidor hoy, en cuántos statements, y qué notas siguen sin aplicar.
router.get("/summary", async (req, res) => res.json(await store.summary(req.query.distributor)));

// Saldo abierto por distribuidor, de mayor a menor.
router.get("/by-distributor", async (_req, res) => res.json({ distributors: await store.byDistributor() }));

router.get("/", async (req, res) => {
  res.json(await store.list({
    status: req.query.status,
    pendientes: req.query.pending === "true",
    kind: req.query.kind,
    distributor: req.query.distributor,
    search: req.query.search,
    from: req.query.from,
    to: req.query.to,
    limit: req.query.limit,
    offset: req.query.offset,
  }));
});

// Lee un statement SIN guardar nada: devuelve los bloques con su verificación (los renglones
// deben sumar el subtotal impreso) y ya cruzados contra las órdenes. Guardar es un paso aparte,
// para que Antonio vea antes qué va a entrar.
router.post("/parse", async (req, res) => {
  try {
    const { base64, pasted } = req.body || {};
    if (!base64 && !pasted) return res.status(400).json({ error: "Se espera { base64 } o { pasted }" });
    const r = base64 ? parseWorkbook(Buffer.from(base64, "base64")) : parsePasted(pasted);
    if (!r.blocks.length) return res.status(400).json({ error: "No se encontró ningún statement en el archivo" });
    await cruzar(r.blocks);
    res.json({ ...r, fileName: req.body?.fileName || null });
  } catch (err) {
    res.status(400).json({ error: `No se pudo leer el archivo: ${err.message}` });
  }
});

// Lo que hay que marcar en el armado del pago si se eligen estos statements: las obligaciones
// de sus órdenes de trabajo, sus notas, y lo que queda sin cubrir.
router.post("/selection", async (req, res) => {
  const ids = Array.isArray(req.body?.ids) ? req.body.ids : null;
  if (!ids) return res.status(400).json({ error: "Se espera { ids: [...] }" });
  try {
    res.json(await store.selection(ids));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.get("/:id/lines", async (req, res) => res.json({ lines: await store.lines(req.params.id) }));

router.get("/:id", async (req, res) => {
  const s = await store.get(req.params.id);
  if (!s) return res.status(404).json({ error: "Statement not found" });
  res.json(s);
});

router.post("/", async (req, res) => {
  try {
    res.status(201).json(await store.create(req.body || {}, req.user?.name));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Carga por lote de un statement completo. Reimportar el mismo archivo es inofensivo: lo que ya
// existe se actualiza en vez de duplicarse.
router.post("/import", async (req, res) => {
  const filas = Array.isArray(req.body?.statements) ? req.body.statements : null;
  if (!filas) return res.status(400).json({ error: "Se espera { statements: [...] }" });
  if (filas.length > 2000) return res.status(400).json({ error: "Máximo 2000 renglones por carga" });
  try {
    res.json(await store.importMany(filas, req.user?.name));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.put("/:id", async (req, res) => {
  try {
    const s = await store.update(req.params.id, req.body || {}, req.user?.name);
    if (!s) return res.status(404).json({ error: "Statement not found" });
    res.json(s);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Marcar statements como saldados por un pago. Acepta montos parciales: Mygrant aplica pagos
// que cubren solo una parte de una factura y dejan saldo.
router.post("/apply", async (req, res) => {
  const ids = Array.isArray(req.body?.ids) ? req.body.ids : null;
  if (!ids || !ids.length) return res.status(400).json({ error: "Se espera { ids: [...] }" });
  try {
    res.json({ statements: await store.applyToPayout(ids, req.body.payoutId, req.body.amounts || {}) });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete("/:id", async (req, res) => {
  const ok = await store.remove(req.params.id, req.user?.name);
  if (!ok) return res.status(404).json({ error: "Statement not found" });
  res.json({ ok: true });
});

module.exports = router;
