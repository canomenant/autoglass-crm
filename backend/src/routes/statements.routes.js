const express = require("express");
const store = require("../store/statements.store");
const { parseFiles, parsePasted } = require("../lib/statementParser");
const { cruzar } = require("../lib/statementMatch");

const router = express.Router();

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
    const { base64, pasted, files } = req.body || {};
    let r;
    if (Array.isArray(files) && files.length) {
      // Varios archivos en una carga: PDFs de factura individual y/o el Excel semanal, mezclados.
      if (files.length > 60) return res.status(400).json({ error: "Máximo 60 archivos por carga" });
      r = await parseFiles(files);
    } else if (base64) {
      r = await parseFiles([{ base64, fileName: req.body?.fileName }]);
    } else if (pasted) {
      r = parsePasted(pasted);
    } else {
      return res.status(400).json({ error: "Se espera { files }, { base64 } o { pasted }" });
    }
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

// La lista de trabajo: todos los renglones sin salida, de todos los statements.
router.get("/undecided", async (_req, res) => res.json({ lines: await store.undecidedLines() }));

router.get("/work-order/:no", async (req, res) => res.json({ lines: await store.forWorkOrder(req.params.no) }));

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
