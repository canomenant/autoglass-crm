const XLSX = require("xlsx");
const pdfParse = require("pdf-parse");

// Lee el Excel de statements de Mygrant. El formato lo fija ellos, así que este parser está
// escrito contra sus rarezas reales, no contra un ideal:
//
//   · Los bloques de compra empiezan con "INVOICE" y los de devolución con "CREDIT MEMO".
//     Tratar los segundos como parte del primero pega dos facturas en una y descuadra ambas.
//   · No todos los bloques traen encabezado: algunos empiezan directo en la fila de títulos.
//     Por eso es la fila "REQ. NO." la que abre bloque, y el encabezado solo lo bautiza.
//   · Parte del archivo usa guion tipográfico (‑ U+2011) en los números de requisición. Se ve
//     idéntico al normal y no lo es.
//   · Las fechas vienen como 5/3/26 y también como 05/03/2026.
//
// La prueba de que un bloque se leyó bien: sus renglones suman el subtotal impreso. Lo que no
// cuadre se devuelve marcado, nunca se descarta en silencio.

const CLASE_TITULO = /^REQ\.?\s*NO/i;
const CABECERA = /^(INVOICE|CREDIT MEMO)/i;
const REQ = /^[SZ]\d{8}-\d+$/i;
const CIERRE = /^(Subtotal|Sales Tax|Net Amount):?$/i;

const limpiar = (v) => String(v ?? "").replace(/[‐-―−]/g, "-").trim();
const numero = (v) => {
  const n = Number(String(v ?? "").replace(/[$,\s]/g, ""));
  return Number.isFinite(n) ? n : null;
};

function fechaISO(f) {
  const m = String(f || "").trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (!m) return null;
  const anio = m[3].length === 2 ? `20${m[3]}` : m[3];
  const iso = `${anio}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
  return Number.isNaN(new Date(iso).getTime()) ? null : iso;
}

// "Irving, TX" es la sucursal de Mygrant; "Fresno" y "Newport Beach" son ubicaciones de Reyes,
// así que para esas manda la región de la hoja.
function sucursalMygrant(sucursal, hoja) {
  const t = String(sucursal || "").toLowerCase();
  if (t.includes("irving")) return "Mygrant Irving";
  if (t.includes("austin")) return "Mygrant Austin";
  if (t.includes("windcrest") || t.includes("san antonio")) return "Mygrant San Antonio";
  if (t.includes("houston")) return "Mygrant Houston";
  if (/TEXAS/i.test(hoja)) return "Mygrant San Antonio";
  if (/SOUTHER|SOUTHERN/i.test(hoja)) return "Mygrant Anaheim";
  return "Mygrant Hayward";
}

function leerHoja(filas, hoja) {
  const bloques = [];
  let actual = null;
  let cabecera = null;

  for (const fila of filas) {
    const c = fila.map(limpiar);
    if (!c.join("").trim()) continue;

    if (CABECERA.test(c[0])) {
      const m = c.join(" ").match(/(I\d{8}-\d)/);
      cabecera = {
        numero: m ? m[1] : null,
        tipo: /CREDIT/i.test(c[0]) ? "CREDIT_MEMO" : "INVOICE",
        fecha: c[1] || "",
        sucursal: c[3] || "",
      };
      continue;
    }

    if (CLASE_TITULO.test(c[0])) {
      if (actual) bloques.push(actual);
      // El propio título distingue el tipo cuando no hubo encabezado: "…APPLIED FROM" es memo.
      const porTitulo = /APPLIED\s+FROM/i.test(c.join(" ")) ? "CREDIT_MEMO" : "INVOICE";
      actual = {
        hoja,
        invoiceNumber: cabecera?.numero ?? null,
        kind: cabecera?.tipo ?? porTitulo,
        issueDate: fechaISO(cabecera?.fecha),
        branch: cabecera?.sucursal ?? "",
        distributor: sucursalMygrant(cabecera?.sucursal, hoja),
        lines: [],
        subtotal: null,
        tax: null,
        net: null,
      };
      cabecera = null;
      continue;
    }

    if (!actual) continue;

    const etiqueta = c.find((x) => CIERRE.test(x));
    if (etiqueta) {
      const valor = numero(c[c.indexOf(etiqueta) + 1]);
      if (/^Subtotal/i.test(etiqueta)) actual.subtotal = valor;
      else if (/^Sales/i.test(etiqueta)) actual.tax = valor;
      else actual.net = valor;
      continue;
    }

    if (REQ.test(c[0])) {
      actual.lines.push({
        reqNo: c[0],
        date: fechaISO(c[1]),
        qty: numero(c[2]) || 1,
        // Los memos escriben "FW04423 GTN FYG (Credit from S73924004-1)": la parte es lo de antes.
        partNumber: (c[3] || "").replace(/\s*\(Credit from.*$/i, "").trim(),
        amount: numero(c[4]),
        customerName: /CREDIT\s*APPLIED/i.test(c[5] || "") ? "" : c[5] || "",
        // En una compra es el crédito que la saldará; en un memo, la requisición que acredita.
        relatedRef: c[6] || "",
        relatedDate: fechaISO(c[7]),
        note: c[8] || "",
        returned: /^Z\d{8}-\d+$/i.test(c[6] || "") || /CREDIT\s*APPLIED/i.test(c[5] || ""),
      });
    }
  }
  if (actual) bloques.push(actual);
  return bloques;
}

// La verificación de cada bloque: sus renglones deben sumar el subtotal impreso. Sin subtotal
// queda en null — no se puede afirmar ni negar. Muta los bloques en el lugar.
function verificar(bloques) {
  for (const b of bloques) {
    const suma = Math.round(b.lines.reduce((s, l) => s + Number(l.amount || 0), 0) * 100) / 100;
    b.lineTotal = suma;
    b.check = b.subtotal == null ? null : Math.abs(suma - b.subtotal) < 0.02;
    b.difference = b.subtotal == null ? null : Math.round((suma - b.subtotal) * 100) / 100;
    // Si no hay subtotal impreso, el total del bloque es lo que sumen sus renglones.
    b.amount = b.subtotal != null ? b.subtotal : suma;
  }
  return bloques;
}

function resumir(bloques) {
  const conNumero = bloques.filter((b) => b.invoiceNumber);
  return {
    total: bloques.length,
    withNumber: conNumero.length,
    withoutNumber: bloques.length - conNumero.length,
    verified: bloques.filter((b) => b.check === true).length,
    failed: bloques.filter((b) => b.check === false).length,
    unverifiable: bloques.filter((b) => b.check === null).length,
    lines: bloques.reduce((s, b) => s + b.lines.length, 0),
    invoices: conNumero.filter((b) => b.kind === "INVOICE").length,
    creditMemos: conNumero.filter((b) => b.kind === "CREDIT_MEMO").length,
    amount: Math.round(conNumero.reduce((s, b) => s + Number(b.amount || 0), 0) * 100) / 100,
  };
}

function parseWorkbook(buffer) {
  const wb = XLSX.read(buffer, { type: "buffer" });
  const bloques = [];
  for (const nombre of wb.SheetNames) {
    const filas = XLSX.utils.sheet_to_json(wb.Sheets[nombre], { header: 1, raw: false, defval: "" });
    if (!filas.length) continue;
    leerHoja(filas, nombre).forEach((b) => bloques.push(b));
  }
  verificar(bloques);
  return { blocks: bloques, summary: resumir(bloques) };
}

// --- PDF de factura individual de Mygrant ---
//
// El texto sale en el orden del contenido del PDF, con cada renglón completo pero SIN espacios
// entre campos: "S75244766-108/26/20261FD28994 GTY FYG773.330.08061.87". Ese orden es el
// correcto: el modo "por columnas" de otros extractores corre los montos un renglón (verificado
// contra las órdenes reales). El factor siempre trae tres decimales (0.080, 1.010) y eso es lo
// que separa LIST de NET en la cadena pegada.
//
// El número de cuenta dice la sucursal — más fiable que las direcciones del encabezado, que
// mezclan las ubicaciones de Reyes con la de Mygrant:
const CUENTA_SUCURSAL = {
  "C021034-001": ["Newport Beach", "Mygrant Anaheim"],
  "C021034-002": ["Fresno", "Mygrant Hayward"],
  "C030633-001": ["Irving, TX", "Mygrant Irving"],
  "C030633-002": ["Austin, TX", "Mygrant Austin"],
  "C030633-005": ["Windcrest, TX", "Mygrant San Antonio"],
};

const LINEA_PDF = /^([SZ]\d{8}-\d+)(\d{2}\/\d{2}\/\d{4})(\d{1,2}?)(.+)$/;
const COMPRA_PDF = /^(.*?)([\d,]+\.\d{2})(\d\.\d{3})(-?[\d,]+\.\d{2})$/;
const CREDITO_PDF = /^(.*?)([\d,]+\.\d{2})(-[\d,]+\.\d{2})$/;

// Reconstruye cada línea VISUAL agrupando los fragmentos por su coordenada Y y ordenándolos
// por X. El orden del stream del PDF viene revuelto (los "Originally purchased" pueden salir
// antes que su renglón de crédito), pero en la página impresa cada nota va justo debajo de su
// renglón — y eso es lo que este orden recupera. La verificación contra el subtotal impreso
// sigue siendo la red: si la reconstrucción mezclara filas, la suma no daría.
function renderPagina(pageData) {
  return pageData.getTextContent({ normalizeWhitespace: false, disableCombineTextItems: false }).then((tc) => {
    const filas = [];
    for (const item of tc.items) {
      if (!item.str || !item.str.trim()) continue;
      const y = item.transform[5];
      const x = item.transform[4];
      let fila = filas.find((f) => Math.abs(f.y - y) <= 2);
      if (!fila) { fila = { y, partes: [] }; filas.push(fila); }
      fila.partes.push({ x, s: item.str });
    }
    return filas
      .sort((a, b) => b.y - a.y)
      .map((f) => f.partes.sort((a, b) => a.x - b.x).map((p) => p.s).join(""))
      .join("\n");
  });
}

async function extraerTextoPdf(buffer) {
  // Los PDFs de Mygrant traen cadenas hex corruptas que pdf.js reporta línea por línea sin que
  // afecten el texto; se silencia ese ruido solo durante la extracción.
  const logOriginal = console.log;
  console.log = (...args) => {
    if (typeof args[0] === "string" && args[0].startsWith("Warning:")) return;
    logOriginal(...args);
  };
  try {
    // La build v2.0.550 tolera PDFs con el índice interno dañado (pasa en los de Mygrant);
    // si ella misma falla, se intenta con la que trae por defecto.
    try {
      return (await pdfParse(buffer, { version: "v2.0.550", pagerender: renderPagina })).text;
    } catch {
      return (await pdfParse(buffer, { pagerender: renderPagina })).text;
    }
  } finally {
    console.log = logOriginal;
  }
}

async function parsePdfBlock(buffer, fileName) {
  const texto = await extraerTextoPdf(buffer);
  const lineas = texto.split(/\r?\n/).map((l) => limpiar(l));

  const numFactura = (texto.match(/I\d{8}-\d/) || [])[0] || null;
  const cuenta = (texto.match(/C0\d{5}-\d{3}/) || [])[0] || null;
  const [branch, distribuidor] = CUENTA_SUCURSAL[cuenta] || ["", "Mygrant Hayward"];
  // La fecha de la factura es la primera línea que es SOLO una fecha (las de los renglones van
  // pegadas dentro de su cadena y no matchean solas).
  const fecha = lineas.find((l) => /^\d{2}\/\d{2}\/\d{4}$/.test(l)) || null;

  const bloque = {
    hoja: fileName || "PDF",
    invoiceNumber: numFactura,
    kind: "INVOICE",
    issueDate: fechaISO(fecha),
    branch,
    distributor: distribuidor,
    lines: [],
    subtotal: null,
    tax: null,
    net: null,
    unparsed: [],
  };

  for (const l of lineas) {
    // "Originally purchased on DR# S…" acompaña al renglón de crédito anterior: es la compra
    // que ese crédito está devolviendo.
    const orig = l.match(/Originally purchased on DR#\s*([SZ]\d{8}-\d+)/i);
    if (orig) {
      const ultimo = [...bloque.lines].reverse().find((x) => !x.relatedRef && /^Z/i.test(x.reqNo));
      if (ultimo) ultimo.relatedRef = orig[1];
      continue;
    }
    const m = l.match(LINEA_PDF);
    if (!m) continue;
    const [, req, f, qty, cola] = m;
    const compra = cola.match(COMPRA_PDF);
    const credito = compra ? null : cola.match(CREDITO_PDF);
    if (!compra && !credito) { bloque.unparsed.push(l); continue; }
    bloque.lines.push({
      reqNo: req,
      date: fechaISO(f),
      qty: Number(qty) || 1,
      partNumber: (compra ? compra[1] : credito[1]).trim(),
      amount: numero(compra ? compra[4] : credito[3]),
      customerName: "",
      relatedRef: "",
      relatedDate: null,
      note: "",
      returned: false,
    });
  }

  // Con las líneas visuales reconstruidas, cada total sale pegado a su etiqueta:
  // "Subtotal:422.57". Se toma la última aparición (los PDFs multipágina lo imprimen al final).
  for (const l of lineas) {
    let m;
    if ((m = l.match(/^Subtotal:?\s*(-?[\d,]+\.?\d*)$/i))) bloque.subtotal = numero(m[1]);
    else if ((m = l.match(/^Sales Tax:?\s*(-?[\d,]+\.?\d*)$/i))) bloque.tax = numero(m[1]);
    else if ((m = l.match(/^Net Amount:?\s*(-?[\d,]+\.?\d*)$/i))) bloque.net = numero(m[1]);
  }
  if ((bloque.subtotal ?? 0) < 0 || (bloque.subtotal == null && bloque.lines.every((x) => Number(x.amount) < 0))) {
    bloque.kind = "CREDIT_MEMO";
    bloque.lines.forEach((x) => { x.returned = false; });
  }
  return bloque;
}

// Varias fuentes en una carga: PDFs de factura individual y/o el Excel semanal.
async function parseFiles(archivos = []) {
  const bloques = [];
  for (const a of archivos) {
    const buffer = Buffer.from(a.base64, "base64");
    if (buffer.slice(0, 4).toString() === "%PDF") {
      bloques.push(await parsePdfBlock(buffer, a.fileName));
    } else {
      parseWorkbook(buffer).blocks.forEach((b) => bloques.push(b));
    }
  }
  verificar(bloques);
  return { blocks: bloques, summary: resumir(bloques) };
}

// Pegado directo desde Excel: mismas reglas, separado por tabuladores.
function parsePasted(texto) {
  const filas = String(texto || "").split(/\r?\n/).map((l) => l.split("\t"));
  const bloques = verificar(leerHoja(filas, "Pegado"));
  return { blocks: bloques, summary: resumir(bloques) };
}

module.exports = { parseWorkbook, parsePasted, parseFiles, sucursalMygrant, fechaISO };
